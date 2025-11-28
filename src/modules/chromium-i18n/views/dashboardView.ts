import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { QueryService } from '../services/queryService';
import { ConfigService } from '../services/configService';
import { getSortedLanguages, getLanguageDisplayName } from '../utils/languageUtils';

interface FileSummary {
  path: string;
  relativePath: string;
  type: 'grd' | 'grdp';
  messageCount: number;
}

interface SearchResultItem {
  name: string;
  english: string;
  translation?: string;
  filePath?: string;
  lang?: string;
}

/**
 * Dashboard WebviewView provider (activity bar view id: chromiumI18nDashboard)
 */
export class DashboardView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly queryService: QueryService,
    private readonly configService: ConfigService,
    private readonly chromiumRoot: string,
  ) {}

  /**
   * VSCode will call this when the contributed view is shown
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    this.view.webview.options = {
      enableScripts: true,
    };
    this.view.webview.html = this.getWebviewContent(this.view.webview);

    this.view.onDidDispose(() => {
      this.view = null;
    });

    this.view.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });
  }

  /**
   * Reveal the contributed view
   */
  public async show(): Promise<void> {
    if (this.view) {
      this.view.show?.(true);
      await this.refreshOverview();
      return;
    }

    // Trigger VSCode to show the view container; VSCode will call resolveWebviewView
    await vscode.commands.executeCommand('workbench.view.extension.chromiumI18n');
    // After resolve, refreshOverview will run when the webview posts "ready"
  }

  public dispose(): void {
    this.view = null;
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'ready':
        await this.refreshOverview();
        break;
      case 'refresh':
        await this.refreshOverview();
        break;
      case 'search':
        await this.handleSearch(message.query, message.lang);
        break;
      case 'loadFile':
        await this.handleLoadFile(message.path, message.lang);
        break;
      case 'loadStats':
        await this.handleLoadStats(message.lang);
        break;
      case 'searchWorkspace':
        if (message?.idsName) {
          await vscode.commands.executeCommand('workbench.view.search');
          await vscode.commands.executeCommand('workbench.action.findInFiles', {
            query: message.idsName,
            triggerSearch: true,
            filesToInclude: '**/*.{h,cc,mm,grd,grdp}',
            isRegex: false,
          });
        }
        break;
      case 'openDefinition':
        await vscode.commands.executeCommand('chromiumI18n.jumpToDefinition', {
          idsName: message.idsName,
        });
        break;
      case 'openTranslation':
        await vscode.commands.executeCommand('chromiumI18n.jumpToTranslation', {
          idsName: message.idsName,
          lang: message.lang,
        });
        break;
      default:
        break;
    }
  }

  private async refreshOverview(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const overlayLang = this.configService.getOverlayConfig().locale;
      const [indexStats, languages, files, messageCounts] = await Promise.all([
        this.queryService.getIndexStats(),
        this.queryService.getAllLanguages(),
        this.queryService.getAllFiles(),
        this.queryService.getMessageCountsByFile(),
      ]);

      const fileSummaries: FileSummary[] = files
        .filter((file) => file.type === 'grd' || file.type === 'grdp')
        .map((file) => ({
          path: file.path,
          relativePath: this.toRelative(file.path),
          type: file.type as 'grd' | 'grdp',
          messageCount: messageCounts.get(file.path) || 0,
        }))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      const languagesWithLabel = getSortedLanguages(languages).map((code) => ({
        code,
        label: `${getLanguageDisplayName(code)} (${code})`,
      }));

      const overviewPayload = {
        activeLanguage: overlayLang,
        languages: languagesWithLabel,
        indexStats,
        files: fileSummaries,
      };

      this.postMessage('overview', overviewPayload);
    } catch (error) {
      this.showError(error);
    }
  }

  private async handleLoadStats(lang?: string): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const overlayLang = lang || this.configService.getOverlayConfig().locale;
      const [translationStats, missingTranslations] = await Promise.all([
        this.queryService.getTranslationStats(),
        overlayLang ? this.queryService.findMissingTranslations(overlayLang) : Promise.resolve([]),
      ]);

      this.postMessage('statsData', {
        translationStats,
        missingTranslations: missingTranslations.slice(0, 50).map((m) => ({
          name: m.name,
          english: m.english,
          filePath: this.toRelative(m.grdp_path || m.grd_path || ''),
        })),
      });
    } catch (error) {
      this.showError(error);
    }
  }

  private async handleSearch(keyword: string, lang?: string): Promise<void> {
    if (!this.view) {
      return;
    }

    const query = (keyword || '').trim();
    if (!query) {
      this.postMessage('searchResults', { results: [], total: 0, keyword: '' });
      return;
    }

    try {
      const targetLang = lang || this.configService.getOverlayConfig().locale;
      const searchResult = await this.queryService.searchMessages(query, 50, 0);

      const results: SearchResultItem[] = searchResult.messages.map((item) => {
        const translation =
          targetLang && item.translations?.length
            ? item.translations.find((t) => t.lang === targetLang)?.text
            : undefined;

        const filePath = this.toRelative(item.grdp_path || item.grd_path || '');

        return {
          name: item.name,
          english: item.english,
          translation,
          filePath,
          lang: targetLang,
        };
      });

      this.postMessage('searchResults', {
        results,
        total: searchResult.total,
        keyword: query,
      });
    } catch (error) {
      this.showError(error);
    }
  }

  private async handleLoadFile(filePath: string, lang?: string): Promise<void> {
    if (!this.view || !filePath) {
      return;
    }

    try {
      const targetLang = lang || this.configService.getOverlayConfig().locale;
      const messages = await this.queryService.getMessagesByFile(filePath);
      const MAX_ITEMS = 150;
      const limitedMessages = messages.slice(0, MAX_ITEMS);
      const hasMore = messages.length > MAX_ITEMS;

      const translations =
        targetLang && limitedMessages.length > 0
          ? await this.queryService.getTranslationsBatch(
              limitedMessages.map((m) => m.id_hash),
              targetLang,
            )
          : new Map();

      const payload = limitedMessages.map((m) => ({
        name: m.name,
        english: m.english,
        translation: translations.get(m.id_hash),
        filePath: this.toRelative(m.grdp_path || m.grd_path || ''),
        lang: targetLang,
      }));

      this.postMessage('fileMessages', {
        filePath: this.toRelative(filePath),
        messages: payload,
        hasMore,
        total: messages.length,
      });
    } catch (error) {
      this.showError(error);
    }
  }

  private showError(error: unknown): void {
    console.error('[DashboardView] Error:', error);
    this.postMessage('error', { message: String(error) });
    vscode.window.showErrorMessage(`Dashboard failed to load: ${error}`);
  }

  private postMessage(type: string, payload?: any): void {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({ type, payload });
  }

  private toRelative(filePath: string): string {
    if (!filePath) {
      return '';
    }

    const relative = path.relative(this.chromiumRoot, filePath);
    return relative || filePath;
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';`;

    const distPath = path.join(this.context.extensionPath, 'dist', 'dashboardView.html');
    const srcPath = path.join(
      this.context.extensionPath,
      'src',
      'modules',
      'chromium-i18n',
      'views',
      'dashboardView.html',
    );
    const templatePath = fs.existsSync(distPath) ? distPath : srcPath;
    const html = fs.readFileSync(templatePath, 'utf-8');
    return html.replace(/__CSP__/g, csp).replace(/__NONCE__/g, nonce);
  }
  private getNonce(): string {
    const possible =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 })
      .map(() => possible.charAt(Math.floor(Math.random() * possible.length)))
      .join('');
  }
}

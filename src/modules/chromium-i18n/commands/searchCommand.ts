import * as path from 'path';
import * as vscode from 'vscode';
import { QueryService } from '../services/queryService';
import { ConfigService } from '../services/configService';
import { jumpToDefinitionCommand } from './jumpToTranslationCommand';

interface SearchQuickPickItem extends vscode.QuickPickItem {
  idsName: string;
}

/**
 * Register global search command (chromiumI18n.search)
 */
export function registerSearchCommand(
  context: vscode.ExtensionContext,
  queryService: QueryService,
  chromiumRoot: string,
  configService: ConfigService,
): void {
  const command = vscode.commands.registerCommand('chromiumI18n.search', async () => {
    const keyword = await vscode.window.showInputBox({
      prompt: 'Search IDS name, English text, or translation',
      placeHolder: 'e.g., IDS_OK, login, settings',
    });

    if (!keyword) {
      return;
    }

    try {
      const overlayLang = configService.getOverlayConfig().locale;
      const result = await queryService.searchMessages(keyword, 50, 0);

      if (!result.messages || result.messages.length === 0) {
        vscode.window.showInformationMessage('No matching i18n strings found');
        return;
      }

      const items: SearchQuickPickItem[] = result.messages.map((message) => {
        const displayPath = message.grdp_path || message.grd_path || '';
        const relativePath = displayPath
          ? path.relative(chromiumRoot, displayPath)
          : '';
        const translation =
          overlayLang && message.translations
            ? message.translations.find((t) => t.lang === overlayLang)?.text
            : undefined;

        return {
          label: message.name,
          description: message.english?.slice(0, 80) || '',
          detail: `${relativePath}${translation ? ` • ${translation.slice(0, 80)}` : ''}`,
          idsName: message.name,
        };
      });

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: `Found ${result.total} results; press Enter to jump to definition`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selection) {
        return;
      }

      await jumpToDefinitionCommand(queryService, chromiumRoot, { idsName: selection.idsName });
    } catch (error) {
      console.error('[chromiumI18n.search] Error:', error);
      vscode.window.showErrorMessage(`Search i18n strings failed: ${error}`);
    }
  });

  context.subscriptions.push(command);
}

import * as vscode from 'vscode';
import { QueryService } from '../services/queryService';
import { ConfigService } from '../services/configService';
import { IMessageWithTranslations, ITranslation } from '../models';
import { getLanguageDisplayName } from '../utils/languageUtils';

/**
 * Completion provider for IDS constants
 */
export class ChromiumI18nCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly queryService: QueryService,
    private readonly configService: ConfigService,
  ) {}

  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.CompletionItem[]> {
    if (token.isCancellationRequested) {
      return [];
    }

    const prefixContext = this.extractPrefix(document, position);
    if (!prefixContext) {
      return [];
    }

    const config = this.configService.getConfig();
    if (!config.enableCompletion) {
      return [];
    }

    const { prefix, range } = prefixContext;
    const searchResult = await this.queryService.searchMessages(prefix, 50);
    const overlayConfig = this.configService.getOverlayConfig();
    const preferredLang = overlayConfig.locale;
    const autoInsertComment = config.autoInsertComment;

    return searchResult.messages.map((message, index) =>
      this.buildCompletionItem(message, {
        preferredLang,
        autoInsertComment,
        range,
        sortIndex: index,
      }),
    );
  }

  private buildCompletionItem(
    message: IMessageWithTranslations,
    options: {
      preferredLang: string;
      autoInsertComment: boolean;
      range: vscode.Range;
      sortIndex: number;
    },
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(message.name, vscode.CompletionItemKind.Constant);
    item.range = options.range;
    item.filterText = message.name;
    item.sortText = options.sortIndex.toString().padStart(5, '0');

    const englishPreview = this.compactText(message.english);
    item.detail = englishPreview;

    const translation = this.pickTranslation(message.translations, options.preferredLang);
    if (translation) {
      item.documentation = this.buildDocumentation(translation, message);

      if (options.autoInsertComment) {
        item.insertText = new vscode.SnippetString(
          this.buildInsertSnippet(message.name, translation.text),
        );
      }
    }

    if (!item.insertText) {
      item.insertText = message.name;
    }

    return item;
  }

  private buildDocumentation(
    translation: ITranslation,
    message: IMessageWithTranslations,
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    const languageLabel = getLanguageDisplayName(translation.lang);
    md.appendMarkdown(
      `**${languageLabel}:** ${this.escapeMarkdown(this.compactText(translation.text))}\n\n`,
    );
    md.appendMarkdown(`**English:** ${this.escapeMarkdown(this.compactText(message.english))}\n\n`);

    const sourcePath = this.getSourcePath(message);
    if (sourcePath) {
      md.appendMarkdown(`Source: \`${this.escapeMarkdown(sourcePath)}\``);
    }

    return md;
  }

  private pickTranslation(
    translations: ITranslation[],
    preferredLang: string,
  ): ITranslation | undefined {
    return translations.find((t) => t.lang === preferredLang) || translations[0];
  }

  private extractPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { prefix: string; range: vscode.Range } | null {
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const match = linePrefix.match(/(IDS_[A-Z0-9_]*)$/);
    if (!match) {
      return null;
    }

    const prefix = match[1];
    const start = position.translate(0, -prefix.length);
    return {
      prefix,
      range: new vscode.Range(start, position),
    };
  }

  private buildInsertSnippet(idsName: string, translationText: string): string {
    const cleaned = this.compactText(translationText);
    const escapedTranslation = this.escapeSnippetText(cleaned);
    return `${idsName} // ${escapedTranslation}`;
  }

  private compactText(text: string, maxLength: number = 80): string {
    const singleLine = (text || '').replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLength) {
      return singleLine;
    }
    return `${singleLine.slice(0, maxLength - 3)}...`;
  }

  private escapeSnippetText(text: string): string {
    return text.replace(/[$}\\]/g, '\\$&');
  }

  private escapeMarkdown(text: string): string {
    return (text || '')
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/{/g, '\\{')
      .replace(/}/g, '\\}')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!');
  }

  private getSourcePath(message: IMessageWithTranslations): string | undefined {
    const absolutePath = message.grdp_path || message.grd_path;
    if (!absolutePath) {
      return undefined;
    }

    try {
      return this.queryService.pathToRelative(absolutePath);
    } catch {
      return absolutePath;
    }
  }
}

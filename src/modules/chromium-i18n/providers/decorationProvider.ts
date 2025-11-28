/**
 * Provider for managing VSCode text decorations (ghost text overlays).
 *
 * This provider:
 * - Creates decoration types based on user configuration
 * - Applies decorations to active text editors
 * - Manages decoration lifecycle (update, clear, dispose)
 *
 * Ghost text format: [translation text] displayed before IDS constant
 * Example: [Install Google Play Services] IDS_AR_CORE_CHECK_MESSAGE
 */

import * as vscode from 'vscode';
import { TranslationInfo } from '../services/translationCacheService';
import { ConfigService } from '../services/configService';

/**
 * Decoration range with translation info
 */
export interface DecorationRange {
  /** Range where IDS constant appears */
  range: vscode.Range;

  /** Translation information */
  translation: TranslationInfo;
}

/**
 * Provider for managing translation overlay decorations
 */
export class DecorationProvider {
  /** Decoration type for ghost text */
  private decorationType: vscode.TextEditorDecorationType;

  /** Configuration service */
  private configService: ConfigService;

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.decorationType = this.createDecorationType();
  }

  /**
   * Create decoration type based on user configuration
   */
  private createDecorationType(): vscode.TextEditorDecorationType {
    const config = this.configService.getOverlayConfig();

    return vscode.window.createTextEditorDecorationType({
      before: {
        color: config.style.color,
        backgroundColor: config.style.backgroundColor,
        fontStyle: config.style.fontStyle,
        fontWeight: 'normal',
        textDecoration: 'none; user-select: none; pointer-events: none;',
        margin: '0 4px 0 0',
      },
    });
  }

  /**
   * Recreate decoration type (e.g., when configuration changes)
   */
  public recreateDecorationType(): void {
    this.decorationType.dispose();
    this.decorationType = this.createDecorationType();
  }

  /**
   * Apply decorations to a text editor
   *
   * @param editor VSCode text editor
   * @param decorations Array of decoration ranges with translation info
   */
  public applyDecorations(editor: vscode.TextEditor, decorations: DecorationRange[]): void {
    const config = this.configService.getOverlayConfig();

    const decorationOptions: vscode.DecorationOptions[] = decorations.map((decoration) => {
      const ghostText = this.formatGhostText(decoration.translation);

      return {
        range: decoration.range,
        renderOptions: {
          before: {
            contentText: ghostText,
          },
        },
        hoverMessage: this.createHoverMessage(decoration.translation),
      };
    });

    editor.setDecorations(this.decorationType, decorationOptions);
  }

  /**
   * Clear all decorations from a text editor
   *
   * @param editor VSCode text editor
   */
  public clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
  }

  /**
   * Clear decorations from all visible editors
   */
  public clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
  }

  /**
   * Format ghost text based on translation info and configuration
   *
   * @param info Translation information
   * @returns Formatted ghost text string
   */
  private formatGhostText(info: TranslationInfo): string {
    const config = this.configService.getOverlayConfig();

    let text = info.translation;

    // Add count indicator if there are additional translations
    if (info.additionalCount > 0) {
      text += ` (+${info.additionalCount} more)`;
    }

    // Apply prefix and suffix
    return `${config.style.prefix}${text}${config.style.suffix}`;
  }

  /**
   * Create hover message for a decoration
   *
   * @param info Translation information
   * @returns Markdown hover message
   */
  private createHoverMessage(info: TranslationInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown(`**Translation**\n\n`);
    md.appendMarkdown(`${info.translation}\n\n`);

    if (info.priorityGrdPath) {
      md.appendMarkdown(`**Source**: \`${info.priorityGrdPath}\`\n\n`);
    }

    if (info.allTranslations && info.allTranslations.length > 1) {
      md.appendMarkdown(`**All Translations** (${info.allTranslations.length}):\n\n`);
      for (const trans of info.allTranslations) {
        md.appendMarkdown(`- ${trans.translation} (\`${trans.grdPath}\`)\n`);
      }
    }

    return md;
  }

  /**
   * Check if decorations should be visible based on configuration and editor state
   *
   * @param editor VSCode text editor
   * @returns true if decorations should be shown
   */
  public shouldShowDecorations(editor: vscode.TextEditor): boolean {
    const config = this.configService.getOverlayConfig();

    // Check if overlay is enabled globally
    if (!config.enabled) {
      return false;
    }

    // Check file type (only .h/.cc/.mm)
    const fileName = editor.document.fileName;
    if (!this.isSupportedFileType(fileName)) {
      return false;
    }

    // Check mode
    switch (config.mode) {
      case 'always':
        return true;
      case 'hover':
        // TODO: Implement hover-based visibility in future
        return false;
      case 'shortcut':
        // Controlled by toggle command
        return config.enabled;
      default:
        return true;
    }
  }

  /**
   * Check if file type is supported for overlays
   *
   * @param fileName Full file path or name
   * @returns true if file type is supported
   */
  private isSupportedFileType(fileName: string): boolean {
    return fileName.endsWith('.h') || fileName.endsWith('.cc') || fileName.endsWith('.mm');
  }

  /**
   * Dispose of decoration type
   */
  public dispose(): void {
    this.decorationType.dispose();
  }
}

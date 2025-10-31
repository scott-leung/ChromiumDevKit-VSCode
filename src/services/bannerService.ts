import * as vscode from 'vscode';
import { BannerTemplate } from '../models/bannerTemplate';
import { VariableContext } from '../models/variableContext';
import { ProcessedBanner } from '../models/processedBanner';
import { ExtensionConfig } from '../models/extensionConfig';
import { formatDate, getCurrentYear } from '../utils/dateUtils';

/**
 * Service for processing and inserting banner comments
 */
export class BannerService {
  /**
   * Process banner template by filling variable slots
   * @param template Banner template
   * @param config Extension configuration
   * @returns Processed banner with variables filled
   */
  public static processTemplate(template: BannerTemplate, config: ExtensionConfig): ProcessedBanner {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const context: VariableContext = {
      Author: config.author || '',
      Mail: config.email || '',
      Date: formatDate(new Date(), config.dateFormat),
      Year: getCurrentYear(),
      Company: config.company || '',
    };

    let content = template.content;

    // Replace all variable slots
    for (const [key, value] of Object.entries(context)) {
      const placeholder = `{{${key}}}`;
      content = content.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    const lineCount = content.split('\n').length;

    return {
      templateId: template.id,
      content,
      lineCount,
    };
  }

  /**
   * Insert banner at the top of the document
   * @param editor Text editor
   * @param banner Processed banner to insert
   */
  public static async insertBanner(
    editor: vscode.TextEditor,
    banner: ProcessedBanner,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const firstLine = editor.document.lineAt(0);
    const insertPosition = firstLine.range.start;

    edit.insert(editor.document.uri, insertPosition, banner.content);
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Insert #include statement after banner
   * @param editor Text editor
   * @param headerPath Header file path to include
   * @param bannerLineCount Number of lines in the banner
   */
  public static async insertIncludeStatement(
    editor: vscode.TextEditor,
    headerPath: string,
    bannerLineCount: number,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const includeStatement = `#include "${headerPath}"\n\n`;
    const insertPosition = new vscode.Position(bannerLineCount, 0);

    edit.insert(editor.document.uri, insertPosition, includeStatement);
    await vscode.workspace.applyEdit(edit);
  }
}

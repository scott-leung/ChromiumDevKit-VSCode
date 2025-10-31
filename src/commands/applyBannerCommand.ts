import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { BannerService } from '../services/bannerService';
import { DetectionService } from '../services/detectionService';

/**
 * Command to apply a banner template to the active editor
 */
export class ApplyBannerCommand {
  /**
   * Execute the apply banner command
   * @param templateId ID of the template to apply
   */
  public static async execute(templateId: string): Promise<void> {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor found');
        return;
      }

      const config = ConfigService.loadConfig();
      const template = config.templates.find((t) => t.id === templateId);

      if (!template) {
        vscode.window.showErrorMessage(`Template with ID '${templateId}' not found`);
        return;
      }

      const banner = BannerService.processTemplate(template, config);

      // Check if there's already a banner at the top using DetectionService
      const document = editor.document;
      const existingBannerRange = DetectionService.detectBanner(document);

      if (existingBannerRange) {
        // Replace existing banner
        await this.replaceBanner(editor, banner, existingBannerRange);
      } else {
        // Insert new banner
        await BannerService.insertBanner(editor, banner);
      }

      vscode.window.showInformationMessage(`Applied banner template: ${template.name}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to apply banner: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Replace existing banner with new one
   * @param editor Text editor
   * @param banner New banner to insert
   * @param existingRange Range of existing banner
   */
  private static async replaceBanner(
    editor: vscode.TextEditor,
    banner: { content: string },
    existingRange: vscode.Range,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, existingRange, banner.content);
    await vscode.workspace.applyEdit(edit);
  }
}

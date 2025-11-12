import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { PathService } from '../services/pathService';
import { BannerService } from '../services/bannerService';
import { HeaderGuardService } from '../services/headerGuardService';
import { DetectionService } from '../services/detectionService';
import { ExtensionConfig } from '../models/extensionConfig';

/**
 * Listener for file creation events
 */
export class FileCreateListener {
  /**
   * Handle file creation event
   * @param event File create event
   */
  public static async onDidCreateFiles(event: vscode.FileCreateEvent): Promise<void> {
    try {
      const config = await ConfigService.loadConfig();

      // Skip if auto-add is disabled
      if (!config.autoAddOnCreate) {
        return;
      }

      // Process each created file
      for (const uri of event.files) {
        await FileCreateListener.processFile(uri, config);
      }
    } catch (error) {
      console.error('Error handling file creation:', error);
      vscode.window.showErrorMessage(
        `C++ Banner: Failed to add banner - ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Process a single created file
   */
  private static async processFile(
    uri: vscode.Uri,
    config: ExtensionConfig,
  ): Promise<void> {
    const fileInfo = PathService.createFileInfo(uri);
    if (!fileInfo) {
      return; // File not in workspace
    }

    // Check if it's a supported file type (C++, header, Mojom, or IDL)
    const isSupportedFile =
      PathService.isHeaderFile(fileInfo) ||
      PathService.isImplementationFile(fileInfo) ||
      PathService.isMojomFile(fileInfo) ||
      PathService.isIdlFile(fileInfo);
    if (!isSupportedFile) {
      return;
    }

    // Open the file in an editor
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);

    // Check if banner already exists (smart detection)
    const existingBanner = DetectionService.detectBanner(document);
    if (existingBanner) {
      console.log('Banner already detected in file, skipping auto-add');
      return;
    }

    // Get default template
    const template = ConfigService.getDefaultTemplate(config);
    const banner = BannerService.processTemplate(template, config);

    // Insert banner
    await BannerService.insertBanner(editor, banner);

    // Handle header files
    if (PathService.isHeaderFile(fileInfo) && config.enableHeaderGuards) {
      // Check if header guard already exists
      const existingHeaderGuard = DetectionService.detectHeaderGuard(editor.document);
      if (!existingHeaderGuard) {
        const headerGuard = HeaderGuardService.generateHeaderGuard(
          fileInfo,
          config.headerGuardStyle,
        );
        await HeaderGuardService.insertHeaderGuard(editor, headerGuard, banner.lineCount);
      } else {
        console.log('Header guard already detected in file, skipping auto-add');
      }
    }

    // Handle implementation files
    if (PathService.isImplementationFile(fileInfo) && config.enableAutoInclude) {
      const headerPath = PathService.getCorrespondingHeaderPath(fileInfo);
      await BannerService.insertIncludeStatement(editor, headerPath, banner.lineCount);
    }

    // Save the document
    await document.save();
  }
}

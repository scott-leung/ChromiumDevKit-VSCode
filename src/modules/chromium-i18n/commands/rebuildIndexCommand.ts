/**
 * Rebuild Index Command
 * Provides manual index rebuild functionality with progress UI
 * Includes conflict detection for concurrent indexing scenarios
 */

import * as vscode from 'vscode';
import { IndexService } from '../services/indexService';
import { QueryService } from '../services/queryService';

/**
 * Execute rebuild index command
 * Shows progress window and rebuilds entire index from scratch
 * Checks for active indexing tasks and handles conflicts
 *
 * @param indexService IndexService instance
 */
export async function executeRebuildIndexCommand(indexService: IndexService): Promise<void> {
  // ==========================================
  // Step 1: Check for active indexing tasks
  // ==========================================
  const queryService = QueryService.getInstance();
  const progress = await queryService.getIndexProgress();

  if (progress && progress.status === 'indexing') {
    const timeSinceLastUpdate = Date.now() - (progress.last_update_time || 0);
    const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

    if (timeSinceLastUpdate < HEARTBEAT_TIMEOUT) {
      // Active indexing task detected in another workspace window
      const percentComplete = progress.total_files > 0
        ? Math.round((progress.processed_count / progress.total_files) * 100)
        : 0;

      const answer = await vscode.window.showWarningMessage(
        `An indexing task is currently running in another workspace window (${percentComplete}% complete). ` +
          `Starting a rebuild now will cancel that task. Continue?`,
        { modal: true },
        'Cancel Existing and Rebuild',
        'Wait for Completion',
        'Abort'
      );

      if (answer === 'Wait for Completion') {
        // Wait for the other task to complete
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Chromium I18n: Waiting for active indexing to complete',
            cancellable: false,
          },
          async (progressReporter) => {
            while (true) {
              const currentProgress = await queryService.getIndexProgress();
              if (!currentProgress || currentProgress.status !== 'indexing') {
                progressReporter.report({ message: 'Indexing complete!' });
                break;
              }

              const percent = currentProgress.total_files > 0
                ? Math.round((currentProgress.processed_count / currentProgress.total_files) * 100)
                : 0;

              progressReporter.report({
                message: `${percent}% complete (${currentProgress.processed_count}/${currentProgress.total_files} files)`,
              });

              // Poll every 2 seconds
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        );

        vscode.window.showInformationMessage('Active indexing task completed. Index is up to date.');
        return;
      } else if (answer !== 'Cancel Existing and Rebuild') {
        // User chose "Abort"
        return;
      }

      // User chose "Cancel Existing and Rebuild" - proceed to rebuild
    }

    // If zombie task or user chose to force rebuild, reset the status
    await queryService.updateIndexProgress({ status: 'idle' });
    await queryService.clearProcessedFiles();
  }

  // ==========================================
  // Step 2: Confirm rebuild with user
  // ==========================================
  const answer = await vscode.window.showWarningMessage(
    'This will rebuild the entire i18n index. Continue?',
    { modal: true },
    'Rebuild'
  );

  if (answer !== 'Rebuild') {
    return;
  }

  // ==========================================
  // Step 3: Execute rebuild
  // ==========================================
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Rebuilding Chromium I18n Index',
      cancellable: false,
    },
    async progress => {
      try {
        // Force restart: clear all progress and rebuild from scratch
        const indexedCount = await indexService.buildFullIndex(progress, true);

        // Show statistics
        const stats = await indexService.getIndexStats();

        vscode.window.showInformationMessage(
          `Index rebuilt successfully!\n\n` +
            `📁 Files: ${stats.grdCount} GRD, ${stats.grdpCount} GRDP, ${stats.xtbCount} XTB\n` +
            `📝 Messages: ${stats.messageCount}\n` +
            `🌐 Translations: ${stats.translationCount}`
        );
      } catch (error) {
        console.error('Failed to rebuild index:', error);
        vscode.window.showErrorMessage(`Failed to rebuild index: ${error}`);
      }
    }
  );
}

/**
 * Register rebuild index command
 * @param context Extension context
 * @param indexService IndexService instance
 */
export function registerRebuildIndexCommand(
  context: vscode.ExtensionContext,
  indexService: IndexService
): void {
  const command = vscode.commands.registerCommand(
    'chromiumI18n.rebuildIndex',
    () => executeRebuildIndexCommand(indexService)
  );

  context.subscriptions.push(command);
  console.log('[RebuildIndexCommand] Command registered: chromiumI18n.rebuildIndex');
}

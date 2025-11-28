/**
 * Chromium I18n VSCode Extension Module
 *
 * Provides Chromium internationalization (i18n) tooling:
 * - Smart indexing/query for GRD/GRDP/XTB files
 * - Hover/definition/completion for IDS constants
 * - Translation overlays (inline gray text)
 * - AI-assisted translation
 * - Dashboard management and search
 */

import * as vscode from 'vscode';
import { QueryService } from './services/queryService';
import { configService } from './services/configService';
import { indexService } from './services/indexService';
import { registerRebuildIndexCommand } from './commands/rebuildIndexCommand';
import { FileWatchListener } from './listeners/fileWatchListener';
import { ChromiumI18nHoverProvider } from './providers/hoverProvider';
import { ChromiumI18nDefinitionProvider } from './providers/definitionProvider';
import { ChromiumI18nCompletionProvider } from './providers/completionProvider';
import { jumpToTranslationCommand, jumpToDefinitionCommand } from './commands/jumpToTranslationCommand';
import { aiTranslateCommand } from './commands/aiTranslateCommand';
import { createGrdMessageCommand } from './commands/createGrdMessageCommand';
import { findChromiumRoot } from '../../shared/utils/chromiumUtils';
import { OverlayService } from './services/overlayService';
import { IncludeParserService } from './services/includeParserService';
import { TranslationCacheService } from './services/translationCacheService';
import { DecorationProvider } from './providers/decorationProvider';
import { getLanguageDisplayName, getSortedLanguages } from './utils/languageUtils';
import { DashboardView } from './views/dashboardView';
import { registerSearchCommand } from './commands/searchCommand';

// Module-level instances
let fileWatchListener: FileWatchListener | null = null;
let overlayService: OverlayService | null = null;
let dashboardView: DashboardView | null = null;

/**
 * Check for interrupted indexing task on startup and handle recovery
 * Detects both active indexing tasks (from other workspace windows) and zombie tasks (from crashes)
 *
 * @param queryService QueryService instance for database operations
 * @param indexService IndexService instance for indexing operations
 */
async function checkAndHandleInterruptedIndexing(
  queryService: QueryService,
  indexService: any
): Promise<void> {
  const progress = await queryService.getIndexProgress();

  // No previous indexing task detected
  if (!progress || progress.status !== 'indexing') {
    return;
  }

  const timeSinceLastUpdate = Date.now() - (progress.last_update_time || 0);
  const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

  if (timeSinceLastUpdate < HEARTBEAT_TIMEOUT) {
    // ==========================================
    // Scenario 1: Active indexing task detected
    // Another workspace window is currently indexing
    // ==========================================
    const percentComplete = progress.total_files > 0
      ? Math.round((progress.processed_count / progress.total_files) * 100)
      : 0;

    const answer = await vscode.window.showWarningMessage(
      `An indexing task is currently running in another workspace window (${percentComplete}% complete, ${progress.processed_count}/${progress.total_files} files). What would you like to do?`,
      'Wait for Completion',
      'Force Takeover and Reindex',
      'Ignore (Use Existing Data)'
    );

    if (answer === 'Wait for Completion') {
      // Show progress notification and poll until completion
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Chromium I18n: Waiting for indexing to complete',
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
      vscode.window.showInformationMessage('Indexing task completed successfully.');
    } else if (answer === 'Force Takeover and Reindex') {
      // Reset progress and start fresh
      await queryService.updateIndexProgress({ status: 'idle' });
      await queryService.clearProcessedFiles();

      const shouldReindex = await vscode.window.showInformationMessage(
        'Previous indexing task has been cancelled. Would you like to start indexing now?',
        'Build Index',
        'Later'
      );

      if (shouldReindex === 'Build Index') {
        vscode.commands.executeCommand('chromiumI18n.rebuildIndex');
      }
    } else {
      // Ignore - user will use existing partial data
      console.log('[Chromium I18n] User chose to ignore active indexing task and use existing data');
    }
  } else {
    // ==========================================
    // Scenario 2: Zombie task detected
    // Previous indexing was interrupted (crash, force close, etc.)
    // ==========================================
    const percentComplete = progress.total_files > 0
      ? Math.round((progress.processed_count / progress.total_files) * 100)
      : 0;

    const answer = await vscode.window.showWarningMessage(
      `An indexing task was interrupted (${percentComplete}% complete, ${progress.processed_count}/${progress.total_files} files processed). Would you like to resume?`,
      'Resume Indexing',
      'Start Over',
      'Cancel'
    );

    if (answer === 'Resume Indexing') {
      // Resume from where it stopped
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Chromium I18n: Resuming indexing',
          cancellable: false,
        },
        async (progressReporter) => {
          const indexed = await indexService.resumeIndexing(progressReporter);
          vscode.window.showInformationMessage(
            `Successfully resumed and completed indexing (${indexed} total files indexed).`
          );
        }
      );
    } else if (answer === 'Start Over') {
      // Clear progress and start fresh
      await queryService.updateIndexProgress({ status: 'idle' });
      await queryService.clearProcessedFiles();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Chromium I18n: Building index',
          cancellable: false,
        },
        async (progressReporter) => {
          const indexed = await indexService.buildFullIndex(progressReporter, true);
          vscode.window.showInformationMessage(
            `Successfully built index from scratch (${indexed} files indexed).`
          );
        }
      );
    } else {
      // Cancel - mark as cancelled and leave partial data
      await queryService.updateIndexProgress({ status: 'cancelled' });
      console.log('[Chromium I18n] User cancelled interrupted indexing recovery');
    }
  }
}

/**
 * Activate the Chromium I18n module
 * @param context VSCode extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Chromium I18n module activating...');

  try {
    // Get workspace path
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Chromium I18n: No workspace folder open');
      return;
    }

    const workspacePath = workspaceFolders[0].uri.fsPath;
    console.log(`[Chromium I18n] Workspace path: ${workspacePath}`);

    // Detect Chromium root directory
    // This is crucial for correct path calculations and database isolation
    const chromiumRoot = findChromiumRoot(workspacePath);
    if (!chromiumRoot) {
      vscode.window.showWarningMessage(
        'Chromium I18n: Could not detect Chromium root directory. ' +
        'Please ensure you are working within a Chromium source tree.'
      );
      return;
    }
    console.log(`[Chromium I18n] Chromium root detected: ${chromiumRoot}`);

    // ==========================================
    // Phase 2: Initialize Core Services
    // ==========================================

    // Initialize ConfigService (T026-T028)
    configService.initialize(context);
    await configService.ensureMaskedApiKey();
    console.log('[Chromium I18n] ConfigService initialized');

    // Initialize QueryService with Chromium root (T019-T020)
    // Database file hash is now based on Chromium root, not workspace
    const queryService = QueryService.getInstance();
    await queryService.initialize(context, chromiumRoot);
    console.log('[Chromium I18n] QueryService initialized');

    // Initialize IndexService with Chromium root (T032)
    indexService.initialize(chromiumRoot);
    console.log('[Chromium I18n] IndexService initialized');

    // ==========================================
    // Phase 3: Auto Indexing (T038-T041)
    // ==========================================

    // Register rebuild index command (T039)
    registerRebuildIndexCommand(context, indexService);

    // Register file watchers (T038)
    fileWatchListener = new FileWatchListener(indexService);
    fileWatchListener.register(context);

    // Check for interrupted indexing task and handle recovery
    await checkAndHandleInterruptedIndexing(queryService, indexService);

    // Check if index exists, if not, prompt to build (T040-T041)
    const stats = await indexService.getIndexStats();
    if (stats.grdCount === 0) {
      const answer = await vscode.window.showInformationMessage(
        'No Chromium I18n index found. Would you like to build it now?',
        'Build Index',
        'Later'
      );

      if (answer === 'Build Index') {
        vscode.commands.executeCommand('chromiumI18n.rebuildIndex');
      }
    } else {
      console.log(
        `[Chromium I18n] Index loaded: ${stats.grdCount} GRD, ${stats.messageCount} messages, ${stats.translationCount} translations`
      );
    }

    // ==========================================
    // Phase 4: Register Providers and Commands (T042-T049)
    // ==========================================

    // Register HoverProvider (T044, T046, T047)
    const hoverProvider = new ChromiumI18nHoverProvider(queryService, configService);
    const hoverDisposable = vscode.languages.registerHoverProvider(
      [
        { language: 'cpp', scheme: 'file' },
        { language: 'objective-cpp', scheme: 'file' },
        { pattern: '**/*.mojom', scheme: 'file' },
        { pattern: '**/*.grd', scheme: 'file' },
        { pattern: '**/*.grdp', scheme: 'file' },
        { pattern: '**/*.xtb', scheme: 'file' },
      ],
      hoverProvider
    );
    context.subscriptions.push(hoverDisposable);
    console.log('[Chromium I18n] HoverProvider registered');

    // Register DefinitionProvider (T045)
    const definitionProvider = new ChromiumI18nDefinitionProvider(queryService, chromiumRoot);
    const definitionDisposable = vscode.languages.registerDefinitionProvider(
      [
        { language: 'cpp', scheme: 'file' },
        { language: 'objective-cpp', scheme: 'file' },
        { pattern: '**/*.mojom', scheme: 'file' },
      ],
      definitionProvider
    );
    context.subscriptions.push(definitionDisposable);
    console.log('[Chromium I18n] DefinitionProvider registered');

    // Register CompletionProvider (T064-T066)
    const completionProvider = new ChromiumI18nCompletionProvider(queryService, configService);
    const completionDisposable = vscode.languages.registerCompletionItemProvider(
      [
        { language: 'cpp', scheme: 'file' },
        { language: 'objective-cpp', scheme: 'file' },
        { pattern: '**/*.mojom', scheme: 'file' },
      ],
      completionProvider,
      '_',
    );
    context.subscriptions.push(completionDisposable);
    console.log('[Chromium I18n] CompletionProvider registered');

    // Register jumpToTranslation command (T049)
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.jumpToTranslation', (args) =>
        jumpToTranslationCommand(queryService, chromiumRoot, args)
      )
    );
    console.log('[Chromium I18n] jumpToTranslation command registered');

    // Register jumpToDefinition command (for hover links)
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.jumpToDefinition', (args) =>
        jumpToDefinitionCommand(queryService, chromiumRoot, args)
      )
    );
    console.log('[Chromium I18n] jumpToDefinition command registered');

    // ==========================================
    // Phase 5: Overlay Service (Translation Decorations)
    // ==========================================

    // Initialize overlay services
    const includeParserService = new IncludeParserService(queryService);
    const translationCacheService = new TranslationCacheService();
    const decorationProvider = new DecorationProvider(configService);

    // Create and initialize overlay service
    overlayService = new OverlayService(
      queryService,
      includeParserService,
      translationCacheService,
      decorationProvider,
      configService
    );

    await overlayService.initialize();
    console.log('[Chromium I18n] OverlayService initialized');

    // Register toggle overlay command (Cmd/Ctrl+Shift+I)
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.toggleOverlay', () => {
        if (overlayService) {
          overlayService.toggleOverlay();
        }
      })
    );
    console.log('[Chromium I18n] toggleOverlay command registered');

    // Register change overlay language command
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.changeOverlayLanguage', async () => {
        try {
          // Get all available languages from database
          const availableLanguages = await queryService.getAllLanguages();

          if (availableLanguages.length === 0) {
            vscode.window.showWarningMessage(
              'No translation languages found. Run "Rebuild i18n Index" first.'
            );
            return;
          }

          // Sort languages with priority for commonly used ones
          const sortedLanguages = getSortedLanguages(availableLanguages);

          // Create quick pick items with display names
          const languageItems = sortedLanguages.map((langCode) => ({
            label: getLanguageDisplayName(langCode),
            description: langCode,
            value: langCode,
          }));

          // Get current language
          const currentLocale = configService.getOverlayConfig().locale;
          const currentLanguage = languageItems.find((item) => item.value === currentLocale);

          // Show quick pick
          const selected = await vscode.window.showQuickPick(languageItems, {
            placeHolder: `Current language: ${currentLanguage?.label || currentLocale} (${availableLanguages.length} languages found)`,
            title: 'Select overlay language',
            matchOnDescription: true,
          });

          if (selected) {
            // Update configuration
            await configService.setOverlayLanguage(selected.value);
            vscode.window.showInformationMessage(`Overlay language switched to: ${selected.label}`);
          }
        } catch (error) {
          console.error('[Chromium I18n] Failed to change overlay language:', error);
          vscode.window.showErrorMessage(`Failed to change overlay language: ${error}`);
        }
      })
    );
    console.log('[Chromium I18n] changeOverlayLanguage command registered');

    // ==========================================
    // Phase 6: Additional Features
    // ==========================================

    // Dashboard WebView (T067-T075)
    dashboardView = new DashboardView(context, queryService, configService, chromiumRoot);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('chromiumI18nDashboard', dashboardView, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
    context.subscriptions.push({
      dispose: () => dashboardView?.dispose(),
    });
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.openDashboard', async () => {
        await dashboardView?.show();
      }),
    );
    console.log('[Chromium I18n] Dashboard view registered and command wired');

    // Global search command (T075)
    registerSearchCommand(context, queryService, chromiumRoot, configService);
    console.log('[Chromium I18n] search command registered');

    // AI Translation command (T058-T063)
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.aiTranslate', (args) => aiTranslateCommand(args))
    );
    console.log('[Chromium I18n] aiTranslate command registered');

    // Register createGrdMessage command
    context.subscriptions.push(
      vscode.commands.registerCommand('chromiumI18n.createGrdMessage', (uri) => createGrdMessageCommand(uri))
    );
    console.log('[Chromium I18n] createGrdMessage command registered');

    // TODO: Unused detection (T076-T081)

    console.log('Chromium I18n module activated successfully');
  } catch (error) {
    console.error('Failed to activate Chromium I18n module:', error);
    vscode.window.showErrorMessage(`Chromium I18n module failed to activate: ${error}`);
  }
}

/**
 * Deactivate the Chromium I18n module
 */
export function deactivate(): void {
  console.log('Chromium I18n module deactivating...');

  // Dispose overlay service
  if (overlayService) {
    overlayService.dispose();
    overlayService = null;
  }

  if (dashboardView) {
    dashboardView.dispose();
    dashboardView = null;
  }

  // Dispose file watchers
  if (fileWatchListener) {
    fileWatchListener.dispose();
    fileWatchListener = null;
  }

  // Close database connection
  const queryService = QueryService.getInstance();
  queryService.close();

  console.log('Chromium I18n module deactivated');
}

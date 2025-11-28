/**
 * Translation Overlay Service
 *
 * Orchestrates all overlay-related services to provide real-time translation
 * ghost text display for IDS constants in C++ source files.
 *
 * This service:
 * - Scans documents for IDS_* constants using regex
 * - Queries database for translations with caching
 * - Resolves GRD file priority from #include statements
 * - Applies decorations through DecorationProvider
 * - Manages debounced updates on document changes
 *
 * Architecture:
 *   OverlayService (orchestrator)
 *     ├─> QueryService (database queries)
 *     ├─> IncludeParserService (#include parsing)
 *     ├─> TranslationCacheService (per-document caching)
 *     └─> DecorationProvider (VSCode decorations)
 */

import * as vscode from 'vscode';
import { QueryService } from './queryService';
import { IncludeParserService } from './includeParserService';
import { TranslationCacheService, TranslationInfo } from './translationCacheService';
import { DecorationProvider, DecorationRange } from '../providers/decorationProvider';
import { ConfigService } from './configService';

/**
 * Service for managing translation overlays in C++ source files
 */
export class OverlayService {
  /** Regex to match IDS_* constants */
  private static readonly IDS_REGEX = /\bIDS_[A-Z0-9_]+\b/g;

  /** Debounce timeout in milliseconds */
  private static readonly DEBOUNCE_DELAY = 300;

  /** QueryService instance */
  private queryService: QueryService;

  /** IncludeParserService instance */
  private includeParserService: IncludeParserService;

  /** TranslationCacheService instance */
  private translationCacheService: TranslationCacheService;

  /** DecorationProvider instance */
  private decorationProvider: DecorationProvider;

  /** ConfigService instance */
  private configService: ConfigService;

  /** Debounce timers per document URI */
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  /** Disposables */
  private disposables: vscode.Disposable[] = [];

  constructor(
    queryService: QueryService,
    includeParserService: IncludeParserService,
    translationCacheService: TranslationCacheService,
    decorationProvider: DecorationProvider,
    configService: ConfigService
  ) {
    this.queryService = queryService;
    this.includeParserService = includeParserService;
    this.translationCacheService = translationCacheService;
    this.decorationProvider = decorationProvider;
    this.configService = configService;
  }

  /**
   * Initialize the overlay service
   * Sets up event listeners and applies decorations to active editors
   */
  public async initialize(): Promise<void> {
    console.log('[OverlayService] Initializing...');

    // Initialize include parser cache
    await this.includeParserService.initializeCache();

    // Register document change listeners
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onDocumentChange(event);
      })
    );

    // Register active editor change listener
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      })
    );

    // Register visible editors change listener
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.updateDecorations(editor);
        }
      })
    );

    // Register configuration change listener
    this.disposables.push(
      this.configService.onConfigurationChanged(() => {
        this.onConfigurationChanged();
      })
    );

    // Apply decorations to currently visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      await this.updateDecorations(editor);
    }

    console.log('[OverlayService] Initialized');
  }

  /**
   * Update decorations for a text editor
   *
   * @param editor VSCode text editor
   */
  public async updateDecorations(editor: vscode.TextEditor): Promise<void> {
    // Check if decorations should be shown
    if (!this.decorationProvider.shouldShowDecorations(editor)) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    const document = editor.document;

    // Check cache first
    if (this.translationCacheService.has(document)) {
      await this.applyDecorationsFromCache(editor);
      return;
    }

    // Scan for IDS constants and query translations
    await this.scanAndApplyDecorations(editor);
  }

  /**
   * Apply decorations from cache
   *
   * @param editor VSCode text editor
   */
  private async applyDecorationsFromCache(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const text = document.getText();

    // Find all IDS constants in document
    const idsNames = this.extractIdsNames(text);

    const decorations: DecorationRange[] = [];

    for (const idsName of idsNames) {
      const translationInfo = this.translationCacheService.get(document, idsName);
      if (!translationInfo) {
        continue;
      }

      // Find all occurrences of this IDS name
      const occurrences = this.findOccurrences(text, idsName);
      for (const position of occurrences) {
        const range = new vscode.Range(position, position);
        decorations.push({
          range,
          translation: translationInfo,
        });
      }
    }

    this.decorationProvider.applyDecorations(editor, decorations);
  }

  /**
   * Scan document for IDS constants and apply decorations
   *
   * @param editor VSCode text editor
   */
  private async scanAndApplyDecorations(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document;
    const text = document.getText();
    const config = this.configService.getOverlayConfig();

    // Find all IDS constants in document
    const idsNames = this.extractIdsNames(text);

    if (idsNames.length === 0) {
      this.decorationProvider.clearDecorations(editor);
      return;
    }

    // Get priority GRD paths from #include statements
    const priorityGrdPaths = await this.includeParserService.getPriorityGrdPaths(document);

    // Query translations for all IDS names
    const translationInfos: TranslationInfo[] = [];

    for (const idsName of idsNames) {
      const translationInfo = await this.getTranslationInfo(
        idsName,
        priorityGrdPaths,
        config.locale
      );

      if (translationInfo) {
        translationInfos.push(translationInfo);
      }
    }

    // Cache translations
    this.translationCacheService.batchSet(document, translationInfos);

    // Create decorations
    const decorations: DecorationRange[] = [];

    for (const translationInfo of translationInfos) {
      const occurrences = this.findOccurrences(text, translationInfo.idsName);
      for (const position of occurrences) {
        const range = new vscode.Range(position, position);
        decorations.push({
          range,
          translation: translationInfo,
        });
      }
    }

    this.decorationProvider.applyDecorations(editor, decorations);
  }

  /**
   * Get translation information for an IDS name
   *
   * Implements the priority resolution logic:
   * 1. Try priority GRD paths first (from #include)
   * 2. If multiple GRD files contain this IDS, show count indicator
   * 3. If no priority match, use first available translation
   *
   * @param idsName IDS constant name
   * @param priorityGrdPaths Priority GRD paths from #include parsing
   * @param locale Target locale (e.g., 'zh-CN')
   * @returns TranslationInfo or null if not found
   */
  private async getTranslationInfo(
    idsName: string,
    priorityGrdPaths: string[],
    locale: string
  ): Promise<TranslationInfo | null> {
    // Get all messages with this IDS name across all GRD files
    const allMessages = await this.queryService.getMessagesByName(idsName);

    if (allMessages.length === 0) {
      return null;
    }

    // Try priority GRD paths first
    if (priorityGrdPaths.length > 0) {
      for (const grdPath of priorityGrdPaths) {
        const message = allMessages.find((m) => m.grd_path === grdPath);
        if (message) {
          const translation = await this.queryService.getTranslation(message.id_hash, locale);
          if (translation) {
            // Collect translations from other GRD files
            const otherTranslations: Array<{ translation: string; grdPath: string }> = [];
            for (const otherMessage of allMessages) {
              if (otherMessage.grd_path !== grdPath && otherMessage.grd_path) {
                const otherTrans = await this.queryService.getTranslation(
                  otherMessage.id_hash,
                  locale
                );
                if (otherTrans) {
                  otherTranslations.push({
                    translation: otherTrans.text,
                    grdPath: otherMessage.grd_path,
                  });
                }
              }
            }

            return {
              idsName,
              translation: translation.text,
              additionalCount: otherTranslations.length,
              priorityGrdPath: grdPath,
              allTranslations: [
                { translation: translation.text, grdPath: message.grd_path || 'unknown' },
                ...otherTranslations,
              ],
              cachedAt: Date.now(),
            };
          }
        }
      }
    }

    // Fallback: use first available message
    const message = allMessages[0];
    const translation = await this.queryService.getTranslation(message.id_hash, locale);

    if (!translation) {
      return null;
    }

    // Collect translations from other GRD files
    const otherTranslations: Array<{ translation: string; grdPath: string }> = [];
    for (let i = 1; i < allMessages.length; i++) {
      const otherMessage = allMessages[i];
      if (otherMessage.grd_path) {
        const otherTrans = await this.queryService.getTranslation(otherMessage.id_hash, locale);
        if (otherTrans) {
          otherTranslations.push({
            translation: otherTrans.text,
            grdPath: otherMessage.grd_path,
          });
        }
      }
    }

    return {
      idsName,
      translation: translation.text,
      additionalCount: otherTranslations.length,
      allTranslations: [
        { translation: translation.text, grdPath: message.grd_path || 'unknown' },
        ...otherTranslations,
      ],
      cachedAt: Date.now(),
    };
  }

  /**
   * Extract all unique IDS names from text
   *
   * @param text Document text
   * @returns Array of unique IDS names
   */
  private extractIdsNames(text: string): string[] {
    const idsNames = new Set<string>();

    // Reset regex state
    OverlayService.IDS_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = OverlayService.IDS_REGEX.exec(text)) !== null) {
      idsNames.add(match[0]);
    }

    return Array.from(idsNames);
  }

  /**
   * Find all occurrences of an IDS name in text
   *
   * @param text Document text
   * @param idsName IDS name to find
   * @returns Array of positions where IDS name occurs
   */
  private findOccurrences(text: string, idsName: string): vscode.Position[] {
    const positions: vscode.Position[] = [];
    const regex = new RegExp(`\\b${idsName}\\b`, 'g');

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const line = text.substring(0, match.index).split('\n').length - 1;
      const character = match.index - text.lastIndexOf('\n', match.index - 1) - 1;
      positions.push(new vscode.Position(line, character));
    }

    return positions;
  }

  /**
   * Handle document change events with debouncing
   *
   * @param event Text document change event
   */
  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const uri = document.uri.toString();

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(uri);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(uri);

      // Invalidate cache for this document
      this.translationCacheService.invalidate(document);

      // Update decorations if document is visible
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === uri
      );
      if (editor) {
        this.updateDecorations(editor);
      }
    }, OverlayService.DEBOUNCE_DELAY);

    this.debounceTimers.set(uri, timer);
  }

  /**
   * Handle configuration changes
   */
  private onConfigurationChanged(): void {
    // Recreate decoration type with new style
    this.decorationProvider.recreateDecorationType();

    // Invalidate all caches
    this.translationCacheService.invalidateAll();

    // Refresh all visible editors
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateDecorations(editor);
    }
  }

  /**
   * Toggle overlay visibility
   */
  public async toggleOverlay(): Promise<void> {
    const newState = await this.configService.toggleOverlay();

    if (newState) {
      // Enabled: refresh all visible editors
      for (const editor of vscode.window.visibleTextEditors) {
        await this.updateDecorations(editor);
      }
    } else {
      // Disabled: clear all decorations
      this.decorationProvider.clearAllDecorations();
    }

    vscode.window.showInformationMessage(
      `Translation overlay ${newState ? 'enabled' : 'disabled'}`
    );
  }

  /**
   * Dispose of service resources
   */
  public dispose(): void {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Dispose all disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    // Dispose services
    this.translationCacheService.dispose();
    this.decorationProvider.dispose();
  }
}

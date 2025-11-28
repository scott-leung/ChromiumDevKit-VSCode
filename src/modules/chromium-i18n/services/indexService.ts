/**
 * Index Service
 * Manages the SQLite database index of GRD, GRDP, and XTB files
 * Provides incremental and full index updates
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IFile, IMessage, ITranslation } from '../models';
import { QueryService } from './queryService';
import { ParserService } from './parserService';

/**
 * IndexService
 * Coordinates index building and updates
 */
export class IndexService {
  private queryService: QueryService;
  private parserService: ParserService;
  private chromiumRoot: string | null = null;

  // Memory flag to prevent concurrent indexing within the same VSCode session
  private isIndexing: boolean = false;

  constructor() {
    this.queryService = QueryService.getInstance();
    this.parserService = new ParserService();
  }

  /**
   * Initialize IndexService with Chromium root path
   * @param chromiumRoot Absolute Chromium source root path
   */
  public initialize(chromiumRoot: string): void {
    this.chromiumRoot = chromiumRoot;
  }

  /**
   * Build full index from scratch (T032)
   * Scans workspace for all GRD files and indexes them with their dependencies
   * Supports interrupt recovery - can resume from previous incomplete indexing
   *
   * @param progress Optional progress reporter for UI updates
   * @param forceRestart If true, clears previous progress and starts fresh
   * @returns Number of files indexed
   */
  public async buildFullIndex(
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    forceRestart: boolean = false
  ): Promise<number> {
    if (!this.chromiumRoot) {
      throw new Error('IndexService not initialized with Chromium root path');
    }

    // Check memory flag to prevent concurrent indexing in same session
    if (this.isIndexing) {
      throw new Error('An indexing task is already running. Please wait for completion.');
    }

    this.isIndexing = true;

    try {
      progress?.report({ message: 'Scanning for GRD files...' });

      // Find all GRD files in Chromium tree
      const allGrdFiles = await this.findGRDFiles(this.chromiumRoot);

      if (allGrdFiles.length === 0) {
        vscode.window.showWarningMessage('No GRD files found in workspace');
        return 0;
      }

      // Determine which files to process (support resume)
      let grdFilesToProcess: string[];
      let alreadyProcessed = 0;

      if (forceRestart) {
        // Force restart: clear progress and process all files
        await this.queryService.clearProcessedFiles();
        grdFilesToProcess = allGrdFiles;
      } else {
        // Check if we can resume from previous progress
        const processedFiles = await this.queryService.getProcessedFiles();
        const processedSet = new Set(processedFiles);
        grdFilesToProcess = allGrdFiles.filter((file) => !processedSet.has(file));
        alreadyProcessed = processedFiles.length;

        if (grdFilesToProcess.length === 0 && alreadyProcessed > 0) {
          progress?.report({ message: 'All files already indexed!' });
          await this.queryService.updateIndexProgress({
            status: 'completed',
            last_update_time: Date.now(),
          });
          return alreadyProcessed;
        }

        // Clean up orphan data from interrupted indexing
        // This prevents orphan translation warnings when resuming
        if (grdFilesToProcess.length > 0 && alreadyProcessed > 0) {
          progress?.report({ message: 'Cleaning up incomplete data from previous run...' });
          await this.cleanupIncompleteIndexing(grdFilesToProcess);
        }
      }

      // Initialize progress tracking
      await this.queryService.updateIndexProgress({
        status: 'indexing',
        total_files: allGrdFiles.length,
        processed_count: alreadyProcessed,
        start_time: forceRestart ? Date.now() : Date.now(),
        last_update_time: Date.now(),
      });

      progress?.report({
        message: `Found ${allGrdFiles.length} GRD files (${alreadyProcessed} already indexed), indexing...`,
      });

      let indexedCount = 0;
      const increment = 100 / allGrdFiles.length;

      // Index each GRD file (which will also index its GRDP and XTB dependencies)
      for (const grdPath of grdFilesToProcess) {
        try {
          progress?.report({ message: `Indexing ${path.basename(grdPath)}...` });
          await this.updateGRD(grdPath);

          // Mark file as processed and update progress (atomic operation)
          await this.queryService.markFileAsProcessed(grdPath);
          await this.queryService.incrementProcessedCount();

          indexedCount++;
          progress?.report({ increment });
        } catch (error) {
          console.error(`Failed to index ${grdPath}:`, error);
          vscode.window.showErrorMessage(`Failed to index ${grdPath}: ${error}`);
        }
      }

      // Mark indexing as completed
      await this.queryService.updateIndexProgress({
        status: 'completed',
        last_update_time: Date.now(),
      });

      // Clean up processed files tracking
      await this.queryService.clearProcessedFiles();

      progress?.report({ message: 'Index complete!' });
      return alreadyProcessed + indexedCount;
    } finally {
      // Always release memory flag
      this.isIndexing = false;
    }
  }

  /**
   * Update GRD file in index (T033)
   * Parses GRD, extracts messages, and indexes referenced GRDP and XTB files
   *
   * @param grdPath Absolute path to GRD file
   */
  public async updateGRD(grdPath: string): Promise<void> {
    if (!this.chromiumRoot) {
      throw new Error('IndexService not initialized with Chromium root path');
    }

    // Read GRD file content
    const content = fs.readFileSync(grdPath, 'utf-8');
    const mtime = fs.statSync(grdPath).mtimeMs;

    // Parse GRD file
    const parseResult = this.parserService.parseGRD(content, grdPath);

    // Update file record
    await this.queryService.upsertFile({
      path: grdPath,
      type: 'grd',
      mtime,
      indexed_at: Date.now(),
    });

    // Delete old messages from this GRD
    await this.queryService.deleteMessagesByFile(grdPath);

    // Insert new messages
    for (const message of parseResult.messages) {
      await this.queryService.upsertMessage(message);
    }

    // Index referenced GRDP files
    for (const grdpRelPath of parseResult.grdpPaths) {
      const grdpAbsPath = this.resolveRelativePath(grdPath, grdpRelPath);
      if (fs.existsSync(grdpAbsPath)) {
        await this.updateGRDP(grdpAbsPath, grdPath);
      } else {
        console.warn(`GRDP file not found: ${grdpAbsPath}`);
      }
    }

    // Index referenced XTB files
    console.log(`[IndexService] Processing ${parseResult.xtbPatterns.length} XTB patterns from ${grdPath}`);
    for (const xtbPattern of parseResult.xtbPatterns) {
      console.log(`[IndexService] Resolving XTB path: ${xtbPattern.path} (lang: ${xtbPattern.lang})`);
      const xtbAbsPath = this.resolveRelativePath(grdPath, xtbPattern.path);
      console.log(`[IndexService] Resolved to absolute path: ${xtbAbsPath}`);

      if (fs.existsSync(xtbAbsPath)) {
        console.log(`[IndexService] ✅ XTB file exists, indexing: ${xtbAbsPath}`);
        await this.updateXTB(xtbAbsPath, xtbPattern.lang);
      } else {
        console.warn(`[IndexService] ❌ XTB file not found: ${xtbAbsPath} for lang ${xtbPattern.lang}`);
      }
    }
    console.log(`[IndexService] Finished processing XTB files for ${grdPath}`);
  }

  /**
   * Update GRDP file in index (T034)
   * Parses GRDP and extracts messages
   *
   * @param grdpPath Absolute path to GRDP file
   * @param parentGrdPath Parent GRD file path
   */
  public async updateGRDP(grdpPath: string, parentGrdPath: string): Promise<void> {
    // Read GRDP file content
    const content = fs.readFileSync(grdpPath, 'utf-8');
    const mtime = fs.statSync(grdpPath).mtimeMs;

    // Parse GRDP file
    const parseResult = this.parserService.parseGRDP(content, grdpPath, parentGrdPath);

    // Update file record
    await this.queryService.upsertFile({
      path: grdpPath,
      type: 'grdp',
      mtime,
      indexed_at: Date.now(),
      parent_grd: parentGrdPath,
    });

    // Delete messages that no longer exist after re-parse (preserves translations for unchanged IDs)
    const existingMessages = await this.queryService.getMessagesByFile(grdpPath);
    const existingHashes = new Set(existingMessages.map((m) => m.id_hash));
    const newHashes = new Set(parseResult.messages.map((m) => m.id_hash));
    const hashesToDelete = Array.from(existingHashes).filter((hash) => !newHashes.has(hash));
    if (hashesToDelete.length > 0) {
      await this.queryService.deleteMessagesByHash(hashesToDelete);
    }

    // Insert new messages
    for (const message of parseResult.messages) {
      await this.queryService.upsertMessage(message);
    }
  }

  /**
   * Update XTB file in index (T035)
   * Parses XTB and extracts translations
   *
   * @param xtbPath Absolute path to XTB file
   * @param lang Language code
   */
  public async updateXTB(xtbPath: string, lang: string): Promise<void> {
    console.log(`[IndexService] Updating XTB file: ${xtbPath} (lang: ${lang})`);

    // Read XTB file content
    const content = fs.readFileSync(xtbPath, 'utf-8');
    const mtime = fs.statSync(xtbPath).mtimeMs;

    // Parse XTB file
    const parseResult = this.parserService.parseXTB(content, xtbPath);
    console.log(`[IndexService] Parsed XTB: ${parseResult.translations.length} translations, detected lang: ${parseResult.lang}`);

    // Update file record
    await this.queryService.upsertFile({
      path: xtbPath,
      type: 'xtb',
      mtime,
      indexed_at: Date.now(),
      lang: parseResult.lang,
    });
    console.log(`[IndexService] XTB file record upserted`);

    // Delete old translations from this XTB
    await this.queryService.deleteTranslationsByFile(xtbPath);

    // Build a set of existing message hashes to avoid noisy orphan logs
    const existingMessageIds = await this.queryService.getAllMessageHashes();
    let orphanCount = 0;
    let insertedCount = 0;

    // Insert new translations
    for (const translation of parseResult.translations) {
      if (!existingMessageIds.has(translation.id_hash)) {
        orphanCount++;
        continue;
      }
      await this.queryService.upsertTranslation(translation, {
        skipMessageCheck: true,
        suppressOrphanLog: true,
      });
      insertedCount++;
    }

    if (orphanCount > 0) {
      const relativeXtb = this.chromiumRoot
        ? path.relative(this.chromiumRoot, xtbPath)
        : xtbPath;
      console.log(
        `[IndexService] Skipped ${orphanCount} translations in ${relativeXtb} (no matching messages; likely removed or stale IDs)`,
      );
    }

    console.log(
      `[IndexService] ✅ XTB indexing complete: ${insertedCount} translations inserted` +
        (orphanCount > 0 ? `, ${orphanCount} skipped as orphans` : ''),
    );
  }

  /**
   * Check if file needs update in index (T036)
   * Compares file mtime with indexed mtime
   *
   * @param filePath Absolute file path
   * @returns true if file needs reindexing
   */
  public async needsUpdate(filePath: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) {
      return false; // File deleted, will be handled by file watcher
    }

    const fileRecord = await this.queryService.getFile(filePath);
    if (!fileRecord) {
      return true; // Not indexed yet
    }

    const currentMtime = fs.statSync(filePath).mtimeMs;
    return currentMtime > fileRecord.mtime;
  }

  /**
   * Get parent GRD path for a GRDP file
   * Queries the database for the parent_grd field
   *
   * @param grdpPath Absolute GRDP file path
   * @returns Parent GRD path or null if not found
   */
  public async getParentGRDForGRDP(grdpPath: string): Promise<string | null> {
    const fileRecord = await this.queryService.getFile(grdpPath);
    if (!fileRecord) {
      return null; // File not indexed
    }

    return fileRecord.parent_grd || null;
  }

  /**
   * Get index statistics
   * @returns Object with file counts and message counts
   */
  public async getIndexStats(): Promise<{
    grdCount: number;
    grdpCount: number;
    xtbCount: number;
    messageCount: number;
    translationCount: number;
  }> {
    return this.queryService.getIndexStats();
  }

  /**
   * Resolve the parent GRD for a GRDP file, with fallbacks when the DB mapping is missing
   * @param grdpPath Absolute GRDP file path
   * @returns Parent GRD path or null if not found
   */
  public async resolveParentGRDForGRDP(grdpPath: string): Promise<string | null> {
    // 1) Try the files table first (normal path)
    const parentFromIndex = await this.getParentGRDForGRDP(grdpPath);
    if (parentFromIndex) {
      return parentFromIndex;
    }

    // 2) Try to infer from existing messages (handles stale/missing file records)
    try {
      const messages = await this.queryService.getMessagesByFile(grdpPath);
      const parentCandidates = Array.from(
        new Set(messages.map((msg) => msg.grd_path).filter((p): p is string => !!p))
      );
      if (parentCandidates.length > 0) {
        if (parentCandidates.length > 1) {
          console.warn(
            `[IndexService] Multiple parent GRDs found for ${grdpPath}, using ${parentCandidates[0]}`
          );
        }
        return parentCandidates[0];
      }
    } catch (error) {
      console.warn(`[IndexService] Unable to derive parent GRD from messages for ${grdpPath}:`, error);
    }

    // 3) As a last resort, scan GRD files to find the <part file="..."> reference
    const scannedParent = await this.findParentGRDByScanning(grdpPath);
    if (scannedParent) {
      return scannedParent;
    }

    return null;
  }

  /**
   * Resume interrupted indexing task
   * Continues from where the previous indexing stopped
   *
   * @param progress Optional progress reporter for UI updates
   * @returns Number of files indexed
   */
  public async resumeIndexing(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<number> {
    // Resume is just calling buildFullIndex with forceRestart=false
    // It will automatically skip already processed files
    return this.buildFullIndex(progress, false);
  }

  /**
   * Cancel current indexing task
   * Sets status to 'cancelled' and releases memory flag
   * Note: Cannot actually stop a running indexing loop, but marks it as cancelled
   */
  public async cancelIndexing(): Promise<void> {
    await this.queryService.updateIndexProgress({
      status: 'cancelled',
      last_update_time: Date.now(),
    });

    // Note: Memory flag will be released when buildFullIndex's finally block executes
    // We cannot force stop the running loop, but setting status helps other windows know
  }

  /**
   * Restart indexing from scratch
   * Clears all progress and starts fresh full index
   *
   * @param progress Optional progress reporter for UI updates
   * @returns Number of files indexed
   */
  public async restartIndexing(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<number> {
    // First reset the status to idle
    await this.queryService.updateIndexProgress({ status: 'idle' });
    await this.queryService.clearProcessedFiles();

    // Then start fresh indexing
    return this.buildFullIndex(progress, true);
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  /**
   * Clean up incomplete data from interrupted indexing
   * Deletes messages and translations for GRD files that were not fully processed
   * This prevents orphan translation warnings when resuming indexing
   *
   * @param unprocessedGrdFiles GRD files that need to be reprocessed
   */
  private async cleanupIncompleteIndexing(unprocessedGrdFiles: string[]): Promise<void> {
    for (const grdPath of unprocessedGrdFiles) {
      // Parse the GRD file to find its GRDP references
      // We need to clean up GRDP messages too, not just GRD messages
      try {
        if (fs.existsSync(grdPath)) {
          const content = fs.readFileSync(grdPath, 'utf-8');
          const parseResult = this.parserService.parseGRD(content, grdPath);

          // Delete messages from referenced GRDP files
          for (const grdpRelPath of parseResult.grdpPaths) {
            const grdpAbsPath = this.resolveRelativePath(grdPath, grdpRelPath);
            if (fs.existsSync(grdpAbsPath)) {
              await this.queryService.deleteMessagesByFile(grdpAbsPath);
            }
          }
        }
      } catch (error) {
        console.warn(`[IndexService] Failed to parse ${grdPath} during cleanup:`, error);
      }

      // Delete messages from the GRD file itself
      await this.queryService.deleteMessagesByFile(grdPath);

      // Note: We don't need to delete translations explicitly because:
      // 1. They have FOREIGN KEY constraints to messages (CASCADE DELETE)
      // 2. When messages are deleted, their translations are auto-deleted
      // 3. Even if not, upsertTranslation() checks for message existence
    }

    console.log(`[IndexService] Cleaned up incomplete data for ${unprocessedGrdFiles.length} unprocessed GRD files`);
  }

  /**
   * Fallback: scan GRD files to locate the <part file="..."> reference for a GRDP
   */
  private async findParentGRDByScanning(grdpPath: string): Promise<string | null> {
    if (!this.chromiumRoot) {
      return null;
    }

    const normalizeToPosix = (p: string) => p.split(path.sep).join('/');
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchesPartReference = (content: string, candidate: string) => {
      if (!candidate) return false;
      const normalized = normalizeToPosix(candidate);
      const regex = new RegExp(`<part[^>]+file=["']${escapeRegex(normalized)}["']`, 'i');
      return regex.test(content);
    };

    let grdCandidates: string[] = [];

    try {
      const indexedGrds = await this.queryService.getAllGRDFiles();
      grdCandidates = indexedGrds.map((f) => f.path);
    } catch (error) {
      console.warn(
        `[IndexService] Failed to read GRD list from index while scanning for parent of ${grdpPath}:`,
        error
      );
    }

    // If the index is empty, fall back to scanning the workspace
    if (grdCandidates.length === 0) {
      grdCandidates = await this.findGRDFiles(this.chromiumRoot);
    }

    const relativeToRoot = normalizeToPosix(path.relative(this.chromiumRoot, grdpPath));
    const seen = new Set<string>();

    for (const grdPath of grdCandidates) {
      if (seen.has(grdPath)) {
        continue;
      }
      seen.add(grdPath);

      let content: string;
      try {
        content = fs.readFileSync(grdPath, 'utf-8');
      } catch (error) {
        console.warn(
          `[IndexService] Skipping unreadable GRD while searching for parent of ${grdpPath}: ${grdPath}`,
          error
        );
        continue;
      }

      const relativeToGrd = normalizeToPosix(path.relative(path.dirname(grdPath), grdpPath));
      const trimmedRelative = relativeToGrd.startsWith('./') ? relativeToGrd.slice(2) : relativeToGrd;
      const basename = path.basename(grdpPath);
      const candidates = [relativeToGrd, trimmedRelative, relativeToRoot, basename];

      if (candidates.some((candidate) => matchesPartReference(content, candidate))) {
        console.log(`[IndexService] Found parent GRD for ${grdpPath} by scanning: ${grdPath}`);
        return grdPath;
      }
    }

   return null;
  }

  /**
   * Find all GRD files in workspace (T037)
   * @param workspacePath Workspace root path (Chromium root)
   * @returns Array of absolute GRD file paths
   */
  private async findGRDFiles(workspacePath: string): Promise<string[]> {
    const results: string[] = [];
    const stack: string[] = [workspacePath];
    const skipDirs = new Set(['node_modules', '.git', 'out']);

    while (stack.length > 0) {
      const current = stack.pop() as string;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (error) {
        console.warn(`[IndexService] Skipping unreadable directory: ${current}`, error);
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            stack.push(fullPath);
          }
          continue;
        }

        if (entry.isFile() && entry.name.endsWith('.grd')) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }

  /**
   * Resolve relative path from GRD file
   * Handles paths like "../strings/translations.xtb"
   *
   * @param grdPath Absolute GRD file path
   * @param relativePath Relative path from GRD
   * @returns Absolute path
   */
  private resolveRelativePath(grdPath: string, relativePath: string): string {
    const grdDir = path.dirname(grdPath);

    // Primary resolution: relative to the GRD directory
    const direct = path.resolve(grdDir, relativePath);
    if (fs.existsSync(direct)) {
      return direct;
    }

    // Fallback: climb up towards Chromium root to handle GRDPs/XTBs placed in parent dirs
    const candidates: string[] = [];
    let current = grdDir;
    const root = this.chromiumRoot || path.parse(grdDir).root;

    while (true) {
      current = path.dirname(current);
      const candidate = path.resolve(current, relativePath);
      candidates.push(candidate);

      if (fs.existsSync(candidate)) {
        return candidate;
      }

      if (current === root) {
        break;
      }

      if (this.chromiumRoot && current === this.chromiumRoot) {
        break;
      }
    }

    // If still not found, return the direct path so callers can log a clear warning
    return direct;
  }
}

// Export singleton instance
export const indexService = new IndexService();

/**
 * File Watch Listener
 * Monitors GRD, GRDP, and XTB file changes and updates the index incrementally
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { IndexService } from '../services/indexService';

/**
 * FileWatchListener
 * Registers file system watchers and updates index on file changes
 */
export class FileWatchListener {
  private indexService: IndexService;
  private watchers: vscode.FileSystemWatcher[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(indexService: IndexService) {
    this.indexService = indexService;
  }

  /**
   * Register file watchers for GRD, GRDP, and XTB files
   * @param context Extension context for disposables
   */
  public register(context: vscode.ExtensionContext): void {
    // Watch GRD files
    const grdWatcher = vscode.workspace.createFileSystemWatcher('**/*.grd');
    this.watchers.push(grdWatcher);

    grdWatcher.onDidCreate(uri => this.onFileCreated(uri, 'grd'), null, this.disposables);
    grdWatcher.onDidChange(uri => this.onFileChanged(uri, 'grd'), null, this.disposables);
    grdWatcher.onDidDelete(uri => this.onFileDeleted(uri, 'grd'), null, this.disposables);

    // Watch GRDP files
    const grdpWatcher = vscode.workspace.createFileSystemWatcher('**/*.grdp');
    this.watchers.push(grdpWatcher);

    grdpWatcher.onDidCreate(uri => this.onFileCreated(uri, 'grdp'), null, this.disposables);
    grdpWatcher.onDidChange(uri => this.onFileChanged(uri, 'grdp'), null, this.disposables);
    grdpWatcher.onDidDelete(uri => this.onFileDeleted(uri, 'grdp'), null, this.disposables);

    // Watch XTB files
    const xtbWatcher = vscode.workspace.createFileSystemWatcher('**/*.xtb');
    this.watchers.push(xtbWatcher);

    xtbWatcher.onDidCreate(uri => this.onFileCreated(uri, 'xtb'), null, this.disposables);
    xtbWatcher.onDidChange(uri => this.onFileChanged(uri, 'xtb'), null, this.disposables);
    xtbWatcher.onDidDelete(uri => this.onFileDeleted(uri, 'xtb'), null, this.disposables);

    // Register disposables
    context.subscriptions.push(...this.watchers);
    context.subscriptions.push(...this.disposables);

    console.log('[FileWatchListener] File watchers registered for GRD, GRDP, XTB files');
  }

  /**
   * Handle file creation event
   */
  private async onFileCreated(uri: vscode.Uri, fileType: 'grd' | 'grdp' | 'xtb'): Promise<void> {
    const filePath = uri.fsPath;
    console.log(`[FileWatchListener] File created: ${filePath} (${fileType})`);

    try {
      await this.updateFile(filePath, fileType);
      vscode.window.showInformationMessage(`Indexed new ${fileType.toUpperCase()} file: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Failed to index new file ${filePath}:`, error);
      vscode.window.showErrorMessage(`Failed to index ${path.basename(filePath)}: ${error}`);
    }
  }

  /**
   * Handle file change event
   */
  private async onFileChanged(uri: vscode.Uri, fileType: 'grd' | 'grdp' | 'xtb'): Promise<void> {
    const filePath = uri.fsPath;
    console.log(`[FileWatchListener] File changed: ${filePath} (${fileType})`);

    try {
      // Check if file actually needs update (avoid redundant reindexing)
      const needsUpdate = await this.indexService.needsUpdate(filePath);
      if (!needsUpdate) {
        console.log(`[FileWatchListener] File ${filePath} already up to date, skipping`);
        return;
      }

      await this.updateFile(filePath, fileType);
      console.log(`[FileWatchListener] Reindexed ${filePath}`);
    } catch (error) {
      console.error(`Failed to reindex file ${filePath}:`, error);
      vscode.window.showErrorMessage(`Failed to reindex ${path.basename(filePath)}: ${error}`);
    }
  }

  /**
   * Handle file deletion event
   */
  private async onFileDeleted(uri: vscode.Uri, fileType: 'grd' | 'grdp' | 'xtb'): Promise<void> {
    const filePath = uri.fsPath;
    console.log(`[FileWatchListener] File deleted: ${filePath} (${fileType})`);

    try {
      // TODO: Implement file deletion from index
      // This requires cascade deletion of messages/translations
      // For now, just log the event
      console.log(`[FileWatchListener] File deletion not yet implemented for ${filePath}`);
    } catch (error) {
      console.error(`Failed to handle file deletion ${filePath}:`, error);
    }
  }

  /**
   * Update file in index based on file type
   */
  private async updateFile(filePath: string, fileType: 'grd' | 'grdp' | 'xtb'): Promise<void> {
    switch (fileType) {
      case 'grd':
        await this.indexService.updateGRD(filePath);
        break;

      case 'grdp':
        // For GRDP, we need to find the parent GRD file from database
        // The parent GRD was set during initial indexing
        const parentGrd = await this.indexService.resolveParentGRDForGRDP(filePath);
        if (!parentGrd) {
          throw new Error(`Cannot find parent GRD for GRDP file: ${filePath}. Please rebuild the index.`);
        }
        await this.indexService.updateGRDP(filePath, parentGrd);
        break;

      case 'xtb':
        // For XTB, we need to extract language from file
        // The language will be extracted from the XTB content during parsing
        await this.indexService.updateXTB(filePath, '');
        break;
    }
  }

  /**
   * Dispose all watchers
   */
  public dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.watchers = [];
    this.disposables = [];
    console.log('[FileWatchListener] File watchers disposed');
  }
}

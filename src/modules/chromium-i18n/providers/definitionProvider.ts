/**
 * Definition Provider for Chromium I18n extension
 * Allows jumping to IDS constant definitions in GRD/GRDP files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QueryService } from '../services/queryService';
import { extractIDSAtPosition } from '../utils/pathUtils';

/**
 * Chromium I18n Definition Provider
 * Implements "Go to Definition" functionality for IDS constants
 */
export class ChromiumI18nDefinitionProvider implements vscode.DefinitionProvider {
  private queryService: QueryService;
  private chromiumRoot: string;

  constructor(queryService: QueryService, chromiumRoot: string) {
    this.queryService = queryService;
    this.chromiumRoot = chromiumRoot;
  }

  /**
   * Provide definition location for IDS constants
   *
   * @param document Current text document
   * @param position Cursor position
   * @param token Cancellation token
   * @returns Location of the IDS definition
   */
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Location | vscode.Location[] | undefined> {
    // Check if cancelled
    if (token.isCancellationRequested) {
      return undefined;
    }

    // Get text and cursor offset
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Extract IDS constant at cursor position
    const idsName = extractIDSAtPosition(text, offset);
    if (!idsName) {
      return undefined;
    }

    // Query database for message
    const message = await this.queryService.getMessageByName(idsName);
    if (!message) {
      return undefined;
    }

    // Determine source file (prefer GRDP over GRD)
    const sourcePath = message.grdp_path || message.grd_path;
    if (!sourcePath) {
      console.warn(`[DefinitionProvider] No source path for ${idsName}`);
      return undefined;
    }

    const absolutePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(this.chromiumRoot, sourcePath);

    // Check if file exists
    try {
      const uri = vscode.Uri.file(absolutePath);
      await vscode.workspace.fs.stat(uri);

      // Create location pointing to the message definition
      // Ensure line number is valid (>= 0)
      const startLine = message.start_line ?? 1;
      const lineNumber = Math.max(0, startLine - 1); // Convert to 0-based, ensure non-negative
      const position = new vscode.Position(lineNumber, 0);
      const range = new vscode.Range(position, position);

      console.log(`[DefinitionProvider] ${idsName}: start_line=${message.start_line}, lineNumber=${lineNumber}`);

      return new vscode.Location(uri, range);
    } catch (error) {
      console.error(`[DefinitionProvider] File not found: ${absolutePath}`, error);
      vscode.window.showWarningMessage(
        `Definition file not found for ${idsName}: ${sourcePath}`
      );
      return undefined;
    }
  }
}

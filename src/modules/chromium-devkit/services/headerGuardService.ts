import * as vscode from 'vscode';
import { HeaderGuard } from '../models/headerGuard';
import { FileInfo } from '../models/fileInfo';
import { PathService } from './pathService';

/**
 * Service for generating and inserting header guards
 */
export class HeaderGuardService {
  /**
   * Generate header guard macro name from file info
   * @param fileInfo File information
   * @param style Macro name style (uppercase or lowercase)
   */
  public static generateMacroName(
    fileInfo: FileInfo,
    style: 'uppercase' | 'lowercase',
  ): string {
    return PathService.generateHeaderGuardMacroName(fileInfo, style);
  }

  /**
   * Generate complete header guard structure
   * @param fileInfo File information
   * @param style Macro name style (uppercase or lowercase)
   */
  public static generateHeaderGuard(
    fileInfo: FileInfo,
    style: 'uppercase' | 'lowercase',
  ): HeaderGuard {
    const macroName = this.generateMacroName(fileInfo, style);

    return {
      macroName,
      ifndef: `#ifndef ${macroName}`,
      define: `#define ${macroName}`,
      endif: `#endif  // ${macroName}`,
    };
  }

  /**
   * Insert header guard into document after banner
   * @param editor Text editor
   * @param headerGuard Header guard to insert
   * @param bannerLineCount Number of lines in the banner
   */
  public static async insertHeaderGuard(
    editor: vscode.TextEditor,
    headerGuard: HeaderGuard,
    bannerLineCount: number,
  ): Promise<void> {
    // First, insert #ifndef and #define after banner
    const headerGuardStart = `${headerGuard.ifndef}\n${headerGuard.define}\n\n`;
    const insertPosition = new vscode.Position(bannerLineCount, 0);

    const startEdit = new vscode.WorkspaceEdit();
    startEdit.insert(editor.document.uri, insertPosition, headerGuardStart);
    await vscode.workspace.applyEdit(startEdit);

    // Then, insert #endif at the end of the file (after the first edit is applied)
    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
    const endPosition = lastLine.range.end;
    const endifContent = `\n${headerGuard.endif}\n`;

    const endEdit = new vscode.WorkspaceEdit();
    endEdit.insert(editor.document.uri, endPosition, endifContent);
    await vscode.workspace.applyEdit(endEdit);
  }
}

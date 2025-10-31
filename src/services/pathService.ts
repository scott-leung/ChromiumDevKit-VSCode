import * as path from 'path';
import * as vscode from 'vscode';
import { FileInfo } from '../models/fileInfo';
import { pathToMacroName, normalizePathSeparators } from '../utils/stringUtils';

/**
 * Service for path calculations and header guard macro generation
 */
export class PathService {
  /**
   * Create FileInfo from URI
   */
  public static createFileInfo(uri: vscode.Uri): FileInfo | null {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return null;
    }

    const absolutePath = uri.fsPath;
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const relativePath = path.relative(workspaceRoot, absolutePath);
    const fileName = path.basename(absolutePath);
    const extension = path.extname(absolutePath);
    const baseName = path.basename(absolutePath, extension);

    return {
      absolutePath,
      relativePath: normalizePathSeparators(relativePath),
      fileName,
      baseName,
      extension,
      workspaceRoot,
    };
  }

  /**
   * Generate header guard macro name from file path
   * @param fileInfo File information
   * @param style Macro name style (uppercase or lowercase)
   */
  public static generateHeaderGuardMacroName(
    fileInfo: FileInfo,
    style: 'uppercase' | 'lowercase',
  ): string {
    return pathToMacroName(fileInfo.relativePath, style);
  }

  /**
   * Check if file is a header file (.h)
   */
  public static isHeaderFile(fileInfo: FileInfo): boolean {
    return fileInfo.extension.toLowerCase() === '.h';
  }

  /**
   * Check if file is an implementation file (.cc, .cpp, .mm)
   */
  public static isImplementationFile(fileInfo: FileInfo): boolean {
    const ext = fileInfo.extension.toLowerCase();
    return ext === '.cc' || ext === '.cpp' || ext === '.mm';
  }

  /**
   * Check if file is a Mojom IDL file (.mojom)
   */
  public static isMojomFile(fileInfo: FileInfo): boolean {
    return fileInfo.extension.toLowerCase() === '.mojom';
  }

  /**
   * Check if file is an IDL file (.idl)
   */
  public static isIdlFile(fileInfo: FileInfo): boolean {
    return fileInfo.extension.toLowerCase() === '.idl';
  }

  /**
   * Get corresponding header file path for implementation file
   * @param fileInfo Implementation file info
   * @returns Header file path relative to workspace root
   */
  public static getCorrespondingHeaderPath(fileInfo: FileInfo): string {
    const headerPath = fileInfo.relativePath.replace(/\.(cc|cpp|mm)$/i, '.h');
    return headerPath;
  }
}

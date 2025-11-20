import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { FileInfo } from '../models/fileInfo';
import { pathToMacroName, normalizePathSeparators } from '../../../shared/utils/stringUtils';

/**
 * Service for path calculations and header guard macro generation
 */
export class PathService {
  /**
   * Find the Chromium root directory for a given path
   * @param currentPath File path to start searching from
   */
  public static findChromiumRoot(currentPath: string): string | null {
    let dir = currentPath;
    const root = path.parse(dir).root;

    while (true) {
      // 1. Check for .gn file
      const gnPath = path.join(dir, '.gn');
      if (fs.existsSync(gnPath)) {
        // 2. Double Check: Check for chromium specific directories
        const hasChromeDir = fs.existsSync(path.join(dir, 'chrome'));
        const hasContentDir = fs.existsSync(path.join(dir, 'content'));

        // If it has chrome or content dir, and .gn, it's likely Chromium root
        if (hasChromeDir || hasContentDir) {
          return dir;
        }
      }

      // 3. Check for .gclient (parent level marker)
      const gclientPath = path.join(dir, '.gclient');
      if (fs.existsSync(gclientPath)) {
        // If found .gclient, usually the src subdirectory is Chromium
        const srcPath = path.join(dir, 'src');
        if (fs.existsSync(srcPath)) {
          return srcPath;
        }
      }

      // 4. Stop at system root
      if (dir === root) {
        break;
      }

      // 5. Go up
      dir = path.dirname(dir);
    }

    return null;
  }

  /**
   * Create FileInfo from URI
   */
  public static createFileInfo(uri: vscode.Uri): FileInfo | null {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      return null;
    }

    const absolutePath = uri.fsPath;
    let workspaceRoot = workspaceFolder.uri.fsPath;

    // Try to detect Chromium root to support subdirectory opening
    const chromiumRoot = this.findChromiumRoot(absolutePath);
    if (chromiumRoot) {
      // Use Chromium root as workspace root for path calculations
      workspaceRoot = chromiumRoot;
    }

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

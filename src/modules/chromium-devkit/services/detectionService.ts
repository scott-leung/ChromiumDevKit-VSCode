import * as vscode from 'vscode';

/**
 * Service for detecting existing banners and header guards in files
 */
export class DetectionService {
  /**
   * Detect if file already has a banner at the top
   * Checks for comment blocks that likely contain banner information
   * @param document Document to check
   * @returns Range of detected banner, or null if none found
   */
  public static detectBanner(document: vscode.TextDocument): vscode.Range | null {
    // Look for comment blocks at the start of the file (first 50 lines)
    let endLine = -1;
    let inComment = false;
    let foundCommentContent = false;

    for (let i = 0; i < Math.min(document.lineCount, 50); i++) {
      const line = document.lineAt(i).text.trim();

      // Empty lines before any comment are okay
      if (!inComment && line.length === 0) {
        continue;
      }

      // Start of block comment (/* )
      if (line.startsWith('/*')) {
        inComment = true;
        foundCommentContent = true;
        endLine = i;
        continue;
      }

      // Single-line comment (//)
      if (line.startsWith('//')) {
        foundCommentContent = true;
        endLine = i;
        inComment = true; // Treat consecutive // as a comment block
        continue;
      }

      // Within block comment
      if (inComment && (line.startsWith('*') || line.includes('*/'))) {
        endLine = i;
        if (line.includes('*/')) {
          // End of block comment
          break;
        }
        continue;
      }

      // Preprocessor directive (#ifndef, #define) - stop banner detection here
      if (line.startsWith('#')) {
        break;
      }

      // Any other non-comment, non-empty line means we've passed the banner section
      if (line.length > 0 && !inComment) {
        break;
      }

      // If we were in a comment block (//) and hit non-comment, banner ends
      if (inComment && !line.startsWith('//') && !line.startsWith('*') && line.length > 0) {
        break;
      }
    }

    if (foundCommentContent && endLine >= 0) {
      // Include the line after the banner (typically a blank line)
      const rangeEnd = Math.min(endLine + 2, document.lineCount);
      return new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(rangeEnd, 0),
      );
    }

    return null;
  }

  /**
   * Detect if file has header guard (#ifndef, #define, #endif pattern)
   * @param document Document to check
   * @returns Object with header guard info, or null if not found
   */
  public static detectHeaderGuard(document: vscode.TextDocument): {
    macroName: string;
    ifndefLine: number;
    defineLine: number;
    endifLine: number;
  } | null {
    let ifndefLine = -1;
    let defineLine = -1;
    let endifLine = -1;
    let macroName = '';

    // Search for #ifndef at the top (after potential banner)
    for (let i = 0; i < Math.min(document.lineCount, 100); i++) {
      const line = document.lineAt(i).text.trim();

      if (line.startsWith('#ifndef')) {
        const match = line.match(/#ifndef\s+([A-Z_a-z0-9]+)/);
        if (match) {
          ifndefLine = i;
          macroName = match[1];
          break;
        }
      }
    }

    if (ifndefLine === -1) {
      return null;
    }

    // Look for matching #define on next non-empty line
    for (let i = ifndefLine + 1; i < Math.min(ifndefLine + 5, document.lineCount); i++) {
      const line = document.lineAt(i).text.trim();

      if (line.length === 0) {
        continue;
      }

      if (line.startsWith(`#define ${macroName}`)) {
        defineLine = i;
        break;
      } else {
        // #define not found where expected
        return null;
      }
    }

    if (defineLine === -1) {
      return null;
    }

    // Look for #endif with comment at the end of file
    for (let i = document.lineCount - 1; i >= document.lineCount - 50 && i >= 0; i--) {
      const line = document.lineAt(i).text.trim();

      if (line.includes('#endif') && line.includes(macroName)) {
        endifLine = i;
        break;
      }
    }

    if (endifLine === -1) {
      return null;
    }

    return {
      macroName,
      ifndefLine,
      defineLine,
      endifLine,
    };
  }
}

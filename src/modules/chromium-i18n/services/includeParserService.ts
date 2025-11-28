/**
 * Service for parsing #include statements in C++ files to resolve GRD basenames.
 *
 * This service extracts grit-generated header includes and maps them to their
 * corresponding GRD files using basename matching.
 *
 * Example:
 *   #include "components/strings/grit/components_strings.h"
 *   → Extracts basename: "components_strings"
 *   → Queries files table to find matching GRD file
 */

import * as vscode from 'vscode';
import { QueryService } from './queryService';

/**
 * Parsed include information from C++ source files
 */
interface ParsedInclude {
  /** Original include statement */
  statement: string;
  /** Extracted include path (e.g., "components/strings/grit/components_strings.h") */
  path: string;
  /** Basename extracted from path (e.g., "components_strings") */
  basename: string;
  /** Line number where include appears */
  line: number;
}

/**
 * Service for parsing #include statements and resolving GRD basenames
 */
export class IncludeParserService {
  /** Regex to match grit-generated header includes */
  private static readonly GRIT_INCLUDE_REGEX = /#include\s+["<]([^">]+\/grit\/([a-z_]+)\.h)[">]/gi;

  /** In-memory cache: basename → GRD file paths (can have multiple matches) */
  private basenameToGrdCache: Map<string, string[]> = new Map();

  /** QueryService instance for database queries */
  private queryService: QueryService;

  constructor(queryService: QueryService) {
    this.queryService = queryService;
  }

  /**
   * Initialize the basename → GRD cache from database
   * Should be called once on service activation
   */
  public async initializeCache(): Promise<void> {
    try {
      const grdFiles = await this.queryService.getAllGRDFiles();

      this.basenameToGrdCache.clear();

      for (const file of grdFiles) {
        const basename = this.extractBasenameFromPath(file.path);
        if (basename) {
          const existing = this.basenameToGrdCache.get(basename) || [];
          existing.push(file.path);
          this.basenameToGrdCache.set(basename, existing);
        }
      }

      console.log(`[IncludeParser] Initialized basename cache with ${this.basenameToGrdCache.size} entries`);
    } catch (error) {
      console.error('[IncludeParser] Failed to initialize cache:', error);
      throw error;
    }
  }

  /**
   * Rebuild the basename cache (call when files are added/removed)
   */
  public async rebuildCache(): Promise<void> {
    await this.initializeCache();
  }

  /**
   * Parse all #include statements from a document
   *
   * @param document VSCode text document
   * @returns Array of parsed include information
   */
  public parseIncludes(document: vscode.TextDocument): ParsedInclude[] {
    const includes: ParsedInclude[] = [];
    const text = document.getText();

    // Reset regex state
    IncludeParserService.GRIT_INCLUDE_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = IncludeParserService.GRIT_INCLUDE_REGEX.exec(text)) !== null) {
      const statement = match[0];
      const path = match[1];
      const basename = match[2];
      const line = document.positionAt(match.index).line;

      includes.push({
        statement,
        path,
        basename,
        line
      });
    }

    return includes;
  }

  /**
   * Get priority GRD paths based on #include statements in document
   *
   * @param document VSCode text document
   * @returns Array of GRD file paths that should be prioritized for this document
   */
  public async getPriorityGrdPaths(document: vscode.TextDocument): Promise<string[]> {
    const includes = this.parseIncludes(document);
    const priorityPaths: Set<string> = new Set();

    for (const include of includes) {
      const grdPaths = this.basenameToGrdCache.get(include.basename);
      if (grdPaths) {
        grdPaths.forEach(path => priorityPaths.add(path));
      }
    }

    return Array.from(priorityPaths);
  }

  /**
   * Get priority GRD path for a specific IDS name based on document includes
   *
   * This method:
   * 1. Parses #include statements to find referenced grit headers
   * 2. Extracts basenames from those headers
   * 3. Looks up matching GRD files
   * 4. Returns the first matching GRD path that contains the IDS name
   *
   * @param document VSCode text document
   * @param idsName IDS constant name (e.g., "IDS_APP_TITLE")
   * @returns Priority GRD path if found, null otherwise
   */
  public async getPriorityGrdPathForIds(
    document: vscode.TextDocument,
    idsName: string
  ): Promise<string | null> {
    const priorityPaths = await this.getPriorityGrdPaths(document);

    if (priorityPaths.length === 0) {
      return null;
    }

    // Check if the IDS name exists in any of the priority GRD files
    for (const grdPath of priorityPaths) {
      const message = await this.queryService.getMessageByNameAndGrd(idsName, grdPath);
      if (message) {
        return grdPath;
      }
    }

    return null;
  }

  /**
   * Extract basename from GRD file path
   *
   * Examples:
   *   "chrome/app/generated_resources.grd" → "generated_resources"
   *   "components/strings/components_strings.grd" → "components_strings"
   *
   * @param path GRD file path (relative or absolute)
   * @returns Basename without extension, or null if not a valid GRD path
   */
  private extractBasenameFromPath(path: string): string | null {
    // Extract filename from path
    const filename = path.split('/').pop() || path.split('\\').pop();
    if (!filename) {
      return null;
    }

    // Remove .grd extension
    if (!filename.endsWith('.grd')) {
      return null;
    }

    return filename.slice(0, -4); // Remove '.grd'
  }

  /**
   * Get all basenames currently in cache (for debugging)
   */
  public getCachedBasenames(): string[] {
    return Array.from(this.basenameToGrdCache.keys());
  }

  /**
   * Get GRD paths for a specific basename (for debugging)
   */
  public getGrdPathsForBasename(basename: string): string[] {
    return this.basenameToGrdCache.get(basename) || [];
  }
}

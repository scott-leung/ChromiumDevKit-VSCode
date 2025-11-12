/**
 * File metadata for C++ files
 */
export interface FileInfo {
  /** Absolute path to the file */
  absolutePath: string;

  /** Relative path from workspace root */
  relativePath: string;

  /** File name with extension (e.g., "test.h") */
  fileName: string;

  /** File base name without extension (e.g., "test") */
  baseName: string;

  /** File extension (e.g., ".h") */
  extension: string;

  /** Workspace root directory */
  workspaceRoot: string;
}

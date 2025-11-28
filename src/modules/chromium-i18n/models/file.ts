/**
 * File entity interface
 * Represents a GRD, GRDP, or XTB file in the database
 */
export interface IFile {
  /** Primary key */
  id?: number;

  /** Absolute file path */
  path: string;

  /** File type: 'grd', 'grdp', or 'xtb' */
  type: 'grd' | 'grdp' | 'xtb';

  /** File modification time (timestamp in milliseconds) */
  mtime: number;

  /** Last indexed time (timestamp in milliseconds) */
  indexed_at: number;

  /** For XTB files: language code (e.g., 'zh-CN', 'ja', 'fr') */
  lang?: string;

  /** For GRDP files: parent GRD file path */
  parent_grd?: string;
}

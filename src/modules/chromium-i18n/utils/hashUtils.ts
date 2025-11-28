/**
 * Hash utility functions
 * Used for generating stable identifiers from Chromium root paths
 */

import * as crypto from 'crypto';

/**
 * Generate a stable hash from Chromium root path
 * Used to create isolated database files for different Chromium checkouts
 *
 * @param chromiumRoot Chromium root path (absolute)
 * @returns 16-character hexadecimal hash
 *
 * @example
 * ```ts
 * const hash = hashChromiumRoot('/Users/user/chromium/src');
 * // Returns: 'a1b2c3d4e5f6g7h8'
 * // Database file: chromium-i18n-a1b2c3d4e5f6g7h8.db
 * ```
 */
export function hashChromiumRoot(chromiumRoot: string): string {
  const hash = crypto.createHash('md5').update(chromiumRoot, 'utf8').digest('hex');
  // Return first 16 characters for a reasonably unique identifier
  return hash.substring(0, 16);
}

/**
 * @deprecated Use hashChromiumRoot instead
 */
export function hashWorkspacePath(workspacePath: string): string {
  return hashChromiumRoot(workspacePath);
}

/**
 * Generate database file name for a Chromium project
 *
 * @param chromiumRoot Chromium root path (absolute)
 * @returns Database file name (e.g., 'chromium-i18n-a1b2c3d4e5f6g7h8.db')
 */
export function getDatabaseFileName(chromiumRoot: string): string {
  const hash = hashChromiumRoot(chromiumRoot);
  return `chromium-i18n-${hash}.db`;
}

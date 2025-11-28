import * as path from 'path';
import * as fs from 'fs';

/**
 * Chromium project detection utilities
 * Shared across multiple modules
 */

/**
 * Find the Chromium root directory for a given path
 * Searches upward from the given path to find the Chromium source root
 *
 * Detection strategy:
 * 1. Look for .gn file (GN build system marker)
 * 2. Verify existence of chrome/ or content/ directories
 * 3. Check for .gclient file (parent level marker) and use src/ subdirectory
 *
 * @param currentPath File or directory path to start searching from
 * @returns Chromium root path or null if not found
 *
 * @example
 * ```ts
 * // From /Users/user/chromium/src/chrome/browser/test.cc
 * findChromiumRoot('/Users/user/chromium/src/chrome/browser/test.cc')
 * // Returns: '/Users/user/chromium/src'
 * ```
 */
export function findChromiumRoot(currentPath: string): string | null {
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
 * Convert absolute path to relative path from Chromium root
 *
 * @param absolutePath Absolute file path
 * @param chromiumRoot Chromium root directory path
 * @returns Relative path from Chromium root
 *
 * @example
 * ```ts
 * toRelativePath(
 *   '/Users/user/chromium/src/chrome/browser/test.cc',
 *   '/Users/user/chromium/src'
 * )
 * // Returns: 'chrome/browser/test.cc'
 * ```
 */
export function toRelativePath(absolutePath: string, chromiumRoot: string): string {
  return path.relative(chromiumRoot, absolutePath);
}

/**
 * Convert relative path to absolute path using Chromium root
 *
 * @param relativePath Relative path from Chromium root
 * @param chromiumRoot Chromium root directory path
 * @returns Absolute file path
 *
 * @example
 * ```ts
 * toAbsolutePath(
 *   'chrome/browser/test.cc',
 *   '/Users/user/chromium/src'
 * )
 * // Returns: '/Users/user/chromium/src/chrome/browser/test.cc'
 * ```
 */
export function toAbsolutePath(relativePath: string, chromiumRoot: string): string {
  return path.resolve(chromiumRoot, relativePath);
}

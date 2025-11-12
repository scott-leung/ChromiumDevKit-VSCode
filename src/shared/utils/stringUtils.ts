/**
 * Convert file path to header guard macro name
 * Example: "browser/account/test.h" -> "BROWSER_ACCOUNT_TEST_H_"
 */
export function pathToMacroName(relativePath: string, style: 'uppercase' | 'lowercase'): string {
  // Replace path separators and special characters with underscores
  const macroName = relativePath
    .replace(/[\\/]/g, '_')           // Replace / and \ with _
    .replace(/\.h$/i, '_H_')          // Replace .h extension with _H_ (before other special chars)
    .replace(/[^a-zA-Z0-9_]/g, '_');  // Replace remaining special chars with _

  // Apply case style
  return style === 'uppercase' ? macroName.toUpperCase() : macroName.toLowerCase();
}

/**
 * Normalize path separators to forward slashes
 */
export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

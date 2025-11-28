/**
 * Path utilities for Chromium I18n extension
 * Provides IDS constant recognition and text extraction
 */

/**
 * Regular expression to match IDS constants
 * Matches patterns like: IDS_APP_TITLE, IDS_SETTINGS_PAGE_TITLE, etc.
 * Format: IDS_[A-Z0-9_]+
 */
export const IDS_PATTERN = /IDS_[A-Z0-9_]+/g;

/**
 * Extract IDS constant at a specific position in a document
 *
 * @param text Full text of the document
 * @param position Character offset in the document
 * @returns IDS constant name or null if not found
 *
 * @example
 * const text = "const title = IDS_APP_TITLE;";
 * const idsName = extractIDSAtPosition(text, 15); // Returns "IDS_APP_TITLE"
 */
export function extractIDSAtPosition(text: string, position: number): string | null {
  // Find the start of the word
  let start = position;
  while (start > 0 && /[A-Z0-9_]/.test(text[start - 1])) {
    start--;
  }

  // Find the end of the word
  let end = position;
  while (end < text.length && /[A-Z0-9_]/.test(text[end])) {
    end++;
  }

  // Extract the word
  const word = text.substring(start, end);

  // Check if it's a valid IDS constant
  if (/^IDS_[A-Z0-9_]+$/.test(word)) {
    return word;
  }

  return null;
}

/**
 * Get all IDS constants in a text
 *
 * @param text Text to search
 * @returns Array of unique IDS constant names
 *
 * @example
 * const text = "const title = IDS_APP_TITLE; const desc = IDS_APP_DESC;";
 * const ids = getAllIDSInText(text); // Returns ["IDS_APP_TITLE", "IDS_APP_DESC"]
 */
export function getAllIDSInText(text: string): string[] {
  const matches = text.match(IDS_PATTERN);
  if (!matches) {
    return [];
  }

  // Return unique IDS names
  return [...new Set(matches)];
}

/**
 * Check if a string is a valid IDS constant name
 *
 * @param str String to check
 * @returns True if valid IDS constant
 *
 * @example
 * isValidIDSName("IDS_APP_TITLE"); // Returns true
 * isValidIDSName("MY_CONSTANT");   // Returns false
 * isValidIDSName("ids_lowercase");  // Returns false
 */
export function isValidIDSName(str: string): boolean {
  return /^IDS_[A-Z0-9_]+$/.test(str);
}

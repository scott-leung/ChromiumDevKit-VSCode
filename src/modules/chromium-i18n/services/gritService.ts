/**
 * GritService - GRIT Algorithm Implementation
 *
 * This service replicates the GRIT tool's presentable text generation and hash ID calculation.
 * MUST match Chromium GRIT 100% for translation ID compatibility.
 *
 * Reference:
 * - Presentable Text: src/tools/grit/grit/tclib.py -> BaseMessage.GetPresentableContent()
 * - Hash ID: src/tools/grit/grit/extern/tclib.py -> GenerateMessageId()
 */

import * as crypto from 'crypto';

export class GritService {
  /**
   * Generate presentable text from Message XML node
   *
   * Algorithm must match: src/tools/grit/grit/tclib.py -> BaseMessage.GetPresentableContent()
   *
   * Rules:
   * 1. Extract all text nodes and placeholder representations
   * 2. Placeholders are represented as: <ph name="NAME">...</ph>
   * 3. Presentable text uses placeholder name directly (not [NAME], just NAME)
   * 4. Whitespace normalization: collapse multiple spaces, trim
   *
   * @param xmlNode Parsed XML node of <message> tag (from fast-xml-parser)
   * @returns Presentable text string
   */
  static generatePresentableText(xmlNode: any): string {
    /**
     * Fast-xml-parser with default settings doesn't preserve order of mixed content.
     * For messages with multiple placeholders like:
     *   <ph name="TYPE_1">$1</ph>, <ph name="TYPE_2">$2</ph>
     * We need to correctly reconstruct: "TYPE_1, TYPE_2"
     *
     * Strategy: Handle both array (multiple ph) and object (single ph) cases
     */

    // Helper to extract presentable content from a node
    function extractPresentableContent(node: any): string {
      // Handle primitive strings
      if (typeof node === 'string') {
        return node;
      }

      // Handle objects (XML elements)
      if (typeof node === 'object' && node !== null) {
        const parts: string[] = [];

        // Check if this is a placeholder element (has @_name but no @_desc)
        if (node['@_name'] && !node['@_desc']) {
          // This is a <ph> element - return its name directly
          return node['@_name'];
        }

        // For message elements with mixed content:
        // We need to handle the case where 'ph' can be:
        // 1. A single object: { '#text': ..., 'ph': {...}, '@_name': ... }
        // 2. An array: { '#text': ..., 'ph': [{...}, {...}], '@_name': ... }

        // Strategy: Since fast-xml-parser doesn't preserve order perfectly,
        // we'll handle text and placeholders specially

        const textContent = node['#text'] || '';
        const phElements = node['ph'];

        // If there are placeholder elements
        if (phElements) {
          if (Array.isArray(phElements)) {
            // Multiple placeholders - we need to interleave with text
            // The text typically contains separators (like ", ")
            // For now, we'll use a heuristic: extract placeholder names
            // and join with the text content (after normalizing)

            // Extract all placeholder names
            const phNames = phElements.map(ph => ph['@_name'] || '');

            // Check if text contains separators
            const trimmedText = textContent.trim();

            if (trimmedText && phNames.length > 0) {
              // Text contains separators between placeholders
              // For N placeholders, there are N-1 separators
              // Example: "<ph/>, <ph/>, <ph/>" has 2 commas
              // The #text is "\n        , , \n      " which contains ", , "

              // Normalize whitespace first
              const normalized = trimmedText.replace(/\s+/g, ' ').trim();

              if (normalized) {
                // Try to split the separators
                // Common patterns:
                // - Single separator: ", " → split by nothing, just use as-is
                // - Multiple separators: ", , " → need to split into [", ", ", "]

                // Strategy: For N placeholders, we need N-1 separators
                const separatorCount = phNames.length - 1;

                if (separatorCount === 1) {
                  // Two placeholders, one separator - simple case
                  return phNames.join(normalized + ' ');
                } else if (separatorCount > 1) {
                  // Multiple placeholders - need to extract individual separators
                  // The separators are typically the same repeated pattern

                  // Find the most common pattern (e.g., ",")
                  // For ", , " the pattern is ","
                  const parts = normalized.split(/\s+/);
                  const uniqueSeparators = Array.from(new Set(parts));

                  if (uniqueSeparators.length === 1) {
                    // All separators are the same (e.g., all commas)
                    const sep = uniqueSeparators[0];
                    return phNames.join(sep + ' ');
                  } else {
                    // Mixed separators - just join with the whole normalized string divided
                    // This is a heuristic and may not be perfect
                    return phNames.join(normalized + ' ');
                  }
                } else {
                  // No separator needed (only 1 placeholder)
                  return phNames[0] || '';
                }
              } else {
                // No separator, just concatenate
                return phNames.join('');
              }
            } else if (phNames.length > 0) {
              // No text, just placeholders
              return phNames.join('');
            }
          } else {
            // Single placeholder
            const phName = phElements['@_name'] || '';
            return textContent + phName;
          }
        }

        // No placeholders - just return text content
        if (textContent) {
          parts.push(textContent);
        }

        // Recursively handle other child elements (skip examples and attributes)
        for (const key in node) {
          if (key === '#text' || key === 'ph' || key === 'ex' || key.startsWith('@_')) {
            continue;
          }

          const child = node[key];
          if (Array.isArray(child)) {
            for (const item of child) {
              parts.push(extractPresentableContent(item));
            }
          } else {
            parts.push(extractPresentableContent(child));
          }
        }

        return parts.join('');
      }

      return '';
    }

    // Extract content from message node
    let presentableText = extractPresentableContent(xmlNode);

    // Normalize whitespace: collapse multiple spaces to single space
    presentableText = presentableText.replace(/\s+/g, ' ');

    // Trim leading and trailing whitespace
    presentableText = presentableText.trim();

    return presentableText;
  }

  /**
   * Calculate hash ID from presentable text and optional meaning
   *
   * Algorithm matches: src/tools/grit/grit/extern/tclib.py -> GenerateMessageId()
   *
   * Steps (from Python implementation):
   * 1. Calculate fingerprint of presentable text using FP.FingerPrint()
   *    - Take MD5 hash, get first 16 hex chars (8 bytes) as unsigned 64-bit
   *    - Convert to signed 64-bit by checking MSB
   * 2. If meaning provided:
   *    - Calculate fingerprint of meaning
   *    - Combine: fp2 + (fp << 1) + (1 if fp < 0 else 0)
   * 3. Strip high-order bit: fp & 0x7fffffffffffffff (ensure positive)
   *
   * @param presentableText Presentable text from generatePresentableText()
   * @param meaning Optional meaning attribute
   * @returns Hash ID as decimal string (16-20 digits)
   */
  static calculateHashId(presentableText: string, meaning?: string): string {
    // Helper: Calculate fingerprint (matches FP.FingerPrint in FP.py)
    function fingerPrint(str: string): bigint {
      // Calculate MD5 hash
      const hash = crypto.createHash('md5').update(str, 'utf8').digest();

      // Take first 16 hex characters (8 bytes)
      const hex16 = hash.toString('hex').substring(0, 16);

      // Convert to unsigned 64-bit integer
      let fp = BigInt('0x' + hex16);

      // Convert to signed 64-bit (if MSB is set, make it negative)
      if (fp & BigInt('0x8000000000000000')) {
        fp = -((~fp & BigInt('0xFFFFFFFFFFFFFFFF')) + BigInt(1));
      }

      return fp;
    }

    // Calculate fingerprint of presentable text
    let fp = fingerPrint(presentableText);

    // If meaning is provided, combine fingerprints
    if (meaning) {
      const fp2 = fingerPrint(meaning);
      if (fp < BigInt(0)) {
        fp = fp2 + (fp << BigInt(1)) + BigInt(1);
      } else {
        fp = fp2 + (fp << BigInt(1));
      }
    }

    // Strip high-order bit to avoid negative IDs
    fp = fp & BigInt('0x7fffffffffffffff');

    // Convert to decimal string
    return fp.toString();
  }

  /**
   * Validate GRIT implementation against real Chromium XTB files
   *
   * This function is used for testing during development to ensure
   * our algorithm matches Chromium GRIT 100%.
   *
   * @param grdMessages Array of messages from GRD file parsing
   * @param xtbTranslations Array of translations from XTB file
   * @returns Validation result with accuracy metrics
   */
  static validateImplementation(
    grdMessages: Array<{ name: string; xmlNode: any; meaning?: string }>,
    xtbTranslations: Array<{ id: string; text: string }>
  ): {
    totalMessages: number;
    matchedMessages: number;
    accuracy: number;
    mismatches: Array<{
      messageName: string;
      expectedId: string;
      calculatedId: string;
    }>;
  } {
    const mismatches: Array<{
      messageName: string;
      expectedId: string;
      calculatedId: string;
    }> = [];

    let matchedMessages = 0;

    for (const message of grdMessages) {
      // Generate presentable text and calculate hash ID
      const presentableText = this.generatePresentableText(message.xmlNode);
      const calculatedId = this.calculateHashId(presentableText, message.meaning);

      // Find matching translation in XTB
      const xtbTranslation = xtbTranslations.find(t =>
        t.id === calculatedId
      );

      if (xtbTranslation) {
        matchedMessages++;
      } else {
        // Find the actual XTB translation (by any ID) for this message
        // This requires manual mapping during development
        const expectedTranslation = xtbTranslations.find(_t => {
          // During validation, we need to manually map message names to XTB IDs
          // This is temporary - once algorithm is correct, all will match automatically
          return false; // Placeholder
        });

        mismatches.push({
          messageName: message.name,
          expectedId: expectedTranslation?.id || 'UNKNOWN',
          calculatedId: calculatedId,
        });
      }
    }

    const accuracy = (matchedMessages / grdMessages.length) * 100;

    return {
      totalMessages: grdMessages.length,
      matchedMessages,
      accuracy,
      mismatches,
    };
  }
}

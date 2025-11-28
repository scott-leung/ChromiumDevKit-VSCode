/**
 * GritService V2 - GRIT Algorithm Implementation with preserveOrder
 *
 * This version uses XMLParser with preserveOrder: true to correctly handle
 * mixed content in GRD messages. This is required for 100% accuracy.
 *
 * Reference:
 * - Presentable Text: src/tools/grit/grit/tclib.py -> BaseMessage.GetPresentableContent()
 * - Hash ID: src/tools/grit/grit/extern/tclib.py -> GenerateMessageId()
 */

import * as crypto from 'crypto';

export class GritServiceV2 {
  /**
   * Generate presentable text from Message XML node (preserveOrder format)
   *
   * With preserveOrder: true, the message content is an ordered array:
   * [
   *   { "#text": "text1" },
   *   { "ph": [...], ":@": { "@_name": "PLACEHOLDER" } },
   *   { "#text": "text2" },
   *   ...
   * ]
   *
   * IMPORTANT: GRIT strips leading/trailing whitespace using a regex pattern.
   * This includes the triple-quote syntax (''') used in GRD files.
   *
   * Reference: src/tools/grit/grit/node/message.py:221-225
   *   _WHITESPACE = re.compile(r'(?P<start>\s*)(?P<body>.+?)(?P<end>\s*)\Z')
   *   m = _WHITESPACE.match(text)
   *   text = m.group('body')
   *
   * @param orderedMessageContent Array from preserveOrder parser
   * @returns Presentable text string
   */
  static generatePresentableText(orderedMessageContent: any[]): string {
    if (!Array.isArray(orderedMessageContent)) {
      return '';
    }

    const parts: string[] = [];

    for (const item of orderedMessageContent) {
      // Handle text nodes
      if (item['#text'] !== undefined) {
        parts.push(item['#text']);
        continue;
      }

      // Handle placeholder elements
      if (item['ph']) {
        // Get placeholder name from attributes
        // IMPORTANT: GRIT converts placeholder names to UPPERCASE
        // Reference: src/tools/grit/grit/node/message.py:189
        //   presentation = item.attrs['name'].upper()
        const attrs = item[':@'];
        if (attrs && attrs['@_name']) {
          parts.push(attrs['@_name'].toUpperCase());
        }
        continue;
      }

      // Handle other elements (like <if>, <message>, etc.) - recurse
      for (const key in item) {
        if (key === ':@' || key === '#text') continue;

        const value = item[key];
        if (Array.isArray(value)) {
          // Recursively process nested content
          parts.push(this.generatePresentableText(value));
        }
      }
    }

    // Join all parts
    let text = parts.join('');

    // STEP 1: Strip leading and trailing whitespace ONLY
    // This matches GRIT's _WHITESPACE regex: (?P<start>\s*)(?P<body>.+?)(?P<end>\s*)\Z
    // Reference: src/tools/grit/grit/node/message.py:221-225
    //
    // IMPORTANT: GRIT does NOT normalize internal whitespace!
    // It ONLY removes leading and trailing whitespace.
    // All internal whitespace (newlines, spaces, indentation) is preserved.
    const whitespaceMatch = text.match(/^(\s*)(.+?)(\s*)$/s);
    if (whitespaceMatch) {
      text = whitespaceMatch[2]; // Extract body only (removes leading/trailing whitespace)
    }

    // STEP 2: Remove triple-quote markers if present
    // Triple quotes (''') are used in GRD to indicate preserved whitespace,
    // but they are NOT part of the actual presentable text for hash calculation
    // Reference: src/tools/grit/grit/node/message.py:346-348
    //   GRIT adds ''' at start of first item and end of last item
    // These markers should be stripped independently (not just when both present)
    if (text.startsWith("'''")) {
      text = text.substring(3);
    }
    if (text.endsWith("'''")) {
      text = text.substring(0, text.length - 3);
    }
    // Trim again after removing triple quotes
    text = text.trim();

    // That's it! No whitespace normalization.
    // GRIT preserves all internal whitespace exactly as written in the GRD file.
    return text;
  }

  /**
   * Generate a translation-friendly text that preserves placeholders and inner content.
   * This is NOT used for hashing; it's only for feeding to AI and UI so that
   * placeholders like <ph name="ERROR_MESSAGE">{1}</ph> remain intact.
   */
  static generateTranslatableText(orderedMessageContent: any[]): string {
    const renderNodes = (nodes: any[]): string => {
      if (!Array.isArray(nodes)) {
        return '';
      }

      const parts: string[] = [];

      for (const node of nodes) {
        if (node['#text'] !== undefined) {
          parts.push(node['#text']);
          continue;
        }

        if (node['ph']) {
          const attrs = node[':@'] || {};
          const name = attrs['@_name'] || attrs['@_NAME'] || '';
          const inner = renderNodes(Array.isArray(node['ph']) ? node['ph'] : [node['ph']]);
          if (name) {
            if (inner.length > 0) {
              parts.push(`<ph name="${name}">${inner}</ph>`);
            } else {
              parts.push(`<ph name="${name}" />`);
            }
          }
          continue;
        }

        for (const key in node) {
          if (key === ':@' || key === '#text' || key === 'ex') {
            continue;
          }
          const value = node[key];
          if (Array.isArray(value)) {
            parts.push(renderNodes(value));
          } else if (typeof value === 'object' && value !== null) {
            parts.push(renderNodes([value]));
          }
        }
      }

      return parts.join('');
    };

    return renderNodes(orderedMessageContent);
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
}

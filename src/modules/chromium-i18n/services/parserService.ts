/**
 * Parser Service
 * Handles parsing of GRD, GRDP, and XTB XML files
 * Uses fast-xml-parser with preserveOrder for accurate mixed content handling
 */

import { XMLParser } from 'fast-xml-parser';
import { GritServiceV2 } from './gritServiceV2';
import { IMessage, ITranslation } from '../models';

/**
 * Parse result for GRD files
 */
export interface GRDParseResult {
  /** Parsed messages from the GRD file */
  messages: IMessage[];

  /** GRDP file paths referenced in the GRD */
  grdpPaths: string[];

  /** XTB file patterns (with <file> elements) */
  xtbPatterns: Array<{ lang: string; path: string }>;
}

/**
 * Parse result for GRDP files
 */
export interface GRDPParseResult {
  /** Parsed messages from the GRDP file */
  messages: IMessage[];
}

/**
 * Parse result for XTB files
 */
export interface XTBParseResult {
  /** Language code from translationbundle element */
  lang: string;

  /** Parsed translations */
  translations: ITranslation[];
}

/**
 * Parser Service
 * Handles XML parsing for GRD/GRDP/XTB files
 */
export class ParserService {
  private grdParser: XMLParser;
  private xtbParser: XMLParser;

  constructor() {
    // Parser for GRD/GRDP files (requires preserveOrder for accurate message parsing)
    // IMPORTANT: Enable processEntities and htmlEntities to convert &#10; to \n
    // Reference: HTML entities in GRD files must be converted to actual characters
    this.grdParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      preserveOrder: true,
      trimValues: false,
      processEntities: true,
      htmlEntities: true,
    });

    // Parser for XTB files (simpler structure, no preserveOrder needed)
    this.xtbParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      preserveOrder: true,
      processEntities: true,
      htmlEntities: true,
    });
  }

  /**
   * Parse GRD file
   * @param content XML content of GRD file
   * @param filePath Absolute path to GRD file (used for message.grd_path)
   * @returns Parsed messages, GRDP paths, and XTB patterns
   */
  public parseGRD(content: string, filePath: string): GRDParseResult {
    console.log(`[ParserService] Parsing GRD file: ${filePath}`);
    const parsed = this.grdParser.parse(content);

    // Build line number map for message names
    const lineMap = this.buildLineNumberMap(content);

    const messages: IMessage[] = [];
    const grdpPaths: string[] = [];
    const xtbPatterns: Array<{ lang: string; path: string }> = [];

    // Traverse the ordered array to find messages, parts, and outputs
    this.traverseGRD(parsed, filePath, messages, grdpPaths, xtbPatterns, lineMap);

    console.log(`[ParserService] GRD parsing complete: ${messages.length} messages, ${grdpPaths.length} GRDP refs, ${xtbPatterns.length} XTB patterns`);
    if (xtbPatterns.length > 0) {
      console.log(`[ParserService] XTB patterns found:`, xtbPatterns.slice(0, 3)); // Log first 3 for brevity
    }

    return { messages, grdpPaths, xtbPatterns };
  }

  /**
   * Parse GRDP file
   * @param content XML content of GRDP file
   * @param grdpPath Absolute path to GRDP file (used for message.grdp_path)
   * @param parentGrdPath Parent GRD file path (used for message.grd_path)
   * @returns Parsed messages
   */
  public parseGRDP(content: string, grdpPath: string, parentGrdPath: string): GRDPParseResult {
    const parsed = this.grdParser.parse(content);

    // Build line number map for message names
    const lineMap = this.buildLineNumberMap(content);

    const messages: IMessage[] = [];

    // Traverse to find messages
    this.traverseGRDP(parsed, grdpPath, parentGrdPath, messages, lineMap);

    return { messages };
  }

  /**
   * Parse XTB file
   * @param content XML content of XTB file
   * @param xtbPath Absolute path to XTB file
   * @returns Language code and translations
   */
  public parseXTB(content: string, xtbPath: string): XTBParseResult {
    console.log(`[ParserService] Parsing XTB file: ${xtbPath}`);
    const parsed = this.xtbParser.parse(content);

    let lang = 'unknown';
    const translations: ITranslation[] = [];

    const renderTranslationContent = (nodes: any[]): string => {
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
          const inner = renderTranslationContent(Array.isArray(node['ph']) ? node['ph'] : [node['ph']]);
          if (name) {
            const trimmedInner = inner.trim();
            if (trimmedInner.length === 0) {
              parts.push(`<ph name="${name}" />`);
            } else {
              parts.push(`<ph name="${name}">${inner}</ph>`);
            }
          }
          continue;
        }
        // Skip examples
        if (node['ex']) {
          continue;
        }
        for (const key in node) {
          if (key === ':@' || key === '#text' || key === 'ph' || key === 'ex') {
            continue;
          }
          const value = node[key];
          if (Array.isArray(value)) {
            parts.push(renderTranslationContent(value));
          } else if (typeof value === 'object' && value !== null) {
            parts.push(renderTranslationContent([value]));
          }
        }
      }
      return parts.join('');
    };

    const walk = (nodes: any[]): void => {
      if (!Array.isArray(nodes)) {
        return;
      }
      for (const node of nodes) {
        if (node.translationbundle) {
          const attrs = node[':@'];
          if (attrs && attrs['@_lang']) {
            lang = attrs['@_lang'];
          }
          const child = Array.isArray(node.translationbundle)
            ? node.translationbundle
            : [node.translationbundle];
          walk(child);
          continue;
        }

        if (node.translation) {
          const attrs = node[':@'];
          const id = attrs?.['@_id'];
          const contentNodes = Array.isArray(node.translation) ? node.translation : [node.translation];
          if (id) {
            translations.push({
              id_hash: id,
              lang,
              text: renderTranslationContent(contentNodes),
              xtb_path: xtbPath,
            });
          }
        }

        for (const key in node) {
          if (key === ':@' || key === '#text' || key === 'translationbundle' || key === 'translation') {
            continue;
          }
          const value = node[key];
          if (Array.isArray(value)) {
            walk(value);
          } else if (typeof value === 'object' && value !== null) {
            walk([value]);
          }
        }
      }
    };

    walk(parsed);

    console.log(`[ParserService] XTB parsing complete: lang=${lang}, translations=${translations.length}`);
    return { lang, translations };
  }

  /**
   * Build a map of message names to their line ranges in the source XML
   * @param content XML file content
   * @returns Map of message name to {start: number, end: number}
   */
  private buildLineNumberMap(content: string): Map<string, { start: number; end: number }> {
    const lineMap = new Map<string, { start: number; end: number }>();
    const lines = content.split('\n');

    // Regex to match message elements with name attribute
    // Matches: <message name="IDS_NAME" ... or <message desc="..." name="IDS_NAME" ...
    // The [^>]* allows for any attributes before 'name'
    const messageStartRegex = /<message\s+[^>]*name=["']([^"']+)["']/i;
    const messageEndRegex = /<\/message>/i;

    let currentMessageName: string | null = null;
    let currentStartLine: number = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1; // 1-based line number

      // Check for message start
      const startMatch = messageStartRegex.exec(line);
      if (startMatch && startMatch[1]) {
        currentMessageName = startMatch[1];
        currentStartLine = lineNumber;

        // Check if this is a self-closing tag on the same line
        if (line.includes('</message>')) {
          lineMap.set(currentMessageName, { start: currentStartLine, end: lineNumber });
          currentMessageName = null;
        }
      }
      // Check for message end
      else if (currentMessageName && messageEndRegex.test(line)) {
        lineMap.set(currentMessageName, { start: currentStartLine, end: lineNumber });
        currentMessageName = null;
      }
    }

    return lineMap;
  }

  /**
   * Traverse GRD ordered array to extract messages, parts, and outputs
   */
  private traverseGRD(
    orderedArray: any[],
    grdPath: string,
    messages: IMessage[],
    grdpPaths: string[],
    xtbPatterns: Array<{ lang: string; path: string }>,
    lineMap: Map<string, { start: number; end: number }>
  ): void {
    if (!Array.isArray(orderedArray)) return;

    for (const item of orderedArray) {
      // Check for message elements
      if (item.message) {
        const attrs = item[':@'];
        if (attrs && attrs['@_name']) {
          // Include all messages, not just IDS_* (e.g., VIDEO_CONFERENCE_*, etc.)
          const messageContent = Array.isArray(item.message) ? item.message : [item.message];

          // Generate presentable text and hash ID
          const presentableText = GritServiceV2.generatePresentableText(messageContent);
          const translatableText = GritServiceV2.generateTranslatableText(messageContent);
          const idHash = GritServiceV2.calculateHashId(presentableText, attrs['@_meaning']);

          // Get line range from line map (defaults to 0 if not found)
          const messageName = attrs['@_name'];
          const lineRange = lineMap.get(messageName);
          const startLine = lineRange?.start || 0;
          const endLine = lineRange?.end || 0;

          messages.push({
            name: messageName,
            english: presentableText,
            presentable_text: presentableText,
            meaning: attrs['@_meaning'],
            description: attrs['@_desc'],
            id_hash: idHash,
            grd_path: grdPath,
            start_line: startLine,
            end_line: endLine,
            source_text: translatableText,
          });
        }
      }

      // Check for part elements (GRDP references)
      if (item.part) {
        const attrs = item[':@'];
        if (attrs && attrs['@_file']) {
          grdpPaths.push(attrs['@_file']);
        }
      }

      // Check for translations/file elements (XTB references)
      // In preserveOrder mode, each <file /> is a separate item with:
      // - item.file: empty array []
      // - item[':@']: contains @_path and @_lang attributes
      if (item.file) {
        const attrs = item[':@'];
        if (attrs && attrs['@_lang'] && attrs['@_path']) {
          console.log(`[ParserService] Found XTB reference: lang=${attrs['@_lang']}, path=${attrs['@_path']}`);
          xtbPatterns.push({
            lang: attrs['@_lang'],
            path: attrs['@_path'],
          });
        }
      }

      // Recurse into child elements
      for (const key in item) {
        if (key === ':@' || key === '#text') continue;
        const value = item[key];
        if (Array.isArray(value)) {
          this.traverseGRD(value, grdPath, messages, grdpPaths, xtbPatterns, lineMap);
        }
      }
    }
  }

  /**
   * Traverse GRDP ordered array to extract messages
   */
  private traverseGRDP(
    orderedArray: any[],
    grdpPath: string,
    parentGrdPath: string,
    messages: IMessage[],
    lineMap: Map<string, { start: number; end: number }>
  ): void {
    if (!Array.isArray(orderedArray)) return;

    for (const item of orderedArray) {
      // Check for message elements
      if (item.message) {
        const attrs = item[':@'];
        if (attrs && attrs['@_name']) {
          // Include all messages, not just IDS_* (e.g., VIDEO_CONFERENCE_*, etc.)
          const messageContent = Array.isArray(item.message) ? item.message : [item.message];

          // Generate presentable text and hash ID
          const presentableText = GritServiceV2.generatePresentableText(messageContent);
          const translatableText = GritServiceV2.generateTranslatableText(messageContent);
          const idHash = GritServiceV2.calculateHashId(presentableText, attrs['@_meaning']);

          // Get line range from line map (defaults to 0 if not found)
          const messageName = attrs['@_name'];
          const lineRange = lineMap.get(messageName);
          const startLine = lineRange?.start || 0;
          const endLine = lineRange?.end || 0;

          messages.push({
            name: messageName,
            english: presentableText,
            presentable_text: presentableText,
            meaning: attrs['@_meaning'],
            description: attrs['@_desc'],
            id_hash: idHash,
            grd_path: parentGrdPath,
            grdp_path: grdpPath,
            start_line: startLine,
            end_line: endLine,
            source_text: translatableText,
          });
        }
      }

      // Recurse into child elements
      for (const key in item) {
        if (key === ':@' || key === '#text') continue;
        const value = item[key];
        if (Array.isArray(value)) {
          this.traverseGRDP(value, grdpPath, parentGrdPath, messages, lineMap);
        }
      }
    }
  }
}

// Export singleton instance
export const parserService = new ParserService();

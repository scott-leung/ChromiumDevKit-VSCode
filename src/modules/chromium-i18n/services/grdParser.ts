/**
 * GRD Parser with Part File Support
 *
 * This parser handles GRIT's <part file="xxx.grdp" /> mechanism by:
 * 1. Detecting <part> elements during traversal
 * 2. Resolving file paths relative to GRD directory
 * 3. Recursively parsing GRDP files
 * 4. Inserting part content as children of <part> node
 *
 * Reference: src/tools/grit/grit/grd_reader.py:92-112
 */

import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { GritServiceV2 } from './gritServiceV2';

export interface GrdMessage {
  id: string;
  name: string;
  presentableText: string;
  meaning?: string;
}

export class GrdParser {
  private parser: XMLParser;
  private baseDir: string;
  private processedFiles: Set<string>;

  constructor(grdFilePath: string) {
    this.baseDir = path.dirname(grdFilePath);
    this.processedFiles = new Set();

    // Use preserveOrder for correct mixed content handling
    // IMPORTANT: Enable processEntities and htmlEntities to convert &#10; to \n
    // Reference: HTML entities in GRD files must be converted to actual characters
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: true,
      htmlEntities: true
    });
  }

  /**
   * Parse GRD file and extract all messages with part file support
   * @param grdFilePath Path to main GRD file
   * @returns Map of message ID to message info
   */
  parseGrd(grdFilePath: string): Map<string, GrdMessage> {
    const messages = new Map<string, GrdMessage>();

    // Read and parse main GRD file
    const grdContent = fs.readFileSync(grdFilePath, 'utf-8');
    const grdData = this.parser.parse(grdContent);

    // Process all nodes including part files
    this.processNodes(grdData, messages);

    return messages;
  }

  /**
   * Process XML nodes recursively, handling part files
   * @param nodes Array of nodes from preserveOrder parser
   * @param messages Output map to collect messages
   */
  private processNodes(nodes: any[], messages: Map<string, GrdMessage>): void {
    for (const node of nodes) {
      // Handle <part file="xxx.grdp" /> elements
      if (node['part']) {
        const attrs = node[':@'];
        if (attrs && attrs['@_file']) {
          const partFile = attrs['@_file'];
          this.processPartFile(partFile, messages);
        }
        continue;
      }

      // Handle <message> elements
      if (node['message']) {
        const msgArray = node['message'];
        if (!Array.isArray(msgArray) || msgArray.length === 0) continue;

        const attrs = node[':@'];
        if (!attrs || !attrs['@_name']) continue;

        const name = attrs['@_name'];
        const meaning = attrs['@_meaning'];

        // Generate presentable text and calculate hash ID
        const presentableText = GritServiceV2.generatePresentableText(msgArray);
        const id = GritServiceV2.calculateHashId(presentableText, meaning);

        messages.set(id, {
          id,
          name,
          presentableText,
          meaning
        });
        continue;
      }

      // Recursively process child nodes
      for (const key in node) {
        if (key === ':@' || key === '#text') continue;

        const value = node[key];
        if (Array.isArray(value)) {
          this.processNodes(value, messages);
        }
      }
    }
  }

  /**
   * Process a part file (GRDP)
   * @param partFileName Part file name (e.g., "recorder_strings.grdp")
   * @param messages Output map to collect messages
   */
  private processPartFile(partFileName: string, messages: Map<string, GrdMessage>): void {
    // Resolve part file path relative to GRD directory
    const partFilePath = path.join(this.baseDir, partFileName);

    // Prevent circular references
    if (this.processedFiles.has(partFilePath)) {
      console.warn(`Warning: Circular reference detected for ${partFileName}`);
      return;
    }

    // Check if file exists
    if (!fs.existsSync(partFilePath)) {
      console.warn(`Warning: Part file not found: ${partFilePath}`);
      return;
    }

    // Mark as processed
    this.processedFiles.add(partFilePath);

    try {
      // Read and parse part file
      const partContent = fs.readFileSync(partFilePath, 'utf-8');
      const partData = this.parser.parse(partContent);

      // Process nodes in part file
      // GRDP files are wrapped in <grit-part> root element
      this.processNodes(partData, messages);

    } catch (error) {
      console.error(`Error processing part file ${partFileName}:`, error);
    }
  }

  /**
   * Static convenience method to parse GRD file
   * @param grdFilePath Path to GRD file
   * @returns Map of message ID to message info
   */
  static parse(grdFilePath: string): Map<string, GrdMessage> {
    const parser = new GrdParser(grdFilePath);
    return parser.parseGrd(grdFilePath);
  }
}

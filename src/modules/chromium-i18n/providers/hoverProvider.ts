/**
 * Hover Provider for Chromium I18n extension
 * Provides hover tooltips for IDS constants, showing translations in all languages
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QueryService } from '../services/queryService';
import { ConfigService } from '../services/configService';
import { extractIDSAtPosition } from '../utils/pathUtils';
import { IMessage, IMessageWithTranslations, ITranslation } from '../models';
import { getLanguageDisplayName } from '../utils/languageUtils';
import { ParserService } from '../services/parserService';
import { GritServiceV2 } from '../services/gritServiceV2';

/**
 * Chromium I18n Hover Provider
 * Shows English original text and all language translations when hovering over IDS constants
 */
export class ChromiumI18nHoverProvider implements vscode.HoverProvider {
  private queryService: QueryService;
  private configService: ConfigService;

  constructor(queryService: QueryService, configService: ConfigService) {
    this.queryService = queryService;
    this.configService = configService;
  }

  /**
   * Provide hover information for a position in a document
   *
   * @param document Current text document
   * @param position Cursor position
   * @param token Cancellation token
   * @returns Hover object with translation information
   */
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    // Check if cancelled
    if (token.isCancellationRequested) {
      // TODO: for debug, XiangYing will remove later - log cancellation request
      console.log('[HoverProvider] Cancellation requested');
      return undefined;
    }

    // Handle different file types
    const fileExt = path.extname(document.fileName).toLowerCase();

    // TODO: for debug, XiangYing will remove later - log routed file type
    console.log('[HoverProvider] File extension:', fileExt);
    if (fileExt === '.grd' || fileExt === '.grdp') {
      // TODO: for debug, XiangYing will remove later - routing to GRD/GRDP hover
      console.log('[HoverProvider] Providing GRD hover');
      return this.provideGRDHover(document, position);
    } else if (fileExt === '.xtb') {
      return this.provideXTBHover(document, position);
    } else {
      // Code files (.cc, .h, .mm, .mojom, etc.)
      return this.provideIDSHover(document, position);
    }
  }

  /**
   * Provide hover for IDS constants in code files
   */
  private async provideIDSHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    try {
      // Get text and cursor offset
      const text = document.getText();
      const offset = document.offsetAt(position);

      // Extract IDS constant at cursor position
      const idsName = extractIDSAtPosition(text, offset);
      if (!idsName) {
        console.log('[HoverProvider] No IDS constant found at position');
        return undefined;
      }

      console.log(`[HoverProvider] Found IDS: ${idsName}`);

      // Query database for message and translations
      const message = await this.resolveMessageForFile(idsName, document.uri.fsPath);
      if (!message) {
        console.log(`[HoverProvider] No message found for ${idsName}`);
        return undefined;
      }

      console.log(`[HoverProvider] Found message: ${message.name}, hash: ${message.id_hash}`);

      const idHash = this.ensureIdHash(message);
      const translations = await this.queryService.getTranslations(idHash);
      console.log(`[HoverProvider] Found ${translations.length} translations`);

      // Build hover content
      const hoverContent = this.buildIDSHoverMarkdown({ ...message, id_hash: idHash }, translations);

      // Return hover with range
      const range = this.getWordRangeAtPosition(document, position, idsName);
      return new vscode.Hover(hoverContent, range);
    } catch (error) {
      console.error('[HoverProvider] Error:', error);
      return undefined;
    }
  }

  /**
   * Provide hover for <message> tags in GRD/GRDP files
   */
  private async provideGRDHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    // TODO: for debug, XiangYing will remove later - entering GRD hover
    console.log('[HoverProvider][GRD] Hover at', `${document.uri.fsPath}:${position.line + 1}:${position.character + 1}`);

    const idsName = this.extractMessageName(document, position);
    // TODO: for debug, XiangYing will remove later - log hover entry and extracted ids
    console.log('[HoverProvider][GRD] Extracted ids:', idsName);
    if (!idsName) {
      // TODO: for debug, XiangYing will remove later - log no ids found
      console.log('[HoverProvider][GRD] No IDS constant found at position');
      return undefined;
    }

    const filePath = document.uri.fsPath;
    const isGrdp = filePath.toLowerCase().endsWith('.grdp');
    const parsedMessage = await this.parseMessageFromDocument(document, idsName, position);
    const message =
      parsedMessage ||
      (!isGrdp && await this.queryService.getMessageByNameAndGrd(idsName, filePath)) ||
      (isGrdp && await this.queryService.getMessageByNameAndGrdp(idsName, filePath)) ||
      (await this.resolveMessageForFile(idsName, filePath));

    if (!message) {
      console.log('[HoverProvider][GRD] No message found for', idsName);
      return undefined;
    }

    // Query database
    const idHash = this.ensureIdHash(message);
    const translations = await this.queryService.getTranslations(idHash);
    // TODO: for debug, XiangYing will remove later - log translation count
    console.log('[HoverProvider][GRD] Found translations:', translations.length);

    // Build hover content
    const hoverContent = this.buildIDSHoverMarkdown({ ...message, id_hash: idHash }, translations, { enableTranslate: true });

    return new vscode.Hover(hoverContent);
  }

  /**
   * Provide hover for <translation> tags in XTB files
   */
  private async provideXTBHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    // Get current line
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Check if we're in a <translation> tag
    const translationMatch = lineText.match(/<translation\s+id\s*=\s*["']([^"']+)["']/);
    if (!translationMatch) {
      return undefined;
    }

    const idHash = translationMatch[1];

    // Query database to find message by id_hash
    const messageWithTranslations = await this.queryService.getMessageWithTranslations(idHash);
    if (!messageWithTranslations) {
      return undefined;
    }

    // Build hover content (IMessageWithTranslations extends IMessage, so it IS the message)
    const hoverContent = this.buildIDSHoverMarkdown(
      messageWithTranslations,
      messageWithTranslations.translations
    );

    return new vscode.Hover(hoverContent);
  }

  /**
   * Build Markdown content for IDS hover
   */
  private buildIDSHoverMarkdown(
    message: Pick<IMessage, 'name' | 'english' | 'description' | 'grd_path' | 'grdp_path' | 'id_hash'>,
    translations: ITranslation[],
    options?: { enableTranslate?: boolean }
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Get user's preferred language from overlay configuration
    const preferredLang = this.configService.getOverlayConfig().locale;

    // Title
    md.appendMarkdown(`### 🌍 ${message.name}\n\n`);

    // Top action buttons
    const jumpToDefUri = `command:chromiumI18n.jumpToDefinition?${encodeURIComponent(JSON.stringify({ idsName: message.name }))}`;
    const jumpToTransUri = `command:chromiumI18n.jumpToTranslation?${encodeURIComponent(JSON.stringify({ idsName: message.name }))}`;
    const actions: string[] = [
      `[Jump to Definition](${jumpToDefUri})`,
      `[Jump to Translation](${jumpToTransUri})`,
    ];

    if (options?.enableTranslate) {
      const aiTranslateUri = `command:chromiumI18n.aiTranslate?${encodeURIComponent(
        JSON.stringify({ idsName: message.name, lang: preferredLang })
      )}`;
      // TODO: for debug, XiangYing will remove later - log action link
      console.log('[HoverProvider][GRD] AI Translate link for', message.name, '->', aiTranslateUri);
      actions.push(`[AI Translate](${aiTranslateUri})`);
    }
    // TODO: for debug, XiangYing will remove later - log actions list
    console.log('[HoverProvider][GRD] Actions:', actions);

    md.appendMarkdown(`${actions.join(' | ')}\n\n`);
    md.appendMarkdown(`---\n\n`);

    // Description (if exists)
    if (message.description) {
      md.appendMarkdown(`_${message.description}_\n\n`);
    }

    md.appendMarkdown(`**Source:** \`${message.grdp_path || message.grd_path}\`\n\n`);

    // English original
    md.appendMarkdown(`**English:** ${message.english}\n\n`);

    // Find preferred language translation for header display
    const preferredTranslation = translations.find(t => t.lang === preferredLang);
    if (preferredTranslation) {
      const preferredLangName = getLanguageDisplayName(preferredLang);
      md.appendMarkdown(`**${preferredLangName}:** ${preferredTranslation.text}\n\n`);
    }

    // All translations
    if (translations.length > 0) {
      md.appendMarkdown(`**All Translations:**\n\n`);

      // Sort translations by language code, but prioritize user's preferred language
      const sortedTranslations = [...translations].sort((a, b) => {
        // User's preferred language comes first
        if (a.lang === preferredLang) return -1;
        if (b.lang === preferredLang) return 1;
        // Sort others alphabetically
        return a.lang.localeCompare(b.lang);
      });

      for (const trans of sortedTranslations) {
        const langName = getLanguageDisplayName(trans.lang);
        // Create jump command for this specific translation
        const jumpToThisTransUri = `command:chromiumI18n.jumpToTranslation?${encodeURIComponent(JSON.stringify({ idsName: message.name, lang: trans.lang }))}`;
        md.appendMarkdown(`- **${langName}** (${trans.lang}): ${trans.text} [↗](${jumpToThisTransUri})\n`);
      }
    } else {
      md.appendMarkdown(`_No translations available_\n`);
    }

    // File paths and bottom action buttons
    md.appendMarkdown(`\n---\n\n`);
    md.appendMarkdown(`[Jump to Definition](${jumpToDefUri}) | [Jump to Translation](${jumpToTransUri})\n`);

    return md;
  }

  /**
   * Try to parse current GRD/GRDP document to resolve the exact message under cursor
   */
  private async parseMessageFromDocument(
    document: vscode.TextDocument,
    idsName: string,
    position: vscode.Position
  ): Promise<IMessage | undefined> {
    try {
      const parser = new ParserService();
      const filePath = document.uri.fsPath;
      const content = document.getText();
      const isGrdp = filePath.toLowerCase().endsWith('.grdp');
      const selectionLine = position.line + 1;

      if (isGrdp) {
        const dbMessage = await this.queryService.getMessageByNameAndGrdp(idsName, filePath);
        const parentGrd = dbMessage?.grd_path;
        if (!parentGrd) {
          return undefined;
        }
        const parsed = parser.parseGRDP(content, filePath, parentGrd);
        return this.pickMessage(parsed.messages, idsName, selectionLine);
      }

      const parsed = parser.parseGRD(content, filePath);
      return this.pickMessage(parsed.messages, idsName, selectionLine);
    } catch (error) {
      console.warn('[HoverProvider][GRD] Failed to parse document for hover:', error);
      return undefined;
    }
  }

  /**
   * Pick the correct message by line/name
   */
  private pickMessage(messages: IMessage[], name: string, selectionLine: number): IMessage | undefined {
    if (!messages || messages.length === 0) {
      return undefined;
    }

    const byLine = messages.find(
      (m) =>
        typeof m.start_line === 'number' &&
        typeof m.end_line === 'number' &&
        selectionLine >= (m.start_line || 0) &&
        selectionLine <= (m.end_line || 0)
    );

    if (byLine) {
      return byLine;
    }

    return messages.find((m) => m.name === name) ?? messages[0];
  }

  /**
   * Resolve message by IDS with best-effort path matching to current document
   */
  private async resolveMessageForFile(idsName: string, documentPath?: string): Promise<IMessage | null> {
    const candidates = await this.queryService.getMessagesByName(idsName);
    if (!candidates || candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1 || !documentPath) {
      return candidates[0];
    }

    return this.pickClosestByPath(candidates, documentPath);
  }

  /**
   * Pick message whose GRD/GRDP path shares the longest prefix with the document path
   */
  private pickClosestByPath(messages: IMessage[], documentPath: string): IMessage {
    const normalizedDoc = path.normalize(documentPath);
    let best = messages[0];
    let bestScore = -1;

    for (const msg of messages) {
      const candidatePath = msg.grdp_path || msg.grd_path;
      const score = candidatePath ? this.scorePathSimilarity(normalizedDoc, path.normalize(candidatePath)) : -1000;
      if (score > bestScore) {
        bestScore = score;
        best = msg;
      }
    }

    return best;
  }

  /**
   * Compute common path prefix length (in segments) to approximate closeness
   */
  private commonPathPrefixScore(a: string, b: string): number {
    const aParts = a.split(path.sep);
    const bParts = b.split(path.sep);
    const len = Math.min(aParts.length, bParts.length);
    let score = 0;
    for (let i = 0; i < len; i++) {
      if (aParts[i] === bParts[i]) {
        score++;
      } else {
        break;
      }
    }
    return score;
  }

  /**
   * Path similarity with prefix weight and distance penalty
   */
  private scorePathSimilarity(docPath: string, candidatePath: string): number {
    const prefix = this.commonPathPrefixScore(docPath, candidatePath);
    const rel = path.relative(path.dirname(candidatePath), path.dirname(docPath));
    const distance = rel === '' ? 0 : rel.split(path.sep).filter(Boolean).length;
    return prefix * 10 - distance;
  }

  /**
   * Ensure id_hash exists for the message
   */
  private ensureIdHash(message: IMessage): string {
    if (message.id_hash) {
      return message.id_hash;
    }
    return GritServiceV2.calculateHashId(message.presentable_text || message.english, message.meaning);
  }

  /**
   * Get word range at position
   */
  private getWordRangeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    word: string
  ): vscode.Range {
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Find word in line
    const wordIndex = lineText.indexOf(word);
    if (wordIndex >= 0) {
      const startPos = new vscode.Position(position.line, wordIndex);
      const endPos = new vscode.Position(position.line, wordIndex + word.length);
      return new vscode.Range(startPos, endPos);
    }

    // Fallback to word at position
    return document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
  }

  /**
   * Extract message name when hovering inside a GRD/GRDP <message> block
   */
  private extractMessageName(document: vscode.TextDocument, position: vscode.Position): string | null {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Find the nearest <message ...> start tag before the cursor
    const start = text.lastIndexOf('<message', offset);
    // TODO: for debug, XiangYing will remove later - log search window
    console.log('[HoverProvider][GRD] Search start offset:', start, 'cursor:', offset);
    if (start === -1) {
      // TODO: for debug, XiangYing will remove later - start not found
      console.log('[HoverProvider][GRD] No <message> start found before cursor');
      return null;
    }

    // Ensure the cursor is inside this message block
    const end = text.indexOf('</message>', start);
    if (end !== -1 && offset > end) {
      // TODO: for debug, XiangYing will remove later - cursor outside message block
      console.log('[HoverProvider][GRD] Cursor after message end, end offset:', end);
      return null;
    }

    // Parse attributes within a reasonable window after the start tag
    const snippet = text.slice(start, start + 800);
    const match = snippet.match(/<message[^>]*\bname=["']([^"']+)["']/i);
    if (!match) {
      // TODO: for debug, XiangYing will remove later - no name attribute found
      console.log('[HoverProvider][GRD] No name attribute found in snippet');
      return null;
    }

    const idsName = match[1];
    // TODO: for debug, XiangYing will remove later - parsed ids
    console.log('[HoverProvider][GRD] Parsed ids name:', idsName);
    return idsName.startsWith('IDS_') ? idsName : null;
  }
}

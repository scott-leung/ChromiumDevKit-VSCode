/**
 * Escape special characters for XML text nodes.
 *
 * Replaces the five XML-reserved characters with entity references so that
 * the returned string can be safely embedded inside <translation> tags.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Insert or update a translation node inside XTB content
 * Note: Translation content should already be valid XML (with <ph> tags etc.)
 * so we do NOT escape it here.
 */
export function upsertTranslation(
  content: string,
  idHash: string,
  translation: string
): { updated: string; action: 'updated' | 'inserted' } {
  const translationRegex = new RegExp(
    `<translation\\s+id\\s*=\\s*["']${idHash}["'][^>]*>([\\s\\S]*?)<\\/translation>`,
    'i'
  );

  if (translationRegex.test(content)) {
    const updated = content.replace(translationRegex, (match) => {
      const indentMatch = match.match(/(^|\n)(\s*)<translation/);
      const indent = indentMatch ? indentMatch[2] : '  ';
      return `${indent}<translation id="${idHash}">${translation}</translation>`;
    });

    return { updated, action: 'updated' };
  }

  const closingMatch = content.match(/(^|\n)(\s*)<\/translationbundle>/i);
  if (!closingMatch) {
    throw new Error('XTB file is missing the </translationbundle> closing tag');
  }

  const closingIndent = closingMatch[2] ?? '';
  const translationIndentMatch = content.match(/(^|\n)(\s*)<translation\b/);
  const translationIndent = translationIndentMatch ? translationIndentMatch[2] : `${closingIndent}  `;

  const beforeClosing = content.slice(0, closingMatch.index ?? content.length);
  const afterClosing = content.slice((closingMatch.index ?? content.length) + closingMatch[0].length);
  const trimmedBefore = beforeClosing.replace(/\s*$/, '');

  const updated = `${trimmedBefore}\n${translationIndent}<translation id="${idHash}">${translation}</translation>\n${closingIndent}</translationbundle>${afterClosing}`;

  return { updated, action: 'inserted' };
}

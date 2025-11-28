/**
 * Translation entity interface
 * Represents a translation from XTB files
 */
export interface ITranslation {
  /** Primary key */
  id?: number;

  /** Message ID hash (foreign key to messages.id_hash) */
  id_hash: string;

  /** Language code (e.g., 'zh-CN', 'ja', 'fr') */
  lang: string;

  /** Translated text */
  text: string;

  /** Source XTB file path */
  xtb_path: string;

  /** Line number in XTB file */
  start_line?: number;
}

/**
 * Translation statistics for a language
 */
export interface ITranslationStats {
  /** Language code */
  lang: string;

  /** Total number of messages */
  total_messages: number;

  /** Number of translated messages */
  translated_count: number;

  /** Number of missing translations */
  missing_count: number;

  /** Translation coverage percentage (0-100) */
  coverage: number;
}

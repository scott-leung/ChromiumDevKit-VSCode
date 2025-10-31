/**
 * Processed banner after variable substitution
 */
export interface ProcessedBanner {
  /** Template ID used */
  templateId: string;

  /** Complete banner content with variables filled */
  content: string;

  /** Number of lines in the banner */
  lineCount: number;
}

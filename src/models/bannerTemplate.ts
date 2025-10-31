/**
 * Banner template configuration
 */
export interface BannerTemplate {
  /** Unique template identifier */
  id: string;

  /** Display name for UI */
  name: string;

  /** Template content with variable slots ({{Author}}, {{Mail}}, {{Date}}, {{Year}}, {{Company}}) */
  content: string;
}

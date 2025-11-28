/**
 * Configuration interface
 * Represents user configuration from VSCode workspace settings
 */
export interface IConfig {
  /**
   * Enable translation overlay display in code
   * @default true
   */
  enableOverlay: boolean;

  /**
   * Language to display in overlay
   * @default 'zh-CN'
   */
  overlayLanguage: string;

  /**
   * Automatically insert translation comment after IDS constant
   * @default false
   */
  autoInsertComment: boolean;

  /**
   * Enable IDS completion suggestions
   * @default false
   */
  enableCompletion: boolean;

  /**
   * Maximum number of concurrent file parsing tasks
   * @default 10
   */
  maxConcurrency: number;

  /**
   * File patterns to exclude from unused IDS detection
   * @default []
   */
  excludePatterns: string[];

  /**
   * AI translation configuration
   */
  ai: {
    /**
     * AI API base URL (OpenAI compatible)
     * @default 'https://api.openai.com/v1'
     */
    baseUrl: string;

    /**
     * AI model name
     * @default 'gpt-5.1'
     */
    model: string;

    /**
     * Generic translation prompt applied to all target languages
     */
    prompt: string;

    /**
     * Request timeout in milliseconds
     * @default 30000
     */
    timeout: number;

    /**
     * Requests per second limit for translation calls
     * @default 3
     */
    qpsLimit: number;
  };

  /**
   * Debounce delay for file change events (milliseconds)
   * @default 500
   */
  debounceDelay: number;
}

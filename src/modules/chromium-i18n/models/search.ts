/**
 * Search result interfaces for Chromium I18n
 */
import { IMessageWithTranslations } from './message';

/**
 * Result returned by QueryService.searchMessages
 */
export interface ISearchResult {
  /** Matched messages with translations */
  messages: IMessageWithTranslations[];
  /** Total matches without pagination limits */
  total: number;
}

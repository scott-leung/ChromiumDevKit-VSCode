/**
 * Variable context for banner template substitution
 * Note: Property names match template placeholder syntax {{Author}}, {{Mail}}, etc.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface VariableContext {
  /** Author name (from configuration) */
  Author?: string;

  /** Author email (from configuration) */
  Mail?: string;

  /** Current date (formatted according to configuration) */
  Date: string;

  /** Current year */
  Year: string;

  /** Company name (from configuration) */
  Company?: string;
}

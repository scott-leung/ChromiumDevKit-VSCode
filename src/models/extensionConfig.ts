import { BannerTemplate } from './bannerTemplate';

/**
 * Extension configuration loaded from VS Code settings
 */
export interface ExtensionConfig {
  /** Default author name for {{Author}} variable slot */
  author: string;

  /** Default author email for {{Mail}} variable slot */
  email: string;

  /** Company name for {{Company}} variable slot */
  company: string;

  /** Array of banner templates */
  templates: BannerTemplate[];

  /** Default template ID to use (if not specified, uses first template) */
  defaultTemplateId?: string;

  /** Whether to auto-add banner on file creation */
  autoAddOnCreate: boolean;

  /** Whether to generate header guards for .h files */
  enableHeaderGuards: boolean;

  /** Whether to auto-add #include statement for implementation files */
  enableAutoInclude: boolean;

  /** Header guard style (uppercase or lowercase) */
  headerGuardStyle: 'uppercase' | 'lowercase';

  /** Date format for {{Date}} variable slot */
  dateFormat: 'YYYY/MM/DD' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
}

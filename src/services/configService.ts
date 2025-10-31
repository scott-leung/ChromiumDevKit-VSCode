import * as vscode from 'vscode';
import { ExtensionConfig } from '../models/extensionConfig';
import { BannerTemplate } from '../models/bannerTemplate';

/**
 * Service for loading and managing extension configuration
 */
export class ConfigService {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private static readonly CONFIG_SECTION = 'chromiumDevKit';

  /**
   * Load extension configuration from VS Code settings
   */
  public static loadConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);

    // Load templates with default value (matching package.json defaults)
    const templates: BannerTemplate[] = config.get('templates', [
      {
        id: 'quark-chromium',
        name: 'Quark Chromium Style',
        content:
          '//\n// Copyright (C) {{Company}}. All rights reserved.\n// Unauthorized copying of this file, via any medium is strictly prohibited\n// Proprietary and confidential\n// Author: {{Author}}\n// Mail: {{Mail}}\n// Date: {{Date}}\n//\n\n',
      },
      {
        id: 'quark-chromium-simple',
        name: 'Quark Chromium Simple Style',
        content:
          '// Copyright (C) {{Company}}. All rights reserved.\n// Unauthorized copying of this file, via any medium is strictly prohibited\n// Proprietary and confidential\n\n',
      },
    ]);

    // Validate that we have at least one template
    if (templates.length === 0) {
      throw new Error('At least one banner template is required');
    }

    // Validate template structure
    for (const template of templates) {
      if (!template.id || !template.name || !template.content) {
        throw new Error(`Invalid template structure: ${JSON.stringify(template)}`);
      }
    }

    // Check for duplicate template IDs
    const ids = templates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error('Duplicate template IDs found');
    }

    const defaultTemplateId = config.get<string>('defaultTemplateId');

    // Validate defaultTemplateId if provided
    if (defaultTemplateId && !templates.some((t) => t.id === defaultTemplateId)) {
      throw new Error(`Default template ID "${defaultTemplateId}" not found in templates`);
    }

    return {
      author: config.get('author', ''),
      email: config.get('email', ''),
      company: config.get('company', ''),
      templates,
      defaultTemplateId,
      autoAddOnCreate: config.get('autoAddOnCreate', true),
      enableHeaderGuards: config.get('enableHeaderGuards', true),
      enableAutoInclude: config.get('enableAutoInclude', true),
      headerGuardStyle: config.get('headerGuardStyle', 'uppercase'),
      dateFormat: config.get('dateFormat', 'YYYY/MM/DD'),
    };
  }

  /**
   * Get the default template from configuration
   */
  public static getDefaultTemplate(config: ExtensionConfig): BannerTemplate {
    if (config.defaultTemplateId) {
      const template = config.templates.find((t) => t.id === config.defaultTemplateId);
      if (template) {
        return template;
      }
    }
    // Return first template as fallback
    return config.templates[0];
  }
}

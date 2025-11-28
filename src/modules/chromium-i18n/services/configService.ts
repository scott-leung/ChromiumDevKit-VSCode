/**
 * Configuration Service
 * Handles reading and writing VSCode workspace configuration
 * Manages AI API keys using VSCode Secret Storage
 */

import * as vscode from 'vscode';
import { IConfig } from '../models';

/**
 * Configuration Service
 * Provides typed access to extension configuration
 */
export class ConfigService {
  private static readonly CONFIG_SECTION = 'chromiumI18n';
  private static readonly AI_API_KEY_SECRET = 'chromiumI18n.aiApiKey';
  private static readonly AI_API_KEY_SETTING = 'ai.apiKey';
  private static readonly MASKED_API_KEY = '********';
  private static readonly USER_TARGET = vscode.ConfigurationTarget.Global;

  private context: vscode.ExtensionContext | null = null;

  /**
   * Initialize ConfigService with extension context
   * Required for Secret Storage access
   */
  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  /**
   * Get complete configuration object
   * @returns Current configuration with defaults
   */
  public getConfig(): IConfig {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);

    return {
      enableOverlay: config.get<boolean>('overlay.enabled', true),
      overlayLanguage: config.get<string>('defaultLocale', 'zh-CN'),
      autoInsertComment: config.get<boolean>('completion.autoInsertComment', false),
      enableCompletion: config.get<boolean>('completion.enabled', false),
      maxConcurrency: config.get<number>('indexing.maxConcurrency', 10),
      excludePatterns: config.get<string[]>('unusedDetection.excludePatterns', []),
      ai: this.getAIConfig(),
      debounceDelay: config.get<number>('overlay.debounceDelay', 500),
    };
  }

  /**
   * Get AI related configuration
   */
  public getAIConfig(): IConfig['ai'] {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);

    return {
      baseUrl: config.get<string>('ai.baseUrl', 'https://api.openai.com/v1'),
      model: config.get<string>('ai.model', 'gpt-5.1'),
      prompt: config.get<string>(
        'ai.prompt',
        [
          'You are a senior Chromium browser localization specialist.',
          'Translate Chromium GRIT ICU MessageFormat strings to {{lang}}.',
          'Strictly preserve all placeholders (e.g., {ATTEMPTS_LEFT}, {0}, {1}, <ph name="ERROR_MESSAGE" />) and ICU syntax (plural/select branches and keys).',
          'Do not translate or rename placeholders; translate only user-facing text.',
          'Return only the translated string without quotes or explanations.',
        ].join(' ')
      ),
      timeout: config.get<number>('ai.timeout', 30000),
      qpsLimit: config.get<number>('ai.qpsLimit', 3),
    };
  }

  /**
   * Get prompt template for a target language with sensible fallback
   */
  public getPromptForLanguage(lang: string): string {
    const aiConfig = this.getAIConfig();
    const prompt = (aiConfig.prompt || '').trim();

    // Replace placeholder with target language for backward compatibility
    if (prompt.includes('{{lang}}')) {
      return prompt.replace(/{{lang}}/gi, lang);
    }

    if (prompt.length > 0) {
      return `${prompt} Target language: ${lang}.`;
    }

    return `You are a professional software UI translator. Translate the following English text to ${lang}. Keep the translation concise, natural, and suitable for end-user UI.`;
  }

  /**
   * Check if overlay display is enabled
   * @returns true if overlay is enabled
   */
  public isOverlayEnabled(): boolean {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    return config.get<boolean>('overlay.enabled', true);
  }

  /**
   * Get overlay language code
   * @returns Language code (e.g., 'zh-CN', 'ja', 'ko')
   */
  public getOverlayLanguage(): string {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    return config.get<string>('defaultLocale', 'zh-CN');
  }

  /**
   * Get comprehensive overlay configuration
   * @returns Overlay configuration object with all settings
   */
  public getOverlayConfig(): {
    enabled: boolean;
    mode: 'always' | 'hover' | 'shortcut';
    style: {
      color: string;
      backgroundColor: string;
      fontStyle: string;
      prefix: string;
      suffix: string;
    };
    locale: string;
  } {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);

    return {
      enabled: config.get<boolean>('overlay.enabled', true),
      mode: config.get<'always' | 'hover' | 'shortcut'>('overlay.mode', 'always'),
      style: {
        color: config.get<string>('overlay.style.color', '#888'),
        backgroundColor: config.get<string>('overlay.style.backgroundColor', 'transparent'),
        fontStyle: config.get<string>('overlay.style.fontStyle', 'italic'),
        prefix: config.get<string>('overlay.style.prefix', '['),
        suffix: config.get<string>('overlay.style.suffix', ']'),
      },
      locale: config.get<string>('defaultLocale', 'zh-CN'),
    };
  }

  /**
   * Get AI API key from Secret Storage
   * @returns API key or empty string if not set
   */
  public async getAIApiKey(): Promise<string> {
    if (!this.context) {
      throw new Error('ConfigService not initialized. Call initialize() first.');
    }

    // 1) Try Secret Storage first
    const apiKey = await this.context.secrets.get(ConfigService.AI_API_KEY_SECRET);
    if (apiKey) {
      return apiKey;
    }

    // 2) Fallback: user typed API key directly in settings (masked or plain)
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    const configuredKey = config.get<string>(ConfigService.AI_API_KEY_SETTING, '');

    if (configuredKey && configuredKey !== ConfigService.MASKED_API_KEY) {
      await this.context.secrets.store(ConfigService.AI_API_KEY_SECRET, configuredKey);
      await config.update(
        ConfigService.AI_API_KEY_SETTING,
        ConfigService.MASKED_API_KEY,
        ConfigService.USER_TARGET
      );
      return configuredKey;
    }

    return '';
  }

  /**
   * Set AI API key in Secret Storage
   * @param apiKey API key to store
   */
  public async setAIApiKey(apiKey: string): Promise<void> {
    if (!this.context) {
      throw new Error('ConfigService not initialized. Call initialize() first.');
    }

    await this.context.secrets.store(ConfigService.AI_API_KEY_SECRET, apiKey);

    // Keep settings UI masked to avoid leaking the key in plaintext
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    await config.update(
      ConfigService.AI_API_KEY_SETTING,
      ConfigService.MASKED_API_KEY,
      ConfigService.USER_TARGET
    );
  }

  /**
   * Delete AI API key from Secret Storage
   */
  public async deleteAIApiKey(): Promise<void> {
    if (!this.context) {
      throw new Error('ConfigService not initialized. Call initialize() first.');
    }

    await this.context.secrets.delete(ConfigService.AI_API_KEY_SECRET);

    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    await config.update(ConfigService.AI_API_KEY_SETTING, '', ConfigService.USER_TARGET);
  }

  /**
   * Check if AI API key is configured
   * @returns true if API key exists
   */
  public async hasAIApiKey(): Promise<boolean> {
    const apiKey = await this.getAIApiKey();
    return apiKey.length > 0;
  }

  /**
   * Ensure the API key is masked in settings UI if already stored in Secret Storage
   */
  public async ensureMaskedApiKey(): Promise<void> {
    if (!this.context) {
      throw new Error('ConfigService not initialized. Call initialize() first.');
    }

    const secret = await this.context.secrets.get(ConfigService.AI_API_KEY_SECRET);
    if (!secret) {
      return;
    }

    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    const current = config.get<string>(ConfigService.AI_API_KEY_SETTING, '');
    if (current !== ConfigService.MASKED_API_KEY) {
      await config.update(
        ConfigService.AI_API_KEY_SETTING,
        ConfigService.MASKED_API_KEY,
        ConfigService.USER_TARGET
      );
    }
  }

  /**
   * Update configuration value
   * @param key Configuration key (without section prefix)
   * @param value New value
   * @param isGlobal true to update global settings, false for workspace
   */
  public async updateConfig(key: string, value: any, isGlobal: boolean = false): Promise<void> {
    const config = vscode.workspace.getConfiguration(ConfigService.CONFIG_SECTION);
    await config.update(key, value, isGlobal);
  }

  /**
   * Toggle overlay display
   * @returns New overlay enabled state
   */
  public async toggleOverlay(): Promise<boolean> {
    const current = this.isOverlayEnabled();
    await this.updateConfig('overlay.enabled', !current);
    return !current;
  }

  /**
   * Set overlay language
   * @param lang Language code
   */
  public async setOverlayLanguage(lang: string): Promise<void> {
    await this.updateConfig('defaultLocale', lang);
  }

  /**
   * Register configuration change listener
   * @param callback Callback function called when configuration changes
   * @returns Disposable to unregister listener
   */
  public onConfigurationChanged(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(ConfigService.CONFIG_SECTION)) {
        callback();
      }
    });
  }

  /**
   * Ensure API key exists in Secret Storage, prompting the user if missing
   */
  public async ensureApiKeyInteractive(): Promise<string> {
    let apiKey = await this.getAIApiKey();
    if (apiKey) {
      return apiKey;
    }

    const input = await vscode.window.showInputBox({
      title: 'Chromium I18n: Enter AI API Key',
      prompt: 'Enter the AI service API key to call the translation endpoint. This key will be stored securely in VS Code Secret Storage.',
      ignoreFocusOut: true,
      password: true,
      validateInput: (value) => (value.trim().length === 0 ? 'API key cannot be empty' : undefined),
    });

    if (!input) {
      throw new Error('AI API key was not provided; cannot call translation service');
    }

    apiKey = input.trim();
    await this.setAIApiKey(apiKey);
    return apiKey;
  }
}

// Export singleton instance
export const configService = new ConfigService();

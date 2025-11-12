import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';
import { ApplyBannerCommand } from './applyBannerCommand';

/**
 * Registry for all extension commands
 */
export class CommandRegistry {
  /**
   * Register all apply banner commands (1-9)
   * Commands are registered statically, template lookup happens at execution time
   * @param context Extension context for registering commands
   */
  public static registerApplyBannerCommands(context: vscode.ExtensionContext): void {
    try {
      // Always register all 9 commands (matching package.json declarations)
      // Template lookup happens at execution time to support dynamic configuration
      for (let i = 0; i < 9; i++) {
        const templateIndex = i;
        const commandId = `chromiumDevKit.applyTemplate${i + 1}`;

        const disposable = vscode.commands.registerCommand(commandId, async () => {
          // Read config at execution time to get current templates
          const config = await ConfigService.loadConfig();

          // Check if template index is valid
          if (templateIndex >= config.templates.length) {
            vscode.window.showWarningMessage(
              `Template ${templateIndex + 1} is not configured. Please add more templates in settings.`,
            );
            return;
          }

          const template = config.templates[templateIndex];
          await ApplyBannerCommand.execute(template.id);
        });

        context.subscriptions.push(disposable);
      }

      console.log('Registered 9 apply banner commands');
    } catch (error) {
      console.error('Failed to register apply banner commands:', error);
      vscode.window.showErrorMessage(
        `Failed to register banner commands: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

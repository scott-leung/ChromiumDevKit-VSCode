import * as vscode from 'vscode';
import { FileCreateListener } from './listeners/fileCreateListener';
import { CommandRegistry } from './commands/commandRegistry';

/**
 * Extension activation function
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('C++ Banner extension is now active');

  // Register file create listener (T026)
  const fileCreateDisposable = vscode.workspace.onDidCreateFiles(
    FileCreateListener.onDidCreateFiles,
  );
  context.subscriptions.push(fileCreateDisposable);

  // Register apply banner commands (T042)
  CommandRegistry.registerApplyBannerCommands(context);
}

/**
 * Extension deactivation function
 */
export function deactivate() {
  console.log('C++ Banner extension is deactivated');
}

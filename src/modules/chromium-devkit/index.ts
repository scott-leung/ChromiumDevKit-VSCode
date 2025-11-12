import * as vscode from 'vscode';
import { FileCreateListener } from './listeners/fileCreateListener';
import { CommandRegistry } from './commands/commandRegistry';

/**
 * Chromium DevKit Module
 * Provides banner generation, header guards, and auto-includes for C++ development
 */

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Chromium DevKit module activated');

  // Register file create listener for auto-generation
  const fileCreateDisposable = vscode.workspace.onDidCreateFiles(
    FileCreateListener.onDidCreateFiles,
  );
  context.subscriptions.push(fileCreateDisposable);

  // Register keyboard shortcuts (Cmd/Ctrl+Shift+1-9) for banner templates
  CommandRegistry.registerApplyBannerCommands(context);
}

export function deactivate(): void {
  console.log('Chromium DevKit module deactivated');
}

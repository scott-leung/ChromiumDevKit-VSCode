import * as vscode from 'vscode';
import * as chromiumDevKit from './modules/chromium-devkit';
import * as windowColor from './modules/window-color';

/**
 * Chromium Dev Kit Extension
 *
 * A modular VSCode extension providing:
 * - Chromium DevKit: Banner generation, header guards, auto-includes for C++ development
 * - Window Color: Window customization with colors and names for better organization
 */

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Chromium Dev Kit extension is now active');

  try {
    // Activate Chromium DevKit module
    await chromiumDevKit.activate(context);

    // Activate Window Color module
    await windowColor.activate(context);

    console.log('All modules activated successfully');
  } catch (error) {
    console.error('Error activating modules:', error);
    vscode.window.showErrorMessage(`Chromium Dev Kit: Failed to activate - ${error}`);
  }
}

export function deactivate(): void {
  console.log('Chromium Dev Kit extension is deactivated');

  // Deactivate modules
  chromiumDevKit.deactivate();
  windowColor.deactivate();
}

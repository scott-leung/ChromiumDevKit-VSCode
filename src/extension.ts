import * as vscode from 'vscode';
import * as chromiumDevKit from './modules/chromium-devkit';
import * as windowColor from './modules/window-color';
import * as chromiumI18n from './modules/chromium-i18n';

/**
 * Chromium Dev Kit Extension
 *
 * A modular VSCode extension providing:
 * - Chromium DevKit: Banner generation, header guards, auto-includes for C++ development
 * - Window Color: Window customization with colors and names for better organization
 * - Chromium I18n: i18n tooling with GRD/GRDP/XTB indexing, lookup, overlay, and AI translation
 */

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Chromium Dev Kit extension is now active');

  try {
    // Activate Chromium DevKit module
    await chromiumDevKit.activate(context);

    // Activate Window Color module
    await windowColor.activate(context);

    // Activate Chromium I18n module
    await chromiumI18n.activate(context);

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
  chromiumI18n.deactivate();
}

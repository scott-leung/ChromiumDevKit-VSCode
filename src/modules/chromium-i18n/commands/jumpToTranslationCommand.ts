/**
 * Jump to Translation Command
 * Allows jumping to a specific language's translation in XTB files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QueryService } from '../services/queryService';
import { getLanguageDisplayName } from '../utils/languageUtils';

/**
 * Jump to Translation command handler
 * Shows a quick pick menu to select language, then jumps to the XTB file
 */
export async function jumpToTranslationCommand(
  queryService: QueryService,
  chromiumRoot: string,
  args?: { idsName: string; lang?: string }
): Promise<void> {
  try {
    let idsName: string | undefined;

    // Get IDS name from args or from active editor
    if (args && args.idsName) {
      idsName = args.idsName;
    } else {
      // Try to extract from current editor selection
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (selectedText && /^IDS_[A-Z0-9_]+$/.test(selectedText)) {
          idsName = selectedText;
        }
      }
    }

    if (!idsName) {
      vscode.window.showWarningMessage('Select an IDS constant or place the cursor on one.');
      return;
    }

    // Query message
    const message = await queryService.getMessageByName(idsName);
    if (!message) {
      vscode.window.showWarningMessage(`No definition found for ${idsName}`);
      return;
    }

    // Query translations
      const translations = await queryService.getTranslations(message.id_hash);
      if (translations.length === 0) {
        vscode.window.showInformationMessage(`${idsName} has no translations yet`);
        return;
      }

    let selectedTranslation;

    // If specific language is provided in args, jump directly
      if (args?.lang) {
        selectedTranslation = translations.find((trans) => trans.lang === args.lang);
        if (!selectedTranslation) {
          vscode.window.showWarningMessage(`No ${args.lang} translation found for ${idsName}`);
          return;
        }
      } else {
      // Build quick pick items
      const quickPickItems: vscode.QuickPickItem[] = translations.map((trans) => ({
        label: `${getLanguageDisplayName(trans.lang)} (${trans.lang})`,
        description: trans.text.substring(0, 50) + (trans.text.length > 50 ? '...' : ''),
        detail: trans.xtb_path,
      }));

      // Show quick pick
      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Select a translation language (total ${translations.length})`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) {
        return;
      }

      // Find the selected translation
      selectedTranslation = translations.find((trans) => trans.xtb_path === selected.detail);
      if (!selectedTranslation) {
        return;
      }
    }

    // Open XTB file
    const xtbPath = selectedTranslation.xtb_path;
    const absolutePath = path.isAbsolute(xtbPath)
      ? xtbPath
      : path.join(chromiumRoot, xtbPath);

    const uri = vscode.Uri.file(absolutePath);

    // Open document
    const document = await vscode.workspace.openTextDocument(uri);

    // Find translation line (search for id="${message.id_hash}")
    const text = document.getText();
    const searchPattern = new RegExp(`<translation\\s+id\\s*=\\s*["']${message.id_hash}["']`, 'i');
    const lines = text.split('\n');

    let targetLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (searchPattern.test(lines[i])) {
        targetLine = i;
        break;
      }
    }

    // Show document
    const editor = await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(targetLine, 0, targetLine, 0),
      viewColumn: vscode.ViewColumn.Active,
    });

    // Reveal the line
    editor.revealRange(
      new vscode.Range(targetLine, 0, targetLine + 1, 0),
      vscode.TextEditorRevealType.InCenter
    );
  } catch (error) {
    console.error('[jumpToTranslation] Error:', error);
    vscode.window.showErrorMessage(`Error while jumping to translation: ${error}`);
  }
}

/**
 * Jump to Definition command handler (called from hover links)
 */
export async function jumpToDefinitionCommand(
  queryService: QueryService,
  chromiumRoot: string,
  args?: { idsName: string }
): Promise<void> {
  if (!args || !args.idsName) {
    vscode.window.showWarningMessage('Missing IDS name argument');
    return;
  }

  try {
    // Query message
    const message = await queryService.getMessageByName(args.idsName);
    if (!message) {
      vscode.window.showWarningMessage(`No definition found for ${args.idsName}`);
      return;
    }

    // Open definition file
    const sourcePath = message.grdp_path || message.grd_path;
    if (!sourcePath) {
      vscode.window.showWarningMessage(`No source file path found for ${args.idsName}`);
      return;
    }

    const absolutePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.join(chromiumRoot, sourcePath);

    const uri = vscode.Uri.file(absolutePath);
    const document = await vscode.workspace.openTextDocument(uri);

    // Show document at definition line
    // Ensure line number is valid (>= 0)
    const lineNumber = message.start_line ?? 1;
    const targetLine = Math.max(0, lineNumber - 1); // Convert to 0-based, ensure non-negative

    console.log(`[jumpToDefinition] ${args.idsName}: start_line=${message.start_line}, targetLine=${targetLine}`);

    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(targetLine, 0, targetLine, 0),
      viewColumn: vscode.ViewColumn.Active,
    });
  } catch (error) {
    console.error('[jumpToDefinition] Error:', error);
    vscode.window.showErrorMessage(`Error while jumping to definition: ${error}`);
  }
}


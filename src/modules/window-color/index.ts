import * as vscode from 'vscode';
import {
    getContrastColor,
    lightenOrDarkenColor,
    transparency,
    generateRandomColor,
    hexToRgb
} from './utils/helpers';
import {
    applyColorCustomizations,
    readConfig,
    saveWindowReference,
    saveToWorkspaceConfig,
    saveConfigToLocalStorage,
    initializeStorage
} from './services/workspaces';
import { getWorkspaceWebview } from './views/workspace';

export type WindowSettings = {
    windowName: string;
    mainColor: string;
    mainColorContrast?: string;
    isActivityBarColored: boolean;
    isTitleBarColored: boolean;
    isStatusBarColored: boolean;
    isWindowNameColored: boolean;
    isActiveItemsColored: boolean;
    setWindowTitle: boolean;
    autoRecover: boolean;
}

export type WindowReference = {
    directory: string;
}

export type WindowGroup = {
    name: string;
    windows: WindowReference[];
}

let workspaceStatusbar: vscode.StatusBarItem;
let isInitializing = true;
let currentWorkspace: string;
let currentConfig: WindowSettings;

/**
 * Window Color Module
 * Provides window customization with colors and names
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Window Color module activated');

    // Initialize storage with extension context
    initializeStorage(context);

    // Check if we have a workspace file (.code-workspace)
    if (vscode.workspace.workspaceFile) {
        currentWorkspace = vscode.workspace.workspaceFile.fsPath;
    } else {
        currentWorkspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    if (!currentWorkspace) {
        console.log('No workspace detected, Window Color module not initialized');
        return;
    }

                currentConfig = await readConfig(currentWorkspace);
    
    // Save initial configuration to local storage (if not already there)
    await saveConfigToLocalStorage(currentWorkspace, currentConfig);

    // Create status bar item for window name
    workspaceStatusbar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        Infinity
    );

    updateWorkspaceStatusbar(workspaceStatusbar, currentConfig);
    workspaceStatusbar.command = 'chromiumDevKit.openWindowColorSettings';
    workspaceStatusbar.show();

    context.subscriptions.push(workspaceStatusbar);

    // Register command to open settings webview
    createWindowSettingsCommand(context, currentWorkspace);

    // Initialize window title
    updateWindowTitle(currentConfig);

    // Apply initial color customizations
    const initialCustomizations = generateColorCustomizations(currentConfig);
    await applyColorCustomizations(initialCustomizations);

    isInitializing = false;

    // Listen for workbench.colorCustomizations changes
    // Re-apply if deleted or cleared (e.g., when settings.json is deleted), based on user configuration
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('workbench.colorCustomizations')) {
                // Check if auto-recovery is enabled (read from local storage configuration)
                const autoRecover = currentConfig?.autoRecover ?? true;
                
                if (!autoRecover) {
                    console.log('[Window Color] Auto-recovery is disabled by user, skipping color restoration');
                    return;
                }
                
                // Check if our color customizations still exist
                const config = vscode.workspace.getConfiguration();
                const colorCustomizations = config.get<any>('workbench.colorCustomizations') || {};
                
                // Check if key color configurations exist
                const hasOurCustomizations = 
                    colorCustomizations['statusBar.background'] !== undefined ||
                    colorCustomizations['titleBar.activeBackground'] !== undefined ||
                    colorCustomizations['activityBar.background'] !== undefined;
                
                // If our customizations don't exist, re-apply them
                if (!hasOurCustomizations && currentConfig) {
                    console.log('[Window Color] Color customizations were cleared, auto-recovering from local storage...');
                    const customizations = generateColorCustomizations(currentConfig);
                    await applyColorCustomizations(customizations);
                    updateWindowTitle(currentConfig);
                }
            }
        })
    );

    // Listen for workspace folder changes (when switching workspaces)
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            let newWorkspace: string;
            if (vscode.workspace.workspaceFile) {
                newWorkspace = vscode.workspace.workspaceFile.fsPath;
            } else {
                newWorkspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
            }

            if (newWorkspace && newWorkspace !== currentWorkspace) {
                console.log(`[Window Color] Workspace changed from ${currentWorkspace} to ${newWorkspace}`);
                currentWorkspace = newWorkspace;
                currentConfig = await readConfig(currentWorkspace);
                
                const customizations = generateColorCustomizations(currentConfig);
                await applyColorCustomizations(customizations);
                updateWorkspaceStatusbar(workspaceStatusbar, currentConfig);
                updateWindowTitle(currentConfig);
            }
        })
    );
}

async function createWindowSettingsWebview(context: vscode.ExtensionContext, directory: string) {
    const panel = vscode.window.createWebviewPanel(
        'windowSettings',
        'Chromium Dev Kit: Window Color Settings',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    async function updateWebview() {
        const args = await readConfig(directory);
        const packageJson = require('../../../package.json');
        panel.webview.html = getWorkspaceWebview(args, packageJson.version);
    }

    panel.onDidChangeViewState(async () => {
        if (panel.visible) {
            await updateWebview();
        }
    });

    panel.webview.onDidReceiveMessage(
        async (message) => {
            if (message.command === 'setProps') {
                let editingIsCurrentWorkspace = directory === vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                let newProps: WindowSettings = message.props;

                // Update mainColorContrast
                newProps.mainColorContrast = getContrastColor(newProps.mainColor);

                const webviewCustomizations = generateColorCustomizations(newProps);
                applyColorCustomizations(webviewCustomizations);

                if (editingIsCurrentWorkspace) {
                    updateWorkspaceStatusbar(workspaceStatusbar, newProps);
                    updateWindowTitle(newProps);
                    // Update global currentConfig so listeners can read the latest autoRecover value
                    currentConfig = newProps;
                }

                try {
                    // Save configuration to local storage
                    await saveConfigToLocalStorage(directory, newProps);
                    console.log(`[Window Color] Configuration saved successfully for: ${directory}`);

                    // Save workspace reference to global configuration
                    const reference: WindowReference = {
                        directory: directory
                    };
                    await saveWindowReference(reference);
                } catch (error: any) {
                    console.error(`[Window Color] Error saving settings: ${error.message}`);
                    vscode.window.showErrorMessage(`Failed to save window color settings: ${error.message}`);
                }
            }
        },
        undefined,
        context.subscriptions
    );

    await updateWebview();
}

function createWindowSettingsCommand(context: vscode.ExtensionContext, currentWorkspace: string) {
    const disposable = vscode.commands.registerCommand('chromiumDevKit.openWindowColorSettings', async () => {
        let workspace: string;
        if (vscode.workspace.workspaceFile) {
            workspace = vscode.workspace.workspaceFile.fsPath;
        } else {
            workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        }
        await createWindowSettingsWebview(context, workspace);
    });
    context.subscriptions.push(disposable);
}

function updateWorkspaceStatusbar(item: vscode.StatusBarItem, args: WindowSettings): void {
    item.text = `${args.windowName}`;
    if (args.isWindowNameColored || args.isStatusBarColored) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    } else {
        item.backgroundColor = undefined;
        item.color = undefined;
    }
    item.tooltip = `Project: ${args.windowName}\nColor: ${args.mainColor}`;
}

function updateWindowTitle(args: WindowSettings): void {
    const config = vscode.workspace.getConfiguration('window');
    const defaultTitle = config.inspect('title')?.defaultValue || '';
    const customTitle = args.setWindowTitle ? `${args.windowName}` : defaultTitle;

    try {
        config.update('title', customTitle, vscode.ConfigurationTarget.Workspace);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to update window title: ${error.message}`);
    }
}

function generateColorCustomizations(args: WindowSettings): any {
    const contrastColor = getContrastColor(args.mainColor);
    const semiTransparentContrast = `${contrastColor}90`;

    const customizations: any = {
        "workbench.colorCustomizations": {}
    };

    if (args.isTitleBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "titleBar.activeBackground": args.mainColor,
            "titleBar.activeForeground": contrastColor,
            "titleBar.inactiveBackground": args.mainColor,
            "titleBar.inactiveForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "titleBar.activeBackground": null,
            "titleBar.activeForeground": null,
            "titleBar.inactiveBackground": null,
            "titleBar.inactiveForeground": null,
        };
    }

    if (args.isWindowNameColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBarItem.warningBackground": args.mainColor,
            "statusBarItem.warningForeground": contrastColor,
            "statusBarItem.warningHoverBackground": args.mainColor,
            "statusBarItem.warningHoverForeground": semiTransparentContrast,
            "statusBarItem.remoteBackground": args.mainColor,
            "statusBarItem.remoteForeground": contrastColor,
            "statusBarItem.remoteHoverBackground": args.mainColor,
            "statusBarItem.remoteHoverForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBarItem.warningBackground": null,
            "statusBarItem.warningForeground": null,
            "statusBarItem.warningHoverBackground": null,
            "statusBarItem.warningHoverForeground": null,
            "statusBarItem.remoteBackground": null,
            "statusBarItem.remoteForeground": null,
            "statusBarItem.remoteHoverBackground": null,
            "statusBarItem.remoteHoverForeground": null,
        };
    }

    if (args.isStatusBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBar.background": args.mainColor,
            "statusBar.foreground": contrastColor,
            "statusBarItem.warningBackground": args.mainColor,
            "statusBarItem.warningForeground": contrastColor,
            "statusBarItem.warningHoverBackground": args.mainColor,
            "statusBarItem.warningHoverForeground": semiTransparentContrast,
            "statusBar.border": args.mainColor,
            "statusBar.debuggingBackground": args.mainColor,
            "statusBar.debuggingForeground": contrastColor,
            "statusBar.debuggingBorder": args.mainColor,
            "statusBar.noFolderBackground": args.mainColor,
            "statusBar.noFolderForeground": contrastColor,
            "statusBar.noFolderBorder": args.mainColor,
            "statusBar.prominentBackground": args.mainColor,
            "statusBar.prominentForeground": contrastColor,
            "statusBar.prominentHoverBackground": args.mainColor,
            "statusBar.prominentHoverForeground": semiTransparentContrast,
            "statusBarItem.remoteBackground": lightenOrDarkenColor(args.mainColor, 5),
            "statusBarItem.remoteForeground": contrastColor,
            "statusBarItem.remoteHoverBackground": lightenOrDarkenColor(args.mainColor, 10),
            "statusBarItem.remoteHoverForeground": semiTransparentContrast,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "statusBar.background": null,
            "statusBar.foreground": null,
            ...(args.isWindowNameColored ? {} : {
                "statusBarItem.warningBackground": null,
                "statusBarItem.warningForeground": null,
                "statusBarItem.warningHoverBackground": null,
                "statusBarItem.warningHoverForeground": null,
            }),
            "statusBar.border": null,
            "statusBar.debuggingBackground": null,
            "statusBar.debuggingForeground": null,
            "statusBar.debuggingBorder": null,
            "statusBar.noFolderBackground": null,
            "statusBar.noFolderForeground": null,
            "statusBar.noFolderBorder": null,
            "statusBar.prominentBackground": null,
            "statusBar.prominentForeground": null,
            "statusBar.prominentHoverBackground": null,
            "statusBar.prominentHoverForeground": null,
            ...(args.isWindowNameColored ? {} : {
                "statusBarItem.remoteBackground": null,
                "statusBarItem.remoteForeground": null,
                "statusBarItem.remoteHoverBackground": null,
                "statusBarItem.remoteHoverForeground": null,
            }),
        };
    }

    if (args.isActiveItemsColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            ...(!args.isWindowNameColored && !args.isStatusBarColored ? {
                "statusBarItem.warningBackground": args.mainColor,
                "statusBarItem.warningForeground": contrastColor,
                "statusBarItem.warningHoverBackground": args.mainColor,
                "statusBarItem.warningHoverForeground": semiTransparentContrast,
                "statusBarItem.remoteBackground": args.mainColor,
                "statusBarItem.remoteForeground": contrastColor,
                "statusBarItem.remoteHoverBackground": args.mainColor,
                "statusBarItem.remoteHoverForeground": semiTransparentContrast,
            } : {}),
            "focusBorder": transparency(args.mainColor, 0.6),
            "progressBar.background": args.mainColor,
            "textLink.foreground": lightenOrDarkenColor(args.mainColor, 25),
            "textLink.activeForeground": lightenOrDarkenColor(args.mainColor, 30),
            "selection.background": lightenOrDarkenColor(args.mainColor, -5),
            "list.highlightForeground": lightenOrDarkenColor(args.mainColor, 0),
            "list.focusAndSelectionOutline": transparency(args.mainColor, 0.6),
            "button.background": args.mainColor,
            "button.foreground": contrastColor,
            "button.hoverBackground": lightenOrDarkenColor(args.mainColor, 5),
            "tab.activeBorderTop": lightenOrDarkenColor(args.mainColor, 5),
            "pickerGroup.foreground": lightenOrDarkenColor(args.mainColor, 5),
            "list.activeSelectionBackground": transparency(args.mainColor, 0.3),
            "panelTitle.activeBorder": lightenOrDarkenColor(args.mainColor, 5),
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            ...(!args.isWindowNameColored && !args.isStatusBarColored ? {
                "statusBarItem.warningBackground": null,
                "statusBarItem.warningForeground": null,
                "statusBarItem.warningHoverBackground": null,
                "statusBarItem.warningHoverForeground": null,
                "statusBarItem.remoteBackground": null,
                "statusBarItem.remoteForeground": null,
                "statusBarItem.remoteHoverBackground": null,
                "statusBarItem.remoteHoverForeground": null,
            } : {}),
            ...(!args.isStatusBarColored ? {
                "statusBar.background": null,
                "statusBar.foreground": null,
                "statusBar.border": null,
                "statusBar.debuggingBackground": null,
                "statusBar.debuggingForeground": null,
                "statusBar.debuggingBorder": null,
                "statusBar.noFolderBackground": null,
                "statusBar.noFolderForeground": null,
                "statusBar.noFolderBorder": null,
                "statusBar.prominentBackground": null,
                "statusBar.prominentForeground": null,
                "statusBar.prominentHoverBackground": null,
                "statusBar.prominentHoverForeground": null,
            } : {}),
            "focusBorder": null,
            "progressBar.background": null,
            "textLink.foreground": null,
            "textLink.activeForeground": null,
            "selection.background": null,
            "list.highlightForeground": null,
            "list.focusAndSelectionOutline": null,
            "button.background": null,
            "button.foreground": null,
            "button.hoverBackground": null,
            "tab.activeBorderTop": null,
            "pickerGroup.foreground": null,
            "list.activeSelectionBackground": null,
            "panelTitle.activeBorder": null,
        };
    }

    if (args.isActivityBarColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": args.mainColor,
            "activityBar.foreground": contrastColor,
            "activityBar.activeBorder": args.isActiveItemsColored ? args.mainColor : contrastColor,
            "activityBar.inactiveForeground": semiTransparentContrast,
            "activityBarBadge.foreground": args.isActiveItemsColored ? contrastColor : (contrastColor === "#ffffff" ? "#000000" : "#ffffff"),
            "activityBarBadge.background": args.isActiveItemsColored ? args.mainColor : (contrastColor === "#ffffff" ? lightenOrDarkenColor(args.mainColor, 75) : lightenOrDarkenColor(args.mainColor, -75)),
        };
    } else if (args.isActiveItemsColored) {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": null,
            "activityBar.foreground": null,
            "activityBar.activeBorder": args.mainColor,
            "activityBar.inactiveForeground": null,
            "activityBarBadge.foreground": contrastColor,
            "activityBarBadge.background": args.mainColor,
        };
    } else {
        customizations["workbench.colorCustomizations"] = {
            ...customizations["workbench.colorCustomizations"],
            "activityBar.background": null,
            "activityBar.foreground": null,
            "activityBar.activeBorder": null,
            "activityBar.inactiveForeground": null,
            "activityBarBadge.foreground": null,
            "activityBarBadge.background": null,
        };
    }

    return customizations;
}

export function deactivate(): void {
    console.log('Window Color module deactivated');
}

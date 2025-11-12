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
    saveToWorkspaceConfig
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

/**
 * Window Color Module
 * Provides window customization with colors and names
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Window Color module activated');

    // Check if we have a workspace file (.code-workspace)
    let currentWorkspace: string;
    if (vscode.workspace.workspaceFile) {
        currentWorkspace = vscode.workspace.workspaceFile.fsPath;
    } else {
        currentWorkspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    if (!currentWorkspace) {
        console.log('No workspace detected, Window Color module not initialized');
        return;
    }

    let currentConfig = await readConfig(currentWorkspace);

    // Try to save default values if they don't exist
    // Wrapped in try-catch to prevent activation failure during upgrades
    const workspaceConfig = vscode.workspace.getConfiguration('chromiumDevKit');
    const needsDefaults = !workspaceConfig.get('windowColor.mainColor') ||
                         workspaceConfig.get('windowColor.isStatusBarColored') === undefined ||
                         workspaceConfig.get('windowColor.isWindowNameColored') === undefined ||
                         workspaceConfig.get('windowColor.isActiveItemsColored') === undefined ||
                         workspaceConfig.get('windowColor.setWindowTitle') === undefined;

    if (needsDefaults) {
        try {
            const savePromises = [];

            if (!workspaceConfig.get('windowColor.mainColor') && currentConfig.mainColor) {
                savePromises.push(saveToWorkspaceConfig('mainColor', currentConfig.mainColor));
            }
            if (workspaceConfig.get('windowColor.isStatusBarColored') === undefined) {
                savePromises.push(saveToWorkspaceConfig('isStatusBarColored', currentConfig.isStatusBarColored));
            }
            if (workspaceConfig.get('windowColor.isWindowNameColored') === undefined) {
                savePromises.push(saveToWorkspaceConfig('isWindowNameColored', currentConfig.isWindowNameColored));
            }
            if (workspaceConfig.get('windowColor.isActiveItemsColored') === undefined) {
                savePromises.push(saveToWorkspaceConfig('isActiveItemsColored', currentConfig.isActiveItemsColored));
            }
            if (workspaceConfig.get('windowColor.setWindowTitle') === undefined) {
                savePromises.push(saveToWorkspaceConfig('setWindowTitle', currentConfig.setWindowTitle));
            }

            const results = await Promise.all(savePromises);
            const successCount = results.filter(r => r).length;
            const failCount = results.filter(r => !r).length;

            if (failCount > 0) {
                console.warn(`[Window Color] ${failCount} configuration write(s) failed during activation. Extension will use in-memory defaults.`);
                // Show a one-time informational message for upgrades
                vscode.window.showInformationMessage(
                    'Chromium Dev Kit: Window Color configuration may need manual setup. Please open settings to configure.',
                    'Open Settings'
                ).then(selection => {
                    if (selection === 'Open Settings') {
                        vscode.commands.executeCommand('chromiumDevKit.openWindowColorSettings');
                    }
                });
            } else {
                currentConfig = await readConfig(currentWorkspace);
            }
        } catch (error: any) {
            // Continue activation even if default writing fails completely
            console.error(`[Window Color] Failed to write default configuration: ${error.message}`);
            console.error('[Window Color] Continuing with in-memory defaults. Extension will still function.');
        }
    }

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

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('chromiumDevKit.windowColor') && !isInitializing) {
                const updatedConfig = await readConfig(currentWorkspace);
                const updatedCustomizations = generateColorCustomizations(updatedConfig);
                await applyColorCustomizations(updatedCustomizations);
                updateWorkspaceStatusbar(workspaceStatusbar, updatedConfig);
                updateWindowTitle(updatedConfig);
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

                const webviewCustomizations = generateColorCustomizations(newProps);
                applyColorCustomizations(webviewCustomizations);

                if (editingIsCurrentWorkspace) {
                    updateWorkspaceStatusbar(workspaceStatusbar, newProps);
                    updateWindowTitle(newProps);
                }

                try {
                    const savePromises = [
                        saveToWorkspaceConfig('name', newProps.windowName),
                        saveToWorkspaceConfig('mainColor', newProps.mainColor),
                        saveToWorkspaceConfig('isActivityBarColored', newProps.isActivityBarColored),
                        saveToWorkspaceConfig('isTitleBarColored', newProps.isTitleBarColored),
                        saveToWorkspaceConfig('isStatusBarColored', newProps.isStatusBarColored),
                        saveToWorkspaceConfig('isWindowNameColored', newProps.isWindowNameColored),
                        saveToWorkspaceConfig('isActiveItemsColored', newProps.isActiveItemsColored),
                        saveToWorkspaceConfig('setWindowTitle', newProps.setWindowTitle)
                    ];

                    const results = await Promise.all(savePromises);
                    const failCount = results.filter(r => !r).length;

                    if (failCount > 0) {
                        vscode.window.showWarningMessage(
                            `Chromium Dev Kit: ${failCount} setting(s) could not be saved. Changes are applied visually but may not persist.`
                        );
                    }

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

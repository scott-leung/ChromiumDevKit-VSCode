import * as vscode from 'vscode';
import { WindowSettings, WindowReference, WindowGroup } from '../index';
import { getContrastColor, generateRandomColor } from '../utils/helpers';

// Extension context for accessing storage
let extensionContext: vscode.ExtensionContext | undefined;

export function initializeStorage(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

export async function loadWorkspaces(): Promise<(WindowReference & { settings: WindowSettings })[]> {
    const references = loadWindowReferences();
    return await Promise.all(references.map(async ref => {
        const config = await loadWorkspaceConfig(ref.directory);
        return config ? { ...ref, ...{ settings: config } } : null;
    })).then(results => results.filter(Boolean) as (WindowReference & { settings: WindowSettings })[]);
}

/**
 * Read workspace configuration from local storage
 */
async function readConfigFromLocalStorage(directory: string): Promise<WindowSettings | null> {
    if (!extensionContext) {
        return null;
    }

    const storageKey = `windowColor.workspace.${directory}`;
    const stored = extensionContext.globalState.get<WindowSettings>(storageKey);
    
    if (stored) {
        // Ensure mainColorContrast is up to date
        stored.mainColorContrast = getContrastColor(stored.mainColor);
        
        // Ensure autoRecover field exists (for backward compatibility with old stored data)
        if (stored.autoRecover === undefined) {
            stored.autoRecover = true;
        }
    }
    
    return stored || null;
}

/**
 * Save workspace configuration to local storage
 */
export async function saveConfigToLocalStorage(directory: string, settings: WindowSettings): Promise<void> {
    if (!extensionContext) {
        console.warn('[Window Color] Extension context not initialized');
        return;
    }

    const storageKey = `windowColor.workspace.${directory}`;
    await extensionContext.globalState.update(storageKey, settings);
    console.log(`[Window Color] Configuration saved to local storage for: ${directory}`);
}

/**
 * Read configuration from .vscode/settings.json (for backward compatibility)
 */
async function readConfigFromWorkspaceFile(directory: string): Promise<Partial<WindowSettings>> {
    const uri = vscode.Uri.file(directory);
    const configPath = directory.endsWith('.code-workspace') ? uri : uri.with({ path: `${uri.path}/.vscode/settings.json` });

    let settings: any;
    try {
        const config = await vscode.workspace.fs.readFile(configPath);
        settings = JSON.parse(config.toString());
    } catch (error: any) {
        // It's normal if the file doesn't exist or fails to read
        return {};
    }

    const windowColorSettings = directory.endsWith('.code-workspace') ? (settings['settings'] || {}) : settings;

    return {
        windowName: windowColorSettings['chromiumDevKit.windowColor.name'],
        mainColor: windowColorSettings['chromiumDevKit.windowColor.mainColor'],
        isActivityBarColored: windowColorSettings['chromiumDevKit.windowColor.isActivityBarColored'],
        isTitleBarColored: windowColorSettings['chromiumDevKit.windowColor.isTitleBarColored'],
        isStatusBarColored: windowColorSettings['chromiumDevKit.windowColor.isStatusBarColored'],
        isWindowNameColored: windowColorSettings['chromiumDevKit.windowColor.isWindowNameColored'],
        isActiveItemsColored: windowColorSettings['chromiumDevKit.windowColor.isActiveItemsColored'],
        setWindowTitle: windowColorSettings['chromiumDevKit.windowColor.setWindowTitle'],
        autoRecover: windowColorSettings['chromiumDevKit.windowColor.autoRecover']
    };
}

export async function readConfig(directory: string): Promise<WindowSettings> {
    // Try reading from local storage first
    let config = await readConfigFromLocalStorage(directory);
    
    if (!config) {
        // If not in local storage, try reading from .vscode/settings.json (backward compatibility)
        const legacyConfig = await readConfigFromWorkspaceFile(directory);
        
        const fallbackWindowName = directory.split('/').pop() || 'Untitled Window';
        const mainColor = legacyConfig.mainColor || generateRandomColor();
        
        config = {
            windowName: legacyConfig.windowName || fallbackWindowName,
            mainColor: mainColor,
            mainColorContrast: getContrastColor(mainColor),
            isActivityBarColored: legacyConfig.isActivityBarColored ?? false,
            isTitleBarColored: legacyConfig.isTitleBarColored ?? false,
            isStatusBarColored: legacyConfig.isStatusBarColored ?? true,
            isWindowNameColored: legacyConfig.isWindowNameColored ?? true,
            isActiveItemsColored: legacyConfig.isActiveItemsColored ?? true,
            setWindowTitle: legacyConfig.setWindowTitle ?? true,
            autoRecover: legacyConfig.autoRecover ?? true
        };
        
        // If we got valid data from legacy config, migrate to local storage
        if (legacyConfig.mainColor) {
            await saveConfigToLocalStorage(directory, config);
            console.log(`[Window Color] Migrated configuration from .vscode/settings.json to local storage for: ${directory}`);
        } else {
            // If no legacy config, save the newly generated config
            await saveConfigToLocalStorage(directory, config);
        }
    }
    
    // config is guaranteed to be non-null now
    return config!;
}

export async function saveWindowReference(reference: WindowReference): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    const references = config.get<WindowReference[]>('workspaces') || [];
    const existingIndex = references.findIndex(ref => ref.directory === reference.directory);

    if (existingIndex >= 0) {
        references[existingIndex] = reference;
    } else {
        references.push(reference);
    }

    await config.update('workspaces', references, vscode.ConfigurationTarget.Global);
}

export async function deleteWindowReference(directory: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    let references = config.get<WindowReference[]>('workspaces') || [];
    references = references.filter(ref => ref.directory !== directory);
    await config.update('workspaces', references, vscode.ConfigurationTarget.Global);
}

export async function moveWorkspace(draggedDirectory: string, targetDirectory: string): Promise<void> {
    const groups = loadWindowGroups();

    const draggedGroup = groups.find(group => group.windows.some(window => window.directory === draggedDirectory));
    const targetGroup = groups.find(group => group.windows.some(window => window.directory === targetDirectory));

    if (!draggedGroup || !targetGroup) {
        throw new Error('Both dragged and target directories must belong to a group');
    }

    const draggedWindow = draggedGroup.windows.find(window => window.directory === draggedDirectory);
    if (!draggedWindow) {
        throw new Error('Dragged window not found in its group');
    }

    // Remove the window from the dragged group
    draggedGroup.windows = draggedGroup.windows.filter(window => window.directory !== draggedDirectory);

    // If the dragged and target directories are in the same group, update the group
    if (draggedGroup === targetGroup) {
        const targetIndex = targetGroup.windows.findIndex(window => window.directory === targetDirectory);
        targetGroup.windows.splice(targetIndex, 0, draggedWindow);
    } else {
        // Otherwise, move it to the new group before the target
        const targetIndex = targetGroup.windows.findIndex(window => window.directory === targetDirectory);
        targetGroup.windows.splice(targetIndex, 0, draggedWindow);
    }

    await saveWindowGroup(draggedGroup);
    await saveWindowGroup(targetGroup);
}

export async function saveWindowGroup(group: WindowGroup): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    const groups = config.get<WindowGroup[]>('groups') || [];
    const existingIndex = groups.findIndex(g => g.name === group.name);

    if (existingIndex >= 0) {
        groups[existingIndex] = group;
    } else {
        groups.push(group);
    }

    await config.update('groups', groups, vscode.ConfigurationTarget.Global);
}

export async function deleteWindowGroup(groupName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    let groups = config.get<WindowGroup[]>('groups') || [];
    groups = groups.filter(g => g.name !== groupName);
    await config.update('groups', groups, vscode.ConfigurationTarget.Global);
}

export function loadWindowReferences(): WindowReference[] {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    return config.get<WindowReference[]>('workspaces') || [];
}

export function loadWindowGroups(): WindowGroup[] {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    return config.get<WindowGroup[]>('groups') || [];
}

export async function loadWorkspaceConfig(directory: string): Promise<WindowSettings | null> {
    try {
        return await readConfig(directory);
    } catch (error: any) {
        console.error(`Failed to load workspace config for ${directory}: ${error.message}`);
        return null;
    }
}

/**
 * @deprecated This function is deprecated, configuration is now saved to local storage instead of workspace settings
 */
export async function saveToWorkspaceConfig(key: string, value: string | boolean): Promise<boolean> {
    console.warn(`[Window Color] saveToWorkspaceConfig is deprecated. Configuration is now saved to local storage.`);
    return true;
}

export async function saveWorkspaceToGroup(groupName: string, workspace: WindowReference): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    const groups = config.get<WindowGroup[]>('groups') || [];
    const group = groups.find(g => g.name === groupName) || { name: groupName, windows: [] };
    group.windows.push(workspace);
    await saveWindowGroup(group);
}

export async function renameWindowGroup(oldName: string, newName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('chromiumDevKit.windowColor');
    let groups = config.get<WindowGroup[]>('groups') || [];
    const group = groups.find(g => g.name === oldName);

    if (group) {
        group.name = newName;
        await config.update('groups', groups, vscode.ConfigurationTarget.Global);
    }
}

export async function applyColorCustomizations(customizations: any) {
    // console.log('[DEBUG] applyColorCustomizations called with:', JSON.stringify(customizations, null, 2));
    const config = vscode.workspace.getConfiguration();
    try {
        // Get existing color customizations to preserve any user-defined colors
        const existingCustomizations = config.get<any>("workbench.colorCustomizations") || {};
        // console.log('[DEBUG] Existing color customizations:', JSON.stringify(existingCustomizations, null, 2));
        
        // Merge with new customizations (new ones override existing)
        const mergedCustomizations = {
            ...existingCustomizations,
            ...customizations["workbench.colorCustomizations"]
        };
        
        // Remove null values to clear disabled colors
        Object.keys(mergedCustomizations).forEach(key => {
            if (mergedCustomizations[key] === null) {
                delete mergedCustomizations[key];
            }
        });
        // console.log('[DEBUG] Merged color customizations:', JSON.stringify(mergedCustomizations, null, 2));
        
        await config.update(
            "workbench.colorCustomizations",
            mergedCustomizations,
            vscode.ConfigurationTarget.Workspace
        );
        // console.log('[DEBUG] Color customizations successfully applied to workspace');
    } catch (error: any) {
        console.error('[DEBUG] Failed to apply color customizations:', error.message);
        vscode.window.showErrorMessage(`Failed to apply color customizations: ${error.message}`);
    }
}

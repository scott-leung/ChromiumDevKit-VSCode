# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chromium Dev Kit is a modular VSCode extension that provides:

### Module 1: Chromium DevKit (C++ Development Tools)
- Automated banner comment generation with customizable templates
- Header guard generation for C++ header files
- Auto-include statements for implementation files
- Support for C++, Objective-C++, Mojom, and IDL files

### Module 2: Window Color (Window Customization)
- Window color customization (activity bar, title bar, status bar, active items)
- Dynamic window name display in status bar
- Interactive settings panel for easy configuration
- Live configuration updates
- Multi-workspace color management

## Architecture

The extension follows a **modular architecture** to support easy integration of multiple plugins:

```
src/
├── extension.ts              # Main coordinator - activates all modules
├── modules/
│   ├── chromium-devkit/      # C++ development tools module
│   │   ├── index.ts          # Module entry point (activate/deactivate)
│   │   ├── services/         # Core business logic
│   │   ├── commands/         # Command implementations
│   │   ├── listeners/        # Event listeners
│   │   └── models/           # TypeScript interfaces
│   │
│   └── window-color/         # Window customization module
│       ├── index.ts          # Module entry point (activate/deactivate)
│       ├── services/         # Configuration and workspace management
│       ├── commands/         # Command registry
│       ├── views/            # Webview HTML generators
│       └── utils/            # Color manipulation helpers
│
└── (legacy directories maintained for backward compatibility)
```

### Module Pattern

Each module:
1. Exports an `activate(context: vscode.ExtensionContext)` function
2. Exports a `deactivate()` function
3. Is self-contained with its own services, commands, and configuration
4. Is activated by the main extension.ts coordinator
5. Operates independently without cross-module dependencies

## Build and Development Commands

### Compile TypeScript
```bash
npm run compile
```
Compiles TypeScript to JavaScript in the `out/` directory.

### Watch Mode (Development)
```bash
npm run watch
```
Continuously watches for file changes and recompiles automatically.

### Lint
```bash
npm run lint
```
Runs ESLint on all TypeScript files in `src/`.

### Package Extension
```bash
npm run package
```
Compiles and packages the extension into a `.vsix` file for distribution.

### Test Extension
Press `F5` in VSCode to launch Extension Development Host with the extension loaded.

## Architecture

### Entry Point
- **src/extension.ts**: Extension activation/deactivation coordinator. Activates both modules sequentially.

### Chromium DevKit Module (src/modules/chromium-devkit/)

**Core Services (MVC Pattern)**
- **BannerService** (services/bannerService.ts): Processes banner templates by replacing variable placeholders ({{Author}}, {{Mail}}, {{Date}}, {{Year}}, {{Company}}) and inserts banners/includes into documents.
- **HeaderGuardService** (services/headerGuardService.ts): Generates header guard macro names from file paths and inserts `#ifndef`/`#define`/`#endif` structures.
- **PathService** (services/pathService.ts): Handles path calculations, file type detection, and header guard macro name generation from relative workspace paths.
- **ConfigService** (services/configService.ts): Loads and validates extension configuration from VSCode settings.
- **DetectionService** (services/detectionService.ts): Smart detection of existing banners and header guards to avoid duplication.

**Command Layer**
- **CommandRegistry** (commands/commandRegistry.ts): Registers 9 keyboard shortcuts (Cmd/Ctrl+Shift+1-9) for applying banner templates. Template lookup happens at execution time to support dynamic configuration.
- **ApplyBannerCommand** (commands/applyBannerCommand.ts): Executes banner application logic for manual command invocation.

**Event Listeners**
- **FileCreateListener** (listeners/fileCreateListener.ts): Automatically adds banners, header guards, and include statements when new C++/Mojom files are created. Includes smart detection to avoid duplicates.

**Data Models** (models/)
All models are TypeScript interfaces defining data structures for templates, configuration, file info, header guards, and processed banners.

### Window Color Module (src/modules/window-color/)

**Services**
- **workspaces.ts** (services/): Configuration management for window colors and names. Handles reading/writing workspace-specific settings, managing workspace references, and multi-workspace support.

**Utils**
- **helpers.ts** (utils/): Color manipulation utilities including contrast calculation, lightening/darkening, transparency, HSL to RGB conversion, and random color generation.

**Views**
- **workspace.ts**, **list.ts** (views/): HTML generators for webview panels used in the settings UI.

**Commands**
- Registers `set-window-color-name.openSettings` command that opens an interactive webview panel for customizing window colors and names.

**Status Bar Integration**
- Creates a status bar item displaying the current window name, clickable to open settings.

**Live Updates**
- Listens to configuration changes and applies color customizations immediately through `workbench.colorCustomizations`.

## Key Design Patterns

### Template Variable Replacement
The extension uses mustache-style placeholders (`{{Variable}}`) that get replaced at runtime:
- `{{Author}}`, `{{Mail}}`, `{{Company}}` → from user configuration
- `{{Date}}` → formatted using configurable date format
- `{{Year}}` → current year

### Header Guard Macro Generation
Converts relative file paths to macro names:
- `browser/account/test.h` → `BROWSER_ACCOUNT_TEST_H_` (uppercase style)
- Replaces path separators and dots with underscores

### Smart Detection
Before auto-inserting, the extension checks for existing:
- Banner comments (looks for copyright patterns)
- Header guards (looks for `#ifndef`/`#define` patterns)
- This prevents duplication when files are created programmatically

## Configuration

### Chromium DevKit Configuration (`chromiumDevKit.*`)
Extension behavior for C++ development tools is controlled through VSCode settings. All configuration is read at execution time, allowing dynamic updates without reloading the extension.

Key settings:
- `templates`: Array of banner templates with id/name/content
- `defaultTemplateId`: Template used for auto-generation on file creation
- `autoAddOnCreate`: Enable/disable automatic banner insertion
- `enableHeaderGuards`: Enable/disable header guard generation for `.h` files
- `enableAutoInclude`: Enable/disable auto `#include` for implementation files
- `headerGuardStyle`: "uppercase" or "lowercase" macro names
- `dateFormat`: Format for `{{Date}}` variable

### Window Color Configuration (`windowColor.*`)
Window customization settings are workspace-specific, allowing different colors for different projects.

Key settings:
- `name`: Display name for the window in status bar
- `mainColor`: Primary color (hex format) for UI customization
- `isActivityBarColored`: Enable/disable activity bar coloring
- `isTitleBarColored`: Enable/disable title bar coloring
- `isStatusBarColored`: Enable/disable status bar coloring
- `isWindowNameColored`: Enable/disable window name coloring in status bar
- `isActiveItemsColored`: Enable/disable active elements coloring
- `setWindowTitle`: Set the VSCode window title to the window name
- `workspaces`: Global list of saved workspace configurations
- `groups`: Global list of workspace groups for organization

## Adding New Modules

To add a new plugin/module to this extension:

1. **Create module directory**: `src/modules/your-module-name/`
2. **Implement module interface**: Create `index.ts` with `activate()` and `deactivate()` functions
3. **Organize code**: Use subdirectories (services/, commands/, etc.) as needed
4. **Update main extension**: Import and activate your module in `src/extension.ts`
5. **Add configuration**: Extend `package.json` contributes section with your settings
6. **Register commands**: Add any commands to `package.json` contributes.commands
7. **Document**: Update this CLAUDE.md file with your module's architecture and features

Example module structure:
```typescript
// src/modules/your-module/index.ts
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Your module activated');
  // Your module initialization
}

export function deactivate(): void {
  console.log('Your module deactivated');
}
```

## Code Style

- TypeScript with strict mode enabled
- ESLint with `@typescript-eslint` rules
- Naming conventions:
  - Classes/Interfaces: PascalCase
  - Variables/Functions: camelCase
  - Constants: UPPER_CASE
  - Template variables: PascalCase ({{Author}}, {{Date}}, etc.)
- Semicolons required
- Static service classes (no instantiation)
- Clear separation between models, services, commands, and listeners

## File Type Support

The extension processes these file types:
- **Header files**: `.h` (gets banner + header guard)
- **Implementation files**: `.cc`, `.cpp`, `.mm` (gets banner + auto-include)
- **Mojom files**: `.mojom` (gets banner only)

## Testing Strategy

When developing features:
1. Test with `F5` to launch Extension Development Host
2. Create new files of each supported type to test auto-generation
3. Use keyboard shortcuts (Cmd/Ctrl+Shift+1-9) to test manual template application
4. Verify smart detection prevents duplicate insertions
5. Test edge cases: empty files, files with existing content, invalid configurations

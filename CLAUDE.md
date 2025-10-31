# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chromium Dev Kit is a VSCode extension that provides development toolkit features for Chromium projects, including:
- Automated banner comment generation with customizable templates
- Header guard generation for C++ header files
- Auto-include statements for implementation files
- Support for C++, Objective-C++, and Mojom files

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
- **src/extension.ts**: Extension activation/deactivation. Registers file creation listener and command registry.

### Core Services (MVC Pattern)
- **BannerService** (src/services/bannerService.ts): Processes banner templates by replacing variable placeholders ({{Author}}, {{Mail}}, {{Date}}, {{Year}}, {{Company}}) and inserts banners/includes into documents.
- **HeaderGuardService** (src/services/headerGuardService.ts): Generates header guard macro names from file paths and inserts `#ifndef`/`#define`/`#endif` structures.
- **PathService** (src/services/pathService.ts): Handles path calculations, file type detection, and header guard macro name generation from relative workspace paths.
- **ConfigService** (src/services/configService.ts): Loads and validates extension configuration from VSCode settings.
- **DetectionService** (src/services/detectionService.ts): Smart detection of existing banners and header guards to avoid duplication.

### Command Layer
- **CommandRegistry** (src/commands/commandRegistry.ts): Registers 9 keyboard shortcuts (Cmd/Ctrl+Shift+1-9) for applying banner templates. Template lookup happens at execution time to support dynamic configuration.
- **ApplyBannerCommand** (src/commands/applyBannerCommand.ts): Executes banner application logic for manual command invocation.

### Event Listeners
- **FileCreateListener** (src/listeners/fileCreateListener.ts): Automatically adds banners, header guards, and include statements when new C++/Mojom files are created. Includes smart detection to avoid duplicates.

### Data Models (src/models/)
All models are TypeScript interfaces defining data structures for templates, configuration, file info, header guards, and processed banners.

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
Extension behavior is controlled through VSCode settings (`chromiumDevKit.*`). All configuration is read at execution time, allowing dynamic updates without reloading the extension.

Key settings:
- `templates`: Array of banner templates with id/name/content
- `defaultTemplateId`: Template used for auto-generation on file creation
- `autoAddOnCreate`: Enable/disable automatic banner insertion
- `enableHeaderGuards`: Enable/disable header guard generation for `.h` files
- `enableAutoInclude`: Enable/disable auto `#include` for implementation files
- `headerGuardStyle`: "uppercase" or "lowercase" macro names
- `dateFormat`: Format for `{{Date}}` variable

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

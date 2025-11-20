# Changelog

All notable changes to the "Chromium Dev Kit" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2025-11-19

### Added
- **Smart Chromium Root Detection**: Added capability to detect Chromium root directory when opening subdirectories
  - Automatically identifies Chromium root even when VS Code workspace is a subdirectory (e.g., `src/chrome`)
  - Ensures Header Guards are generated relative to the Chromium root (e.g., `CHROME_BROWSER_...`)
  - Ensures `#include` paths are correctly calculated relative to the Chromium root
  - Uses `.gn`, `.gclient`, and specific directory markers (`chrome`, `content`) for reliable detection
- **Auto-Recovery Control Setting**: New configuration option for user control
  - `chromiumDevKit.windowColor.autoRecover` (default: `true`)
  - Allows users to disable automatic color recovery if desired
  - Provides flexibility for users who want manual control over color configurations
  - Respects user preference while maintaining smart defaults

### Fixed
- **Window Color Configuration Persistence Issue**: Migrated from workspace settings to local storage
  - Resolved intermittent configuration loss issue reported by users
  - Window color settings now stored in VSCode's extension global storage instead of `.vscode/settings.json`
  - Configuration no longer written to project files, avoiding git conflicts and accidental commits
  - Per-repository settings maintained using workspace path as storage key
  - Automatic migration from legacy `.vscode/settings.json` configuration for backward compatibility
  - Configuration persists across VSCode restarts and workspace reloads

- **Auto-Recovery of Color Customizations**: Added smart detection and re-application
  - Automatically detects when `workbench.colorCustomizations` is cleared or deleted
  - Re-applies color customizations from local storage when `settings.json` is removed
  - Added configuration change listener to monitor and restore color settings
  - Ensures colors are always applied even after manual settings.json deletion
  - Workspace folder change detection for proper config switching
  - **User-controllable**: New `chromiumDevKit.windowColor.autoRecover` setting (default: enabled)
  - Users can disable auto-recovery if they prefer manual control

### Changed
- **Storage Architecture**: Window Color module now uses extension storage API
  - `saveConfigToLocalStorage()`: New function to save settings to VSCode's globalState
  - `readConfigFromLocalStorage()`: Reads settings from extension storage
  - `readConfigFromWorkspaceFile()`: Legacy fallback for migrating old configurations
  - `initializeStorage()`: Must be called during activation to initialize storage context
  - Deprecated `saveToWorkspaceConfig()`: No longer writes to workspace settings
  - Module-level state management for `currentWorkspace` and `currentConfig`
  - Added `onDidChangeConfiguration` listener for `workbench.colorCustomizations` monitoring
  - Added `onDidChangeWorkspaceFolders` listener for workspace switching
  - Auto-recovery logic now checks user configuration before applying

### Technical Improvements
- Added extension context management for storage operations
- Implemented automatic configuration migration from workspace files to local storage
- Enhanced error handling and logging for storage operations
- Preserved backward compatibility with existing workspace configurations
- Cleaner separation between visual theme settings (still in workspace) and configuration data (in local storage)
- Smart detection algorithm to check if color customizations are present
- Automatic re-application when customizations are missing

### Benefits
- ✅ Configuration no longer lost when `.vscode/settings.json` is modified or deleted
- ✅ No git conflicts with team members' window color preferences
- ✅ Settings remain local to each developer while still being repository-specific
- ✅ Reduced workspace file clutter
- ✅ Better alignment with VSCode extension best practices
- ✅ **Colors automatically restore even after settings.json deletion** (can be disabled)
- ✅ **Seamless experience when switching between workspaces**
- ✅ **User-controllable auto-recovery** for maximum flexibility

## [0.4.2] - 2025-11-12

### Added
- **Git Configuration Auto-Detection**: Smart default value detection for author and email settings
  - Automatically reads `git config user.name` and `git config user.email` when settings are not modified
  - Falls back to placeholder values (`WaitToModify`, `WaitToModify@alibaba-inc.com`) if git is unavailable
  - Provides seamless experience for users with git configured - no manual setup required
  - Reduces initial configuration friction for new users

### Changed
- **Async Configuration Loading**: ConfigService.loadConfig() is now asynchronous
  - Enables proper async execution of git config commands
  - Updated all service calls to use `await` pattern
  - Improved configuration initialization reliability
- **Enhanced Configuration Descriptions**: Updated package.json settings with detailed explanations
  - `chromiumDevKit.author`: Now includes git auto-detection behavior explanation
  - `chromiumDevKit.email`: Now includes git auto-detection behavior explanation
  - Bilingual documentation (English/Chinese) for better accessibility
- **Template Format Fix**: Removed extra leading `//` from quark-chromium template for cleaner output

### Technical Improvements
- Created `GitUtils` utility class for git configuration operations
  - Cached git config reading for performance optimization
  - Safe error handling for environments without git
  - Reusable across extension modules
- Type safety improvements with proper async/await patterns
- Better separation of concerns with dedicated git utilities

## [0.4.1] - 2025-11-12

### Fixed
- **Configuration Migration Issue**: Fixed activation failure when upgrading from older versions
  - Added configuration registration check before write attempts using `config.inspect()`
  - Made default configuration writing non-blocking to prevent activation failures
  - Implemented graceful degradation with in-memory defaults when configuration writes fail
  - Added informational messages guiding users to manually configure settings if needed
  - Extension now successfully activates even if configuration schema is not fully loaded during upgrades
  - Resolved error: "CodeExpectedError: 没有注册配置 chromiumDevKit.windowColor.mainColor，因此无法写入 工作区设置"

## [0.4.0] - 2025-11-12

### Added
- **Window Color & Name Module**: Integrated window customization capabilities
  - Workspace color customization with status bar, title bar, and activity bar theming
  - Custom window name display in status bar
  - Real-time color preview and adjustment
  - Window title customization
  - Per-workspace color configuration persistence
  - Workspace grouping and management features

### Changed
- **Modular Architecture**: Restructured extension with modular design pattern
  - Created `src/modules/` directory for independent feature modules
  - Chromium DevKit features organized under `modules/chromium-devkit/`
  - Window Color features organized under `modules/window-color/`
  - Shared utilities moved to `src/shared/utils/`
  - Extension activation changed to `*` (activates on VSCode startup) to support window color features
  - Added "Themes" category to extension metadata

- **Configuration Namespace**: All window color settings now under `chromiumDevKit.windowColor.*`
  - `chromiumDevKit.windowColor.name`: Window display name
  - `chromiumDevKit.windowColor.mainColor`: Main theme color (hex format)
  - `chromiumDevKit.windowColor.isActivityBarColored`: Activity bar colorization
  - `chromiumDevKit.windowColor.isTitleBarColored`: Title bar colorization
  - `chromiumDevKit.windowColor.isStatusBarColored`: Status bar colorization
  - `chromiumDevKit.windowColor.isWindowNameColored`: Window name label colorization
  - `chromiumDevKit.windowColor.isActiveItemsColored`: Active UI elements colorization
  - `chromiumDevKit.windowColor.setWindowTitle`: Window title customization
  - `chromiumDevKit.windowColor.workspaces`: Saved workspace configurations
  - `chromiumDevKit.windowColor.groups`: Workspace grouping system

### Commands
- **New Command**: `chromiumDevKit.openWindowColorSettings` - Opens window color & name settings panel
- **Existing Commands**: All template application commands (`chromiumDevKit.applyTemplate1-9`) remain unchanged

### Technical Improvements
- Implemented module activation/deactivation lifecycle management
- Added webview-based settings UI with real-time color preview
- Enhanced configuration management with workspace-specific persistence
- Improved error handling and initialization checks
- Better separation of concerns with independent module architecture

### Documentation
- Updated CLAUDE.md with comprehensive modular architecture documentation
- Added module integration guidelines for future plugin additions
- Enhanced configuration property descriptions with bilingual support (English/Chinese)

## [0.3.2] - 2025-11-01

### Fixed
- no README and CHANGELOG

## [0.3.1]

### Fixed
- no logo


## [0.3.0] - 2025-10-31

### Added
- IDL file type support (`.idl`) with automatic banner generation
- File type detection for `.idl` files alongside existing `.mojom` support
- Smart duplicate detection system to prevent re-insertion of banners
- Detection of existing header guards to avoid conflicts
- Detection of existing copyright comments before auto-insertion
- Safety checks for programmatically created files

### Changed
- Auto-insertion now respects existing file content
- Improved reliability when working with existing codebases
- Updated extension description to highlight IDL file support
- Improved file type matching logic for broader Chromium file support

### Fixed
- Issue where banners would be inserted into files that already had them
- Duplicate header guard generation when opening existing files

## [0.2.0]

### Added
- Configurable date format options: `YYYY/MM/DD`, `YYYY-MM-DD`, `MM/DD/YYYY`
- Header guard style configuration: uppercase or lowercase
- Settings validation for email addresses
- Enhanced configuration documentation with bilingual descriptions (English/Chinese)

### Changed
- Improved settings UI with markdown descriptions
- Better organization of configuration properties
- Enhanced template variable documentation

### Fixed
- Date formatting inconsistencies across different locales
- Header guard macro generation edge cases

## [0.1.0]

### Added
- Automatic banner comment insertion on file creation
- Header guard generation for `.h` files with customizable styles
- Auto-include statement generation for `.cc`, `.cpp`, `.mm` files
- Support for Mojom files (`.mojom`)
- 9 keyboard shortcuts (`Cmd/Ctrl+Shift+1-9`) for template application
- Customizable banner templates with variable substitution
- Template variables: `{{Author}}`, `{{Mail}}`, `{{Company}}`, `{{Date}}`, `{{Year}}`
- Workspace-relative path calculation for header guards and includes
- Configuration options for auto-generation behavior
- File creation event listener for automatic processing
- Command palette integration for manual template application

### Features
- **BannerService**: Template processing and variable replacement
- **HeaderGuardService**: Smart header guard macro generation
- **PathService**: Workspace-relative path calculations
- **ConfigService**: Extension configuration management
- **DetectionService**: Existing content detection
- **CommandRegistry**: Keyboard shortcut management
- **FileCreateListener**: Automatic file processing on creation

## [Unreleased]

### Planned
- No planned now, waiting for some new ideas

---

## Version History Summary

- **0.5.x**: Window Color configuration storage optimization, auto-recovery mechanism
- **0.4.x**: Modular architecture, window color & name customization module integration
- **0.3.x**: Documentation improvements, IDL support, enhanced user experience
- **0.2.x**: Configuration enhancements, date formatting, validation
- **0.1.x**: Initial release with core functionality

## Support

For questions, bug reports, or feature requests:
- **Issues**: [GitHub Issues](https://github.com/scott-leung/ChromiumDevKit-VSCode/issues)
- **Repository**: [ChromiumDevKit-VSCode](https://github.com/scott-leung/ChromiumDevKit-VSCode)

---

**Note**: Dates and version numbers follow the project's development timeline. For the most accurate release information, refer to [GitHub Releases](https://github.com/scott-leung/ChromiumDevKit-VSCode/releases).

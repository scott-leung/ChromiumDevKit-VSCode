# Changelog

All notable changes to the "Chromium Dev Kit" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

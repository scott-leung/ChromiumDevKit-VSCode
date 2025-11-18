# Window Color 配置迁移说明 / Configuration Migration Guide

## 版本 0.5.0 重要改进 / Version 0.5.0 Major Improvement

### 🎯 解决的问题 / Problem Solved

用户反馈 Window Color 配置偶现丢失的问题。原因是配置被保存在项目的 `.vscode/settings.json` 文件中，可能因以下原因丢失：
- 文件被意外修改或删除
- Git 操作导致的冲突或覆盖
- 与团队成员的配置冲突
- 项目清理时被删除

User reported intermittent configuration loss issue. The root cause was that configurations were saved in the project's `.vscode/settings.json` file, which could be lost due to:
- Accidental file modification or deletion
- Git conflicts or overwrites
- Conflicts with team members' configurations
- Deletion during project cleanup

### ✨ 新的解决方案 / New Solution

**从项目文件存储迁移到本地扩展存储 / Migrated from project file storage to local extension storage**

配置现在保存在 VSCode 的扩展全局存储中，使用工作区路径作为 key：
- ✅ **针对仓库**：每个仓库有独立的配置
- ✅ **本地存储**：不会写入项目文件
- ✅ **不会丢失**：不受项目文件变化影响
- ✅ **无 Git 冲突**：个人配置不会提交到版本控制
- ✅ **自动迁移**：首次运行会自动从旧配置迁移
- ✅ **自动恢复**：删除 settings.json 后会自动重新应用颜色

Configurations are now saved in VSCode's extension global storage, using workspace path as the key:
- ✅ **Repository-specific**: Each repository has independent configuration
- ✅ **Local storage**: Not written to project files
- ✅ **Persistent**: Unaffected by project file changes
- ✅ **No Git conflicts**: Personal settings won't be committed to version control
- ✅ **Automatic migration**: Automatically migrates from old configuration on first run
- ✅ **Auto-recovery**: Colors automatically re-apply when settings.json is deleted

### 🔄 自动迁移 / Automatic Migration

**无需手动操作！/ No manual action required!**

升级到 0.5.0 后，扩展会：
1. 首次启动时检测是否存在旧配置（`.vscode/settings.json` 中的 `chromiumDevKit.windowColor.*` 设置）
2. 如果存在旧配置，自动迁移到本地存储
3. 迁移完成后，旧配置仍然保留（不会自动删除）
4. 之后所有配置修改都会保存到本地存储

After upgrading to 0.5.0, the extension will:
1. Check for old configuration on first launch (`.vscode/settings.json` with `chromiumDevKit.windowColor.*` settings)
2. Automatically migrate to local storage if old configuration exists
3. Old configuration remains after migration (not automatically deleted)
4. All subsequent configuration changes are saved to local storage

### 🧹 清理旧配置（可选）/ Cleanup Old Configuration (Optional)

如果你想清理项目中的旧配置，可以手动从 `.vscode/settings.json` 中删除以下设置：

If you want to clean up old configurations from your project, you can manually remove the following settings from `.vscode/settings.json`:

```json
{
  "chromiumDevKit.windowColor.name": "...",
  "chromiumDevKit.windowColor.mainColor": "...",
  "chromiumDevKit.windowColor.isActivityBarColored": ...,
  "chromiumDevKit.windowColor.isTitleBarColored": ...,
  "chromiumDevKit.windowColor.isStatusBarColored": ...,
  "chromiumDevKit.windowColor.isWindowNameColored": ...,
  "chromiumDevKit.windowColor.isActiveItemsColored": ...,
  "chromiumDevKit.windowColor.setWindowTitle": ...
}
```

**注意：** 删除这些设置不会影响扩展功能，因为配置已经迁移到本地存储。

**Note:** Deleting these settings won't affect the extension functionality as the configuration has been migrated to local storage.

### 🔍 技术细节 / Technical Details

#### 存储架构 / Storage Architecture

**两层存储设计 / Two-Layer Storage Design:**

1. **配置数据（本地存储）/ Configuration Data (Local Storage)**
   - 存储位置 / Location: VSCode `globalState`
   - 内容 / Content: 窗口名称、主题色、开关选项等 / Window name, main color, toggle options, etc.
   - Key 格式 / Key format: `windowColor.workspace.{workspace_path}`
   - 特点 / Characteristics: 不会写入项目文件，不会提交到 Git / Not written to project files, not committed to Git

2. **视觉效果（工作区设置）/ Visual Effects (Workspace Settings)**
   - 存储位置 / Location: `.vscode/settings.json`
   - 内容 / Content: `workbench.colorCustomizations`（VSCode 原生配置）
   - 作用 / Purpose: 实际应用颜色到 UI / Actually applies colors to UI
   - 特点 / Characteristics: 
     - 这是 VSCode 的标准机制，必须写入 settings.json
     - 即使被删除，扩展会自动从本地存储重新生成并应用
     - Standard VSCode mechanism, must be written to settings.json
     - Even if deleted, extension will automatically regenerate and re-apply from local storage

#### 自动恢复机制 / Auto-Recovery Mechanism

扩展会监听 `workbench.colorCustomizations` 的变化：
- 当检测到颜色自定义被清空或删除时
- 自动从本地存储读取配置
- 重新生成并应用颜色自定义到 settings.json

The extension monitors `workbench.colorCustomizations` changes:
- When color customizations are detected as cleared or deleted
- Automatically reads configuration from local storage
- Regenerates and re-applies color customizations to settings.json

**这意味着 / This means:**
- ✅ 删除 settings.json 后，颜色会自动恢复 / Colors auto-restore after deleting settings.json
- ✅ 配置数据永远不会丢失（保存在本地存储）/ Configuration data never lost (saved in local storage)
- ✅ 视觉效果可以随时重新应用 / Visual effects can be re-applied anytime

#### 自动恢复控制选项 / Auto-Recovery Control Option

**新增配置项 / New Configuration Option**: `chromiumDevKit.windowColor.autoRecover`

为了给用户更多控制权，新增了自动恢复开关：
- **默认值 / Default**: `true`（启用自动恢复）
- **用途 / Purpose**: 控制是否自动恢复被清空的颜色配置
- **位置 / Location**: VSCode 设置 → Chromium Dev Kit → Window Color → Auto Recover

To give users more control, a new auto-recovery toggle has been added:
- **Default**: `true` (auto-recovery enabled)
- **Purpose**: Controls whether to automatically recover cleared color configurations
- **Location**: VSCode Settings → Chromium Dev Kit → Window Color → Auto Recover

**使用场景 / Use Cases:**

✅ **保持默认（启用）/ Keep Default (Enabled)**
- 适合大多数用户 / Suitable for most users
- 颜色配置会自动恢复，无需手动干预 / Colors auto-restore without manual intervention
- 提供最佳用户体验 / Provides best user experience

⚙️ **禁用自动恢复 / Disable Auto-Recovery**
- 适合需要精细控制的用户 / For users who need fine-grained control
- 可以手动删除 settings.json 中的颜色配置而不会自动恢复 / Can manually remove color configurations without auto-restoration
- 适合临时禁用窗口颜色的场景 / Suitable for temporarily disabling window colors

**如何禁用 / How to Disable:**

```json
{
  "chromiumDevKit.windowColor.autoRecover": false
}
```

#### 存储位置 / Storage Location

配置存储在 VSCode 的 `globalState` 中，key 格式为：
Configuration is stored in VSCode's `globalState` with the key format:

```
windowColor.workspace.{workspace_path}
```

例如 / For example:
```
windowColor.workspace./Users/username/projects/my-chromium-project
```

#### 兼容性 / Compatibility

- ✅ 向后兼容：可以从旧版本无缝升级
- ✅ 跨平台：存储机制在 Windows、macOS、Linux 上一致
- ✅ 多工作区：每个工作区独立配置互不干扰

- ✅ Backward compatible: Seamless upgrade from old versions
- ✅ Cross-platform: Storage mechanism consistent across Windows, macOS, Linux
- ✅ Multi-workspace: Independent configuration for each workspace

### 📝 API 变更 / API Changes

如果你是开发者并使用了此扩展的 API：

If you're a developer using this extension's API:

#### 新增函数 / New Functions

```typescript
// 初始化存储（必须在 activate 中调用）
// Initialize storage (must be called in activate)
initializeStorage(context: vscode.ExtensionContext): void

// 保存配置到本地存储
// Save configuration to local storage
saveConfigToLocalStorage(directory: string, settings: WindowSettings): Promise<void>
```

#### 废弃函数 / Deprecated Functions

```typescript
// 已废弃：不再写入 workspace settings
// Deprecated: No longer writes to workspace settings
saveToWorkspaceConfig(key: string, value: string | boolean): Promise<boolean>
```

### ❓ 常见问题 / FAQ

**Q: 升级后我的配置会丢失吗？**
A: 不会！扩展会自动检测并迁移旧配置。

**Q: Will my configuration be lost after upgrade?**
A: No! The extension will automatically detect and migrate old configurations.

---

**Q: 配置存储在哪里？**
A: 存储在 VSCode 的扩展数据目录中，不在项目文件中。

**Q: Where is the configuration stored?**
A: In VSCode's extension data directory, not in project files.

---

**Q: 我可以在多台电脑上同步配置吗？**
A: 目前配置是本地的。未来可能会考虑添加同步功能。

**Q: Can I sync configurations across multiple computers?**
A: Currently configurations are local. Sync functionality may be considered in the future.

---

**Q: 如何重置配置？**
A: 打开窗口颜色设置面板重新配置即可，新配置会覆盖旧配置。

**Q: How do I reset the configuration?**
A: Open the window color settings panel and reconfigure. New settings will override old ones.

---

**Q: 删除 settings.json 后颜色会自动恢复吗？**
A: 是的！扩展会自动检测到颜色自定义被清空，然后从本地存储读取配置并重新应用。可能需要几秒钟的时间。

**Q: Will colors automatically restore after deleting settings.json?**
A: Yes! The extension will automatically detect that color customizations were cleared, then read configuration from local storage and re-apply. It may take a few seconds.

---

**Q: 为什么还需要写入 settings.json？**
A: `workbench.colorCustomizations` 是 VSCode 的标准配置，必须通过 settings.json 才能生效。但区别是：现在配置数据保存在本地存储，settings.json 只是"渲染层"，即使被删除也会自动重新生成（前提是启用了自动恢复）。

**Q: Why still need to write to settings.json?**
A: `workbench.colorCustomizations` is VSCode's standard configuration and must be in settings.json to take effect. But the difference is: configuration data is now in local storage, settings.json is just the "rendering layer" that will auto-regenerate if deleted (provided auto-recovery is enabled).

---

**Q: 如何禁用自动恢复功能？**
A: 在 VSCode 设置中搜索 "chromiumDevKit.windowColor.autoRecover" 并设置为 `false`。这样删除 settings.json 后颜色配置不会自动恢复。

**Q: How do I disable auto-recovery?**
A: Search for "chromiumDevKit.windowColor.autoRecover" in VSCode settings and set it to `false`. This way, color configurations won't auto-restore after deleting settings.json.

---

**Q: 为什么要提供禁用自动恢复的选项？**
A: 有些用户可能想要临时禁用窗口颜色，或者更喜欢手动控制配置。虽然自动恢复对大多数用户很有用，但我们希望给用户完全的控制权。

**Q: Why provide an option to disable auto-recovery?**
A: Some users may want to temporarily disable window colors or prefer manual control over configurations. While auto-recovery is useful for most users, we want to give users complete control.

### 📞 反馈 / Feedback

如有问题或建议，请：
- 提交 Issue：https://github.com/scott-leung/ChromiumDevKit-VSCode/issues
- 查看完整更新日志：[CHANGELOG.md](./CHANGELOG.md)

For questions or suggestions:
- Submit an Issue: https://github.com/scott-leung/ChromiumDevKit-VSCode/issues
- View complete changelog: [CHANGELOG.md](./CHANGELOG.md)

---

**Chromium Dev Kit v0.5.0** - 更稳定、更可靠的 Window Color 体验！
**Chromium Dev Kit v0.5.0** - More stable and reliable Window Color experience!


import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ParserService } from '../services/parserService';
import { QueryService } from '../services/queryService';
import { escapeXml } from '../utils/xmlUtils';
import { GritServiceV2 } from '../services/gritServiceV2';
import { indexService } from '../services/indexService';
import { IMessage } from '../models';
import { AIClient, ChatMessage } from '../../ai/aiClient';
import { configService } from '../services/configService';
import { getLanguageDisplayName } from '../utils/languageUtils';

/**
 * AI Translate Command
 * Translate a selected <message> node to the chosen language and update the XTB file.
 */
export async function aiTranslateCommand(
  args?: { lang?: string | string[]; idsName?: string } | string
): Promise<void> {
  const argObject = typeof args === 'object' && args !== null ? args : undefined;
  const requestedIdsName = (argObject as any)?.idsName as string | undefined;

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a GRD/GRDP file and select a <message> node to translate.');
    return;
  }

  const document = editor.document;
  const filePath = document.uri.fsPath;
  const isGrd = filePath.endsWith('.grd');
  const isGrdp = filePath.endsWith('.grdp');

  if (!isGrd && !isGrdp) {
    vscode.window.showWarningMessage('AI translation is only supported in GRD or GRDP files.');
    return;
  }

  const selectionLine = editor.selection.active.line + 1;
  const messageName = requestedIdsName || extractMessageName(document, editor.selection);
  if (!messageName) {
    vscode.window.showWarningMessage('Could not identify the selected <message> node. Place the cursor inside the <message>.');
    return;
  }

  const parser = new ParserService();
  const queryService = QueryService.getInstance();

  try {
    const fileContent = document.getText();

    let parsedMessages: IMessage[] = [];
    let xtbPatterns: Array<{ lang: string; path: string }> = [];
    let parentGrdPath = filePath;

    if (isGrd) {
      const parseResult = parser.parseGRD(fileContent, filePath);
      parsedMessages = parseResult.messages;
      xtbPatterns = parseResult.xtbPatterns;
    } else {
      // Resolve parent GRD via database to ensure correct XTB mapping
      const dbMessages = await queryService.getMessagesByName(messageName);
      if (dbMessages.length === 0) {
        vscode.window.showErrorMessage('No messages for this GRDP were found in the index. Rebuild the index and try again.');
        return;
      }
      const match = dbMessages.find((m) => m.grdp_path === filePath) ?? dbMessages[0];
      parentGrdPath = match?.grd_path || parentGrdPath;

      if (!parentGrdPath) {
        vscode.window.showErrorMessage('Unable to determine the parent GRD file. Build the index and try again.');
        return;
      }

      const parseResult = parser.parseGRDP(fileContent, filePath, parentGrdPath);
      parsedMessages = parseResult.messages;

      // Parse parent GRD to locate XTB patterns for this GRDP
      const parentContent = fs.readFileSync(parentGrdPath, 'utf-8');
      xtbPatterns = parser.parseGRD(parentContent, parentGrdPath).xtbPatterns;
    }

    const message = pickMessage(parsedMessages, messageName, selectionLine);
    if (!message) {
      vscode.window.showErrorMessage('Could not parse the selected <message> content from the file.');
      return;
    }

    const languageOptions = buildLanguageOptions(xtbPatterns, parentGrdPath);
    if (languageOptions.length === 0) {
      vscode.window.showErrorMessage('No available languages found in the GRD/GRDP XTB configuration. Check the <output> configuration.');
      return;
    }

    const requestedLangInput = typeof args === 'string' ? args : argObject?.lang;
    const requestedLangs = Array.isArray(requestedLangInput)
      ? requestedLangInput
      : requestedLangInput
        ? [requestedLangInput]
        : [];
    const overlayLang = configService.getOverlayConfig().locale;
    const preferredLangs = [
      ...(overlayLang ? [{ lang: overlayLang, sourceTag: 'Default Locale' }] : []),
      ...requestedLangs.map((lang) => ({ lang, sourceTag: 'Command Arg' })),
    ];

    const targetLangs = await pickTargetLanguages(languageOptions, preferredLangs);

    if (!targetLangs || targetLangs.length === 0) {
      return;
    }

    const idHash =
      message.id_hash ||
      GritServiceV2.calculateHashId(message.presentable_text || message.english, message.meaning);

    const aiConfig = configService.getAIConfig();
    const apiKey = await ensureApiKey();
    const aiClient = new AIClient({
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      apiKey,
      timeoutMs: aiConfig.timeout,
    });

    const drafts: TranslationDraft[] = await Promise.all(
      targetLangs.map(async (targetLang) => {
        const existing = await queryService.getTranslation(idHash, targetLang.value);
        return {
          ...targetLang,
          translation: existing?.text ?? '',
          status: 'pending',
          existing: existing?.text,
          defaultSelected: !!preferredLangs.find((p) => p.lang === targetLang.value),
        };
      })
    );

    const originalText = message.source_text || message.presentable_text || message.english || '';
    const placeholderProfile = buildPlaceholderProfile(originalText);
    const reviewSession = showTranslationReviewPanel(message.name, originalText, drafts);
    const abortController = new AbortController();
    const limiter = createQpsLimiter(aiConfig.qpsLimit);

    const shouldAutoCheck = (draft: TranslationDraft, translation: string) =>
      draft.defaultSelected || translation.trim() !== (draft.existing ?? '').trim();

    const translateDraft = async (draft: TranslationDraft) => {
      const chatMessages: ChatMessage[] = buildChatMessages(
        draft.value,
        message,
        placeholderProfile
      );

      try {
        draft.status = 'pending';
        draft.error = undefined;
        reviewSession.updateDrafts([
          { value: draft.value, status: 'pending', error: undefined, resetUserEdited: false },
        ]);

        await limiter();
        const aiResult = await aiClient.chat(chatMessages, { signal: abortController.signal });
        const validation = validateTranslationPlaceholders(placeholderProfile, aiResult);

        draft.translation = aiResult;
        draft.status = validation.ok ? 'success' : 'failed';
        draft.error = validation.ok ? undefined : `Placeholder validation failed: ${validation.errors.join('; ')}`;

        reviewSession.updateDrafts([
          {
            value: draft.value,
            translation: aiResult,
            status: draft.status,
            error: draft.error,
            shouldAutoCheck: validation.ok && shouldAutoCheck(draft, aiResult),
            forceUpdate: true,
            resetUserEdited: true,
          },
        ]);
      } catch (error) {
        const reason =
          abortController.signal.aborted && (error as any)?.name === 'AbortError'
            ? 'Cancelled'
            : error instanceof Error
              ? error.message
              : String(error);

        draft.status = 'failed';
        draft.error = reason;

        reviewSession.updateDrafts([
          {
            value: draft.value,
            status: 'failed',
            error: reason,
          },
        ]);

        if (!abortController.signal.aborted) {
          console.error('[aiTranslate] Error for', draft.value, ':', error);
        }
      }
    };

    const translationTasks = drafts.map(async (draft) => translateDraft(draft));

    reviewSession.waitForSelection.finally(() => abortController.abort());
    void Promise.allSettled(translationTasks);

    reviewSession.onRetry((lang) => {
      const draft = drafts.find((item) => item.value === lang);
      if (!draft || draft.status === 'pending') {
        return;
      }
      void translateDraft(draft);
    });

    const reviewSelections = await reviewSession.waitForSelection;
    if (!reviewSelections || reviewSelections.length === 0) {
      vscode.window.showInformationMessage(`AI translation cancelled: ${message.name}`);
      return;
    }

    const successes: string[] = [];
    const failures: Array<{ lang: string; label: string; reason: string }> = [];

    for (const selection of reviewSelections) {
      const trimmed = selection.translation.trim();
      if (trimmed.length === 0) {
        failures.push({ lang: selection.lang, label: selection.label, reason: 'Translation is empty' });
        continue;
      }

      const validation = validateTranslationPlaceholders(placeholderProfile, trimmed);
      if (!validation.ok) {
        failures.push({
          lang: selection.lang,
          label: selection.label,
          reason: `Placeholder validation failed: ${validation.errors.join('; ')}`,
        });
        continue;
      }

      try {
        const xtbContent = fs.readFileSync(selection.xtbPath, 'utf-8');
        const { updated, action } = upsertTranslation(xtbContent, idHash, trimmed);

        fs.writeFileSync(selection.xtbPath, updated, 'utf-8');

        // Refresh index immediately (file watcher will also pick this up)
        try {
          await indexService.updateXTB(selection.xtbPath, selection.lang);
        } catch (error) {
          console.warn('[aiTranslate] Failed to refresh index after writing XTB:', error);
        }

        successes.push(`${selection.lang}(${action === 'updated' ? 'updated' : 'added'})`);
      } catch (error) {
        console.error('[aiTranslate] Write error for', selection.lang, ':', error);
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ lang: selection.lang, label: selection.label, reason });
      }
    }

    const parts: string[] = [];
    if (successes.length > 0) {
      parts.push(`Completed: ${successes.join(', ')}`);
    }
    if (failures.length > 0) {
      parts.push(
        `Failed: ${failures.map((f) => `${f.lang}(${f.reason})`).join(', ')}`
      );
    }

    if (parts.length > 0) {
      vscode.window.showInformationMessage(`AI translation results - ${message.name}: ${parts.join(' | ')}`);
    } else {
      vscode.window.showInformationMessage(`AI translation applied no languages: ${message.name}`);
    }
  } catch (error) {
    console.error('[aiTranslate] Error:', error);
    vscode.window.showErrorMessage(`AI translation failed: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Pick the target language through quick pick
 */
export type LanguageOption = {
  label: string;
  value: string;
  xtbPath: string;
  description?: string;
  sourceTag?: string;
  defaultSelected?: boolean;
};
type LanguageQuickPickItem = vscode.QuickPickItem & {
  type: 'lang' | 'action';
  actionType?: 'selectAll' | 'invert' | 'clear';
  value?: string;
  xtbPath?: string;
  sourceTag?: string;
};

export type TranslationStatus = 'pending' | 'success' | 'failed';

export type TranslationDraft = LanguageOption & {
  translation: string;
  status: TranslationStatus;
  error?: string;
  existing?: string;
  sourceTag?: string;
  defaultSelected?: boolean;
};

export type TranslationSelection = {
  lang: string;
  label: string;
  xtbPath: string;
  translation: string;
  sourceTag?: string;
};

export type TranslationDraftUpdate = {
  value: string;
  translation?: string;
  status?: TranslationStatus;
  error?: string;
  shouldAutoCheck?: boolean;
  forceUpdate?: boolean;
  resetUserEdited?: boolean;
};

export type TranslationReviewSession = {
  waitForSelection: Promise<TranslationSelection[] | undefined>;
  updateDrafts: (updates: TranslationDraftUpdate[]) => void;
  onRetry: (handler: (lang: string) => void) => vscode.Disposable;
};

export type PlaceholderProfile = {
  icuVars: Set<string>;
  numericVars: Set<string>;
  phNames: Set<string>;
  hasPlural: boolean;
  pluralKeys: Set<string>;
};

/**
 * Pick one or more target languages through quick pick with select-all and invert helpers
 */
async function pickTargetLanguages(
  options: LanguageOption[],
  preferredLangs: Array<{ lang: string; sourceTag?: string }> = []
): Promise<LanguageOption[] | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<LanguageQuickPickItem>();
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.title = 'Choose languages to generate translations (from GRD/GRDP XTB configuration)';
    quickPick.placeholder = 'Multi-select supported: select all / invert / clear';

    const preferredOrder = new Map<string, number>();
    preferredLangs.forEach((item, index) => {
      if (!preferredOrder.has(item.lang)) {
        preferredOrder.set(item.lang, index);
      }
    });

    const sortedOptions = [...options].sort((a, b) => {
      const aPref = preferredOrder.has(a.value);
      const bPref = preferredOrder.has(b.value);
      if (aPref && bPref) {
        return (preferredOrder.get(a.value) ?? 0) - (preferredOrder.get(b.value) ?? 0);
      }
      if (aPref) return -1;
      if (bPref) return 1;
      return a.label.localeCompare(b.label);
    });

    const langItems: LanguageQuickPickItem[] = sortedOptions.map((opt) => {
      const preferred = preferredLangs.find((p) => p.lang === opt.value);
      const tag = preferred?.sourceTag;
      return {
        label: opt.label,
        description: tag ? `${tag}${opt.description ? ` · ${opt.description}` : ''}` : opt.description,
        value: opt.value,
        xtbPath: opt.xtbPath,
        type: 'lang',
        sourceTag: tag,
      };
    });

    const actionItems: LanguageQuickPickItem[] = [
      { label: '$(check-all) Select all', alwaysShow: true, type: 'action', actionType: 'selectAll' },
      { label: '$(debug-restart) Invert selection', alwaysShow: true, type: 'action', actionType: 'invert' },
      { label: '$(trash) Clear selection', alwaysShow: true, type: 'action', actionType: 'clear' },
    ];

    quickPick.items = [...actionItems, ...langItems];

    const preferredSet = new Set(preferredLangs.map((p) => p.lang));
    const defaultSelected = langItems.filter((item) => item.value && preferredSet.has(item.value));
    if (defaultSelected.length > 0) {
      quickPick.selectedItems = defaultSelected;
      quickPick.placeholder = `Preselected: ${defaultSelected.map((i) => i.label).join(', ')}`;
    }

    let updating = false;
    let resolved = false;

    const setSelection = (items: LanguageQuickPickItem[]) => {
      updating = true;
      quickPick.selectedItems = items.filter((item) => item.type === 'lang');
      updating = false;
    };

    quickPick.onDidChangeSelection((selected) => {
      if (updating) {
        return;
      }

      const actionItem = selected.find((item) => item.type === 'action');
      if (!actionItem) {
        return;
      }

      const selectedLangs = new Set(
        quickPick.selectedItems
          .filter((item) => item.type === 'lang' && item.value)
          .map((item) => item.value as string)
      );

      switch (actionItem.actionType) {
        case 'selectAll':
          setSelection(langItems);
          break;
        case 'invert': {
          const inverted = langItems.filter((item) => item.value && !selectedLangs.has(item.value));
          setSelection(inverted);
          break;
        }
        case 'clear':
          setSelection([]);
          break;
        default:
          break;
      }
    });

    quickPick.onDidAccept(() => {
      resolved = true;
      const picked = quickPick.selectedItems.filter(
        (item): item is LanguageQuickPickItem & { value: string; xtbPath: string } =>
          item.type === 'lang' && !!item.value && !!item.xtbPath
      );

      resolve(
        picked.map((item) => ({
          label: item.label,
          value: item.value,
          xtbPath: item.xtbPath,
          description: item.description,
          sourceTag: item.sourceTag,
          defaultSelected: preferredSet.has(item.value),
        }))
      );
      quickPick.hide();
    });

    quickPick.onDidHide(() => {
      if (!resolved) {
        resolve(undefined);
      }
      quickPick.dispose();
    });

    quickPick.show();
  });
}

/**
 * Show translation review panel for batch editing/applying translations
 */
export function showTranslationReviewPanel(
  messageName: string,
  originalText: string,
  drafts: TranslationDraft[]
): TranslationReviewSession {
  const panel = vscode.window.createWebviewPanel(
    'chromiumI18n.aiTranslateReview',
    `AI Translation Preview - ${messageName}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = buildTranslationReviewHtml(panel.webview, messageName, originalText, drafts);

  let resolved = false;
  let disposed = false;
  const retryEmitter = new vscode.EventEmitter<string>();

  const waitForSelection = new Promise<TranslationSelection[] | undefined>((resolve) => {
    const disposeAndResolve = (value: TranslationSelection[] | undefined) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
      if (!disposed) {
        disposed = true;
        panel.dispose();
      }
    };

    const subscription = panel.webview.onDidReceiveMessage((message: any) => {
      if (message?.type === 'apply') {
        const items = Array.isArray(message.items) ? message.items : [];
        disposeAndResolve(
          items.map((item: any) => ({
            lang: String(item.lang),
            label: String(item.label),
            xtbPath: String(item.xtbPath),
            translation: String(item.translation ?? ''),
          }))
        );
      } else if (message?.type === 'cancel') {
        disposeAndResolve(undefined);
      } else if (message?.type === 'retry' && typeof message.lang === 'string') {
        retryEmitter.fire(String(message.lang));
      }
    });

    panel.onDidDispose(() => {
      disposed = true;
      subscription.dispose();
      retryEmitter.dispose();
      if (!resolved) {
        resolve(undefined);
      }
    });
  });

  const updateDrafts = (updates: TranslationDraftUpdate[]) => {
    if (disposed) {
      return;
    }
    panel.webview.postMessage({ type: 'update', updates });
  };

  return {
    waitForSelection,
    updateDrafts,
    onRetry: (handler: (lang: string) => void) => retryEmitter.event(handler),
  };
}

/**
 * Build webview HTML content for translation review
 */
export function buildTranslationReviewHtml(
  webview: vscode.Webview,
  messageName: string,
  originalText: string,
  drafts: TranslationDraft[]
): string {
  const nonce = getNonce();
  const initialData = drafts.map((draft) => ({
    label: draft.label,
    value: draft.value,
    xtbPath: draft.xtbPath,
    description: draft.description,
    translation: draft.translation,
    existing: draft.existing,
    status: draft.status,
    error: draft.error,
    defaultSelected: !!draft.defaultSelected,
    checked:
      draft.defaultSelected ||
      (draft.translation ?? '').trim() !== (draft.existing ?? '').trim(),
    sourceTag: draft.sourceTag,
  }));

  const csp = webview.cspSource;

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Translation Preview - ${escapeHtml(messageName)}</title>
  <style>
    :root {
      --bg: #0f1116;
      --panel: #151922;
      --text: #d7dde8;
      --muted: #8b93a7;
      --border: #262b36;
      --accent: #4da3ff;
      --danger: #ff6b6b;
      --success: #48c78e;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    button {
      border: 1px solid var(--border);
      background: #1c2230;
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    button.primary {
      border-color: var(--accent);
      background: linear-gradient(90deg, #3c8bff, #4da3ff);
      color: #fff;
      font-weight: 600;
    }
    button.danger {
      border-color: var(--danger);
      color: #fff;
      background: linear-gradient(90deg, #ff5f6d, #ffc371);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .badge {
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 10px;
      background: #1f2633;
      border: 1px solid var(--border);
      color: var(--muted);
      margin-left: 6px;
    }
    .badge.primary { color: var(--accent); border-color: rgba(77,163,255,0.5); }
    main {
      padding: 12px 16px 16px;
      display: grid;
      gap: 12px;
      flex: 1;
      overflow: auto;
    }
    .card {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 10px;
      padding: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.22);
    }
    .card header {
      border: none;
      padding: 0 0 10px 0;
      background: transparent;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .row-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .status {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;
      background: #1f2633;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .status.pending { color: var(--muted); border-color: rgba(139,147,167,0.4); }
    .status.success { color: var(--success); border-color: rgba(72,199,142,0.4); }
    .status.failed { color: var(--danger); border-color: rgba(255,107,107,0.4); }
    textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #111722;
      color: var(--text);
      padding: 10px;
      font-size: 13px;
      font-family: 'SFMono-Regular', Consolas, 'Courier New', monospace;
      box-sizing: border-box;
    }
    .path {
      font-size: 12px;
      color: var(--muted);
    }
    .row-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .compare {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      font-size: 12px;
      color: var(--muted);
    }
    .compare .new.diff {
      color: var(--danger);
      font-weight: 600;
    }
    .placeholder {
      text-align: center;
      color: var(--muted);
      padding: 24px 12px;
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
    .origin {
      border: 1px solid var(--border);
      background: #111722;
      padding: 10px 12px;
      border-radius: 8px;
      color: var(--text);
      font-size: 13px;
      max-height: 120px;
      overflow: auto;
      white-space: pre-wrap;
    }
    .origin-label {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>AI Translation Preview - ${escapeHtml(messageName)}</h1>
      <div style="color: var(--muted); font-size: 12px;">Batch edit / delete / cancel before applying</div>
      <div class="origin-label">Source text</div>
      <div class="origin">${escapeHtml(originalText || '(no source text)')}</div>
    </div>
    <div class="actions">
      <button id="selectAll">Select all</button>
      <button id="invert">Invert selection</button>
      <button id="clear">Clear selection</button>
      <button id="apply" class="primary">Apply selected</button>
      <button id="cancel" class="danger">Close</button>
    </div>
  </header>
  <main>
    <div id="list" class="card"></div>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      items: ${JSON.stringify(initialData)}.map((item) => ({
        ...item,
        status: item.status || 'pending',
        checked: !!item.checked,
        userEdited: false,
        userToggled: false,
        defaultSelected: !!item.defaultSelected,
      })),
    };

    const listEl = document.getElementById('list');
    const applyBtn = document.getElementById('apply');
    const selectAllBtn = document.getElementById('selectAll');
    const invertBtn = document.getElementById('invert');
    const clearBtn = document.getElementById('clear');
    const cancelBtn = document.getElementById('cancel');

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) {
        return;
      }

      if (message.type === 'update' && Array.isArray(message.updates)) {
        applyUpdates(message.updates);
      }
    });

    function applyUpdates(updates) {
      let changed = false;

      updates.forEach((update) => {
        const index = state.items.findIndex((item) => item.value === update.value);
        if (index === -1) {
          return;
        }

        const item = state.items[index];

        if (typeof update.status === 'string' && item.status !== update.status) {
          item.status = update.status;
          changed = true;
        }

        if (typeof update.error !== 'undefined') {
          item.error = update.error || '';
          changed = true;
        }

        const allowUpdate = update.forceUpdate || !item.userEdited;
        if (typeof update.translation !== 'undefined' && allowUpdate) {
          item.translation = update.translation;
          if (update.resetUserEdited) {
            item.userEdited = false;
          }
          changed = true;
        } else if (update.resetUserEdited) {
          item.userEdited = false;
        }

        if (update.shouldAutoCheck && !item.userToggled && !item.checked) {
          item.checked = true;
          changed = true;
        }
      });

      if (changed) {
        render();
      }
    }

    function render() {
      const focusState = captureFocus();

      if (!state.items.length) {
        listEl.innerHTML = '<div class="placeholder">No translations to apply. Close the window and try again.</div>';
        applyBtn.disabled = true;
        selectAllBtn.disabled = true;
        invertBtn.disabled = true;
        clearBtn.disabled = true;
        restoreFocus(focusState);
        return;
      }

      applyBtn.disabled = false;
      selectAllBtn.disabled = false;
      invertBtn.disabled = false;
      clearBtn.disabled = false;

      listEl.innerHTML = state.items.map((item, index) => {
        const statusText = getStatusText(item);
        const checkedAttr = item.checked ? 'checked' : '';
        const escapedTranslation = escapeHtml(item.translation || '');
        const tagBadge = item.sourceTag ? \`<span class="status">\${escapeHtml(item.sourceTag)}</span>\` : '';
        const isDiff = (item.translation || '').trim() !== (item.existing || '').trim();
        const diffBadge = isDiff ? '<span class="badge primary">Changed</span>' : '';
        const retryDisabled = item.status === 'pending' ? 'disabled' : '';
        return \`
          <div class="row" data-index="\${index}" data-lang="\${item.value}" data-xtb="\${escapeHtml(item.xtbPath)}">
            <div class="row-top">
              <div class="row-meta">
                <label>
                  <input type="checkbox" class="row-check" \${checkedAttr} />
                  <strong>\${escapeHtml(item.label)}</strong> \${tagBadge} \${diffBadge}
                </label>
                <span class="status \${item.status}">\${statusText}</span>
              </div>
              <div class="row-actions">
                <button class="retry-btn" \${retryDisabled}>Retry</button>
                <button class="delete-btn">Delete</button>
              </div>
            </div>
            <div class="compare">
              \${item.existing ? '<div class="old">Old: ' + escapeHtml(item.existing) + '</div>' : ''}
              <div class="new \${isDiff ? 'diff' : ''}">New: \${escapedTranslation}</div>
            </div>
            <textarea class="translation-input" placeholder="Translation (editable; blank will not be applied)">\${escapedTranslation}</textarea>
            <div class="path">\${escapeHtml(item.description || item.xtbPath)}</div>
          </div>
        \`;
      }).join('');

      wireEvents();
      restoreFocus(focusState);
    }

    function getStatusText(item) {
      if (item.status === 'pending') {
        return 'AI generating...';
      }
      if (item.status === 'failed') {
        return item.error ? 'AI failed: ' + escapeHtml(item.error) : 'AI failed';
      }
      return 'AI generated successfully';
    }

    function wireEvents() {
      listEl.querySelectorAll('.row-check').forEach((el) => {
        el.addEventListener('change', (event) => {
          const checkbox = event.currentTarget;
          const row = checkbox.closest('.row');
          const index = Number(row.dataset.index);
          state.items[index].checked = checkbox.checked;
          state.items[index].userToggled = true;
        });
      });

      listEl.querySelectorAll('.translation-input').forEach((el) => {
        el.addEventListener('input', (event) => {
          const textarea = event.currentTarget;
          const row = textarea.closest('.row');
          const index = Number(row.dataset.index);
          state.items[index].translation = textarea.value;
          state.items[index].userEdited = true;
        });
      });

      listEl.querySelectorAll('.retry-btn').forEach((el) => {
        el.addEventListener('click', (event) => {
          const row = (event.currentTarget).closest('.row');
          if (!row) {
            return;
          }
          const index = Number(row.dataset.index);
          if (state.items[index].status === 'pending') {
            return;
          }
          state.items[index].status = 'pending';
          state.items[index].error = '';
          render();
          vscode.postMessage({ type: 'retry', lang: row.dataset.lang });
        });
      });

      listEl.querySelectorAll('.delete-btn').forEach((el) => {
        el.addEventListener('click', (event) => {
          const row = (event.currentTarget).closest('.row');
          const index = Number(row.dataset.index);
          state.items.splice(index, 1);
          render();
        });
      });
    }

    applyBtn.addEventListener('click', () => {
      const payload = state.items
        .filter((item) => item.checked)
        .map((item) => ({
          lang: item.value,
          label: item.label,
          xtbPath: item.xtbPath,
          translation: item.translation || '',
        }));

      vscode.postMessage({ type: 'apply', items: payload });
    });

    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    selectAllBtn.addEventListener('click', () => {
      state.items.forEach((item) => { item.checked = true; item.userToggled = true; });
      render();
    });

    invertBtn.addEventListener('click', () => {
      state.items.forEach((item) => { item.checked = !item.checked; item.userToggled = true; });
      render();
    });

    clearBtn.addEventListener('click', () => {
      state.items.forEach((item) => { item.checked = false; item.userToggled = true; });
      render();
    });

    function captureFocus() {
      const active = document.activeElement;
      if (active && active.classList.contains('translation-input')) {
        const row = active.closest('.row');
        if (row) {
          return {
            lang: row.dataset.lang,
            selectionStart: active.selectionStart,
            selectionEnd: active.selectionEnd,
            scrollTop: active.scrollTop,
          };
        }
      }
      return null;
    }

    function restoreFocus(focusState) {
      if (!focusState) {
        return;
      }
      const target = document.querySelector(\`.row[data-lang="\${focusState.lang}"] .translation-input\`);
      if (target) {
        target.focus();
        target.selectionStart = focusState.selectionStart;
        target.selectionEnd = focusState.selectionEnd;
        target.scrollTop = focusState.scrollTop;
      }
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    render();
  </script>
</body>
</html>
`;
}

export function getNonce() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build language options from XTB patterns in GRD/GRDP
 */
function buildLanguageOptions(
  xtbPatterns: Array<{ lang: string; path: string }>,
  parentGrdPath: string
): Array<{ label: string; value: string; xtbPath: string; description?: string }> {
  const options: Array<{ label: string; value: string; xtbPath: string; description?: string }> = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const pattern of xtbPatterns) {
    const lang = pattern.lang?.trim();
    if (!lang || seen.has(lang)) {
      continue;
    }

    const resolvedPath = path.isAbsolute(pattern.path)
      ? pattern.path
      : path.resolve(path.dirname(parentGrdPath), pattern.path);

    if (!fs.existsSync(resolvedPath)) {
      missing.push(`${lang}: ${resolvedPath}`);
      continue;
    }

    const langName = getLanguageDisplayName(lang);
    options.push({
      label: `${langName} (${lang})`,
      value: lang,
      xtbPath: resolvedPath,
      description: path.relative(path.dirname(parentGrdPath), resolvedPath),
    });
    seen.add(lang);
  }

  if (missing.length > 0) {
    console.warn('[aiTranslate] Missing XTB files for languages:', missing);
  }

  return options;
}

/**
 * Ensure API key exists in Secret Storage, prompting the user if missing
 */
async function ensureApiKey(): Promise<string> {
  let apiKey = await configService.getAIApiKey();
  if (apiKey) {
    return apiKey;
  }

  const input = await vscode.window.showInputBox({
    title: 'Chromium I18n: Enter AI API Key',
    prompt: 'Enter the AI service API key to call the translation endpoint. This key will be stored securely in VS Code Secret Storage.',
    ignoreFocusOut: true,
    password: true,
    validateInput: (value) => (value.trim().length === 0 ? 'API key cannot be empty' : undefined),
  });

  if (!input) {
    throw new Error('AI API key was not provided; cannot call translation service');
  }

  apiKey = input.trim();
  await configService.setAIApiKey(apiKey);
  return apiKey;
}

/**
 * Extract message name from current document and cursor position
 */
function extractMessageName(document: vscode.TextDocument, selection: vscode.Selection): string | null {
  const text = document.getText();
  const offset = document.offsetAt(selection.active);

  const start = text.lastIndexOf('<message', offset);
  if (start === -1) {
    return null;
  }

  const snippet = text.slice(start, start + 500); // attribute section should be within this range
  const match = snippet.match(/<message[^>]*\bname=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Choose the right message based on selection line and name
 */
function pickMessage(messages: IMessage[], name: string, selectionLine: number): IMessage | undefined {
  if (!messages || messages.length === 0) {
    return undefined;
  }

  // Prioritize name match (e.g. from hover or specific command arg)
  if (name) {
    const byName = messages.find((m) => m.name === name);
    if (byName) {
      return byName;
    }
  }

  // Fallback to cursor line
  const byLine = messages.find(
    (m) =>
      typeof m.start_line === 'number' &&
      typeof m.end_line === 'number' &&
      selectionLine >= (m.start_line || 0) &&
      selectionLine <= (m.end_line || 0)
  );

  if (byLine) {
    return byLine;
  }

  return messages[0];
}

/**
 * Build AI user content with optional context/meaning
 */
function buildChatMessages(
  targetLang: string,
  message: IMessage,
  placeholderProfile: PlaceholderProfile
): ChatMessage[] {
  return [
    { role: 'system', content: configService.getPromptForLanguage(targetLang) },
    { role: 'user', content: buildAIUserContent(message, placeholderProfile, targetLang) },
  ];
}

function buildAIUserContent(
  message: IMessage,
  placeholderProfile: PlaceholderProfile,
  targetLang: string
): string {
  const english = message.source_text || message.presentable_text || message.english || '';
  const placeholderGuidance = formatPlaceholderGuidance(placeholderProfile);

  const parts = [
    `Translate the Chromium GRIT ICU string below to ${targetLang}.`,
    `Source:\n${english}`,
  ];

  if (message.meaning) {
    parts.push(`Context/meaning: ${message.meaning}`);
  }

  if (placeholderGuidance) {
    parts.push(
      `Placeholders (keep exact, do not translate or reorder): ${placeholderGuidance}`
    );
  }

  parts.push(
    'Rules: preserve ICU/plural syntax and branch keys, keep all placeholders (e.g., {VAR}, {0}, <ph .../>) unchanged, translate only user-facing text, and return exactly the translated text (no extra wording; preserve any source newlines).'
  );

  return parts.filter(Boolean).join('\n');
}

function formatPlaceholderGuidance(profile: PlaceholderProfile): string {
  const parts: string[] = [];

  if (profile.icuVars.size > 0) {
    parts.push(`ICU variables ${Array.from(profile.icuVars).map((v) => `{${v}}`).join(', ')}`);
  }

  if (profile.numericVars.size > 0) {
    parts.push(`numeric placeholders ${Array.from(profile.numericVars).map((v) => `{${v}}`).join(', ')}`);
  }

  if (profile.phNames.size > 0) {
    parts.push(`<ph> tags ${Array.from(profile.phNames)
      .map((name) => `<ph name="${name}" />`)
      .join(', ')}`);
  }

  if (profile.hasPlural) {
    const branches =
      profile.pluralKeys.size > 0 ? Array.from(profile.pluralKeys).join(', ') : 'all plural branches';
    parts.push(`plural structure (${branches})`);
  }

  return parts.join(' | ');
}

export function buildPlaceholderProfile(text: string): PlaceholderProfile {
  const profile: PlaceholderProfile = {
    icuVars: new Set(),
    numericVars: new Set(),
    phNames: new Set(),
    hasPlural: false,
    pluralKeys: new Set(),
  };

  if (!text) {
    return profile;
  }

  const phRegex = /<ph\b[^>]*name=["']?([A-Za-z0-9_:-]+)["']?[^>]*\/?>/gi;
  let phMatch: RegExpExecArray | null;
  while ((phMatch = phRegex.exec(text)) !== null) {
    profile.phNames.add(phMatch[1]);
  }

  const placeholderRegex = /\{([A-Za-z0-9_]+)\s*(?:,|\})/g;
  let placeholderMatch: RegExpExecArray | null;
  while ((placeholderMatch = placeholderRegex.exec(text)) !== null) {
    const name = placeholderMatch[1];
    if (/^\d+$/.test(name)) {
      profile.numericVars.add(name);
    } else {
      profile.icuVars.add(name);
    }
  }

  if (/,?\s*plural\b/i.test(text)) {
    profile.hasPlural = true;
    const branchRegex = /(=[^\s{]+|zero|one|two|few|many|other)\s*\{/gi;
    let branchMatch: RegExpExecArray | null;
    while ((branchMatch = branchRegex.exec(text)) !== null) {
      const key = branchMatch[1];
      if (key) {
        profile.pluralKeys.add(key);
      }
    }
  }

  return profile;
}

export function validateTranslationPlaceholders(
  sourceProfile: PlaceholderProfile,
  translated: string
): { ok: boolean; errors: string[] } {
  const translatedProfile = buildPlaceholderProfile(translated);
  const errors: string[] = [];

  for (const name of sourceProfile.phNames) {
    if (!translatedProfile.phNames.has(name)) {
      errors.push(`<ph name="${name}"> is missing or was changed`);
    }
  }

  for (const name of sourceProfile.icuVars) {
    if (!translatedProfile.icuVars.has(name)) {
      errors.push(`Placeholder {${name}} is missing or was changed`);
    }
  }

  for (const name of sourceProfile.numericVars) {
    if (!translatedProfile.numericVars.has(name)) {
      errors.push(`Placeholder {${name}} is missing or was changed`);
    }
  }

  if (sourceProfile.hasPlural && !translatedProfile.hasPlural) {
    errors.push('Plural structure is missing');
  }

  if (sourceProfile.hasPlural) {
    for (const key of sourceProfile.pluralKeys) {
      if (!translatedProfile.pluralKeys.has(key)) {
        errors.push(`Plural branch missing: ${key}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createQpsLimiter(qpsLimit: number) {
  const limit = Math.max(1, Math.floor(Number.isFinite(qpsLimit) ? qpsLimit : 1));
  const windowMs = 1000;
  const timestamps: number[] = [];

  return async () => {
    while (true) {
      const now = Date.now();
      while (timestamps.length > 0 && now - timestamps[0] >= windowMs) {
        timestamps.shift();
      }

      if (timestamps.length < limit) {
        timestamps.push(now);
        return;
      }

      const waitMs = windowMs - (now - timestamps[0]);
      await delay(waitMs);
    }
  };
}

/**
 * Insert or update a translation node inside XTB content
 */
function upsertTranslation(
  content: string,
  idHash: string,
  translation: string
): { updated: string; action: 'updated' | 'inserted' } {
  const escaped = escapeXml(translation);
  const translationRegex = new RegExp(
    `<translation\\s+id\\s*=\\s*["']${idHash}["'][^>]*>([\\s\\S]*?)<\\/translation>`,
    'i'
  );

  if (translationRegex.test(content)) {
    const updated = content.replace(translationRegex, (match) => {
      const indentMatch = match.match(/(^|\n)(\s*)<translation/);
      const indent = indentMatch ? indentMatch[2] : '  ';
      return `${indent}<translation id="${idHash}">${escaped}</translation>`;
    });

    return { updated, action: 'updated' };
  }

  const closingMatch = content.match(/(^|\n)(\s*)<\/translationbundle>/i);
  if (!closingMatch) {
    throw new Error('XTB file is missing the </translationbundle> closing tag');
  }

  const closingIndent = closingMatch[2] ?? '';
  const translationIndentMatch = content.match(/(^|\n)(\s*)<translation\b/);
  const translationIndent = translationIndentMatch ? translationIndentMatch[2] : `${closingIndent}  `;

  const beforeClosing = content.slice(0, closingMatch.index ?? content.length);
  const afterClosing = content.slice((closingMatch.index ?? content.length) + closingMatch[0].length);
  const trimmedBefore = beforeClosing.replace(/\s*$/, '');

  const updated = `${trimmedBefore}\n${translationIndent}<translation id="${idHash}">${escaped}</translation>\n${closingIndent}</translationbundle>${afterClosing}`;

  return { updated, action: 'inserted' };
}

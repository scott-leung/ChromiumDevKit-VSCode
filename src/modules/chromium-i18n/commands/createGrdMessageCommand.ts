import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { GritServiceV2 } from '../services/gritServiceV2';
import { escapeXml, upsertTranslation } from '../utils/xmlUtils';
import { configService } from '../services/configService';
import { AIClient, ChatMessage } from '../../ai/aiClient';
import { getLanguageDisplayName, getAllSupportedLanguages } from '../utils/languageUtils';
import { CreateMessageWebview, CreateMessageData, AIResultData } from '../views/createMessageWebview';
import { IndexService } from '../services/indexService';
import { QueryService } from '../services/queryService';
import {
    showTranslationReviewPanel,
    buildPlaceholderProfile,
    validateTranslationPlaceholders,
    createQpsLimiter,
    TranslationDraft,
    LanguageOption
} from './aiTranslateCommand';

/**
 * Command to create a new GRD message and optionally translate it
 */
export async function createGrdMessageCommand(uri?: vscode.Uri): Promise<void> {
    // 1. Determine file path
    let filePath: string | undefined;
    if (uri && uri instanceof vscode.Uri) {
        filePath = uri.fsPath;
    } else if (vscode.window.activeTextEditor) {
        filePath = vscode.window.activeTextEditor.document.uri.fsPath;
    }

    if (!filePath || (!filePath.endsWith('.grd') && !filePath.endsWith('.grdp'))) {
        vscode.window.showErrorMessage('Please select a .grd or .grdp file to create a message.');
        return;
    }

    // 2. Initialize IndexService for GRDP parent resolution
    const queryService = QueryService.getInstance();
    const indexService = new IndexService();
    // Note: IndexService needs chromiumRoot, but for resolveParentGRDForGRDP it only queries the DB

    // 3. Parse GRD to find available languages
    const availableLanguages = await getAvailableLanguages(filePath, indexService);
    const allLanguages = getAllSupportedLanguages();
    const defaultLocale = configService.getOverlayLanguage();

    // 4. Show Webview
    const webview = new CreateMessageWebview(
        getExtensionUri(),
        filePath,
        availableLanguages,
        allLanguages,
        defaultLocale,
        async (data) => {
            return await handleRequestAI(data);
        },
        async (data) => {
            await handleCreateMessage(filePath!, data);
        }
    );
    webview.show();
}

function getExtensionUri(): vscode.Uri {
    const ext = vscode.extensions.getExtension('ScottLeung.chromium-dev-kit');
    return ext ? ext.extensionUri : vscode.Uri.file(__dirname);
}

async function getAvailableLanguages(grdFilePath: string, indexService?: IndexService): Promise<string[]> {
    try {
        let fileToRead = grdFilePath;

        // If this is a GRDP file, we need to find its parent GRD file
        if (grdFilePath.endsWith('.grdp') && indexService) {
            const parentGrd = await indexService.resolveParentGRDForGRDP(grdFilePath);
            if (parentGrd && fs.existsSync(parentGrd)) {
                console.log(`[createGrdMessageCommand] GRDP detected, using parent GRD: ${parentGrd}`);
                fileToRead = parentGrd;
            } else {
                console.warn(`[createGrdMessageCommand] Parent GRD not found for GRDP: ${grdFilePath}`);
                return [];
            }
        }

        const content = fs.readFileSync(fileToRead, 'utf-8');
        const xtbRegex = /<file\s+path="[^"]+"\s+lang="([^"]+)"/g;
        const languages: string[] = [];
        let match;
        while ((match = xtbRegex.exec(content)) !== null) {
            languages.push(match[1]);
        }
        return languages;
    } catch (e) {
        console.error('Failed to parse languages from GRD:', e);
        return [];
    }
}

async function handleRequestAI(data: CreateMessageData): Promise<AIResultData> {
    let { idsName, description, content, meaning, inputLang } = data;
    const result: AIResultData = {};

    try {
        const apiKey = await configService.ensureApiKeyInteractive();
        const aiClient = new AIClient({
            apiKey,
            baseUrl: configService.getAIConfig().baseUrl,
            model: configService.getAIConfig().model,
            timeoutMs: configService.getAIConfig().timeout
        });

        // 1. Translate to English if needed
        if (inputLang !== 'en') {
            // Build the translation request
            const meaningPart = meaning ? `\nMeaning: ${meaning}` : '';
            const prompt = `Translate the following to English for a Chromium Browser UI message. Return JSON format: {"content": "...", "description": "..."${meaning ? ', "meaning": "..."' : ''}}.
Input Language: ${inputLang}
Content: ${content}
Description: ${description}${meaningPart}`;

            const response = await aiClient.chat([{ role: 'user', content: prompt }]);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const translated = JSON.parse(jsonMatch[0]);
                result.content = translated.content;
                result.description = translated.description;
                // Only include meaning in result if it was originally provided
                if (meaning && translated.meaning) {
                    result.meaning = translated.meaning;
                }

                // Update local vars for ID generation
                content = result.content!;
                description = result.description!;
            }
        }

        // 2. Generate ID if needed
        if (!idsName) {
            const meaningPart = meaning ? `\nMeaning: ${meaning}` : '';
            const prompt = `Generate a Chromium GRIT message ID (e.g., IDS_FEATURE_DESCRIPTION) for the following content. Return ONLY the ID.
Content: ${content}
Description: ${description}${meaningPart}`;

            const response = await aiClient.chat([{ role: 'user', content: prompt }]);
            let generatedId = response.trim().replace(/[^A-Z0-9_]/g, '');
            if (!generatedId.startsWith('IDS_')) generatedId = 'IDS_' + generatedId;
            result.idsName = generatedId;
        }

        return result;

    } catch (e: any) {
        throw new Error(`AI processing failed: ${e.message}`);
    }
}

async function handleCreateMessage(filePath: string, data: CreateMessageData) {
    let { idsName, description, content, meaning, targetLangs, inputLang } = data;

    // 1. Calculate Hash ID (using English content)
    let idHash: string;
    try {
        const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false });
        const parsed = parser.parse(`<root>${content}</root>`);

        let children: any[] = [];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].root) {
            children = parsed[0].root;
        }

        const presentableText = GritServiceV2.generatePresentableText(children);
        idHash = GritServiceV2.calculateHashId(presentableText, meaning);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed to calculate message hash: ${e}`);
        return;
    }

    // 2. Update GRD File
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // Construct new message XML
        // Use meaning attribute only if provided
        const meaningAttr = meaning ? ` meaning="${escapeXml(meaning)}"` : '';
        const messageXml = `<message name="${idsName}" desc="${escapeXml(description)}"${meaningAttr}>\n        ${content}\n      </message>`;

        let newFileContent = fileContent;
        const messagesEndRegex = /(<\/\s*messages\s*>)/i;
        const releaseEndRegex = /(<\/\s*release\s*>)/i;

        // Helper to insert with correct indentation
        const insertBefore = (regex: RegExp, content: string) => {
            return content.replace(regex, (match, tag) => {
                // Try to detect indentation of the closing tag
                const matchIndex = content.indexOf(match);
                const lastNewLine = content.lastIndexOf('\n', matchIndex);
                const indent = lastNewLine !== -1 ? content.substring(lastNewLine + 1, matchIndex) : '      ';

                // If the indent seems to be the closing tag's indent, we want the message to be indented one level deeper?
                // Actually, usually messages are siblings.
                // Let's assume standard 2-space or 4-space indentation.
                // But better to just use the detected indent of the closing tag, and maybe add a newline before it.

                return `${indent}${messageXml}\n${match}`;
            });
        };

        if (messagesEndRegex.test(fileContent)) {
            newFileContent = insertBefore(messagesEndRegex, fileContent);
        } else if (releaseEndRegex.test(fileContent)) {
            newFileContent = insertBefore(releaseEndRegex, fileContent);
        } else {
            newFileContent = fileContent + '\n' + messageXml;
        }

        fs.writeFileSync(filePath, newFileContent, 'utf-8');
        vscode.window.showInformationMessage(`Message ${idsName} created successfully.`);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed to write to file: ${e}`);
        return;
    }

    // 3. Handle Translations with AI Translation Preview
    if (targetLangs && targetLangs.length > 0) {
        const originalLang = (data as any)._originalLang || inputLang;
        const originalContent = (data as any)._originalContent || content;

        // For GRDP files, we need to find the parent GRD file to locate XTB references
        let grdFileForXtb = filePath;
        if (filePath.endsWith('.grdp')) {
            const queryService = QueryService.getInstance();
            const indexService = new IndexService();
            const parentGrd = await indexService.resolveParentGRDForGRDP(filePath);

            if (parentGrd && fs.existsSync(parentGrd)) {
                console.log(`[createGrdMessageCommand] GRDP detected, using parent GRD for XTB lookup: ${parentGrd}`);
                grdFileForXtb = parentGrd;
            } else {
                console.warn(`[createGrdMessageCommand] Parent GRD not found for GRDP, cannot locate XTB files: ${filePath}`);
                vscode.window.showWarningMessage('Parent GRD file not found for GRDP. Cannot locate XTB files.');
                return;
            }
        }

        // Build language options from selected target languages
        const grdContent = fs.readFileSync(grdFileForXtb, 'utf-8');
        const dir = path.dirname(grdFileForXtb);
        const languageOptions: LanguageOption[] = [];

        for (const lang of targetLangs) {
            const regex = new RegExp(`<file\\s+path="([^"]+)"\\s+lang="${lang}"`, 'i');
            const match = regex.exec(grdContent);
            if (match) {
                const xtbPath = path.join(dir, match[1]);
                if (fs.existsSync(xtbPath)) {
                    languageOptions.push({
                        label: `${getLanguageDisplayName(lang)} (${lang})`,
                        value: lang,
                        xtbPath
                    });
                }
            }
        }

        if (languageOptions.length === 0) {
            vscode.window.showWarningMessage('No XTB files found for selected languages');
            return;
        }

        // Build drafts: input language gets original content immediately, others are pending
        const drafts: TranslationDraft[] = languageOptions.map(opt => {
            if (opt.value === originalLang && originalLang !== 'en') {
                return {
                    ...opt,
                    translation: originalContent,
                    status: 'success' as const,
                    defaultSelected: true
                };
            }
            return {
                ...opt,
                translation: '',
                status: 'pending' as const,
                defaultSelected: true
            };
        });

        // Show AI Translation Preview window
        const reviewSession = showTranslationReviewPanel(idsName, content, drafts);

        // Initialize AI client and start translations
        const apiKey = await configService.ensureApiKeyInteractive();
        const aiClient = new AIClient({
            apiKey,
            baseUrl: configService.getAIConfig().baseUrl,
            model: configService.getAIConfig().model,
            timeoutMs: configService.getAIConfig().timeout
        });

        const abortController = new AbortController();
        const limiter = createQpsLimiter(configService.getAIConfig().qpsLimit);
        const placeholderProfile = buildPlaceholderProfile(content);

        const translateDraft = async (draft: TranslationDraft) => {
            // Skip if this is input language (already has original content)
            if (draft.value === originalLang && originalLang !== 'en') {
                return;
            }

            try {
                draft.status = 'pending';
                draft.error = undefined;
                reviewSession.updateDrafts([
                    { value: draft.value, status: 'pending', error: undefined, resetUserEdited: false }
                ]);

                await limiter();

                const systemPrompt = configService.getPromptForLanguage(getLanguageDisplayName(draft.value));
                const userPrompt = `String ID: ${idHash}\nDescription: ${description}\n${meaning ? `Meaning: ${meaning}\n` : ''}Source Text: ${content}`;
                const messages: ChatMessage[] = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ];

                const aiResult = await aiClient.chat(messages, { signal: abortController.signal });
                const validation = validateTranslationPlaceholders(placeholderProfile, aiResult);

                draft.translation = aiResult;
                draft.status = validation.ok ? 'success' : 'failed';
                draft.error = validation.ok ? undefined : `Validation failed: ${validation.errors.join('; ')}`;

                reviewSession.updateDrafts([{
                    value: draft.value,
                    translation: aiResult,
                    status: draft.status,
                    error: draft.error,
                    shouldAutoCheck: validation.ok,
                    forceUpdate: true,
                    resetUserEdited: true
                }]);
            } catch (error) {
                const reason = abortController.signal.aborted && (error as any)?.name === 'AbortError'
                    ? 'Cancelled'
                    : error instanceof Error ? error.message : String(error);

                draft.status = 'failed';
                draft.error = reason;
                reviewSession.updateDrafts([{
                    value: draft.value,
                    status: 'failed',
                    error: reason
                }]);

                if (!abortController.signal.aborted) {
                    console.error(`[createGrdMessage] Translation error for ${draft.value}:`, error);
                }
            }
        };

        // Start all translation tasks
        const translationTasks = drafts.map(draft => translateDraft(draft));
        reviewSession.waitForSelection.finally(() => abortController.abort());
        void Promise.allSettled(translationTasks);

        // Wait for user to review and apply
        const reviewSelections = await reviewSession.waitForSelection;

        if (!reviewSelections || reviewSelections.length === 0) {
            vscode.window.showInformationMessage(`Message ${idsName} created (no translations applied)`);
            return;
        }

        // Write selected translations to XTB files
        const successes: string[] = [];
        const failures: Array<{ lang: string; reason: string }> = [];

        for (const selection of reviewSelections) {
            const trimmed = selection.translation.trim();
            if (trimmed.length === 0) {
                failures.push({ lang: selection.lang, reason: 'Empty translation' });
                continue;
            }

            const validation = validateTranslationPlaceholders(placeholderProfile, trimmed);
            if (!validation.ok) {
                failures.push({ lang: selection.lang, reason: validation.errors.join('; ') });
                continue;
            }

            try {
                const xtbContent = fs.readFileSync(selection.xtbPath, 'utf-8');
                const result = upsertTranslation(xtbContent, idHash, trimmed);
                fs.writeFileSync(selection.xtbPath, result.updated, 'utf-8');
                successes.push(selection.lang);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                failures.push({ lang: selection.lang, reason });
            }
        }

        // Show summary
        const parts: string[] = [];
        if (successes.length > 0) {
            parts.push(`✅ ${successes.join(', ')}`);
        }
        if (failures.length > 0) {
            parts.push(`❌ ${failures.map(f => `${f.lang}(${f.reason})`).join(', ')}`);
        }

        vscode.window.showInformationMessage(
            `Message ${idsName} created${parts.length > 0 ? ': ' + parts.join(' | ') : ''}`
        );
    }
}

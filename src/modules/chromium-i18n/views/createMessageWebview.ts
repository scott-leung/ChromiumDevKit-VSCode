import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getLanguageDisplayName, getSortedLanguages } from '../utils/languageUtils';

export interface CreateMessageData {
    idsName: string;
    description: string;
    content: string;
    meaning?: string;
    inputLang: string;
    targetLangs: string[];
}

export interface AIResultData {
    idsName?: string;
    content?: string;
    description?: string;
    meaning?: string;
}

export class CreateMessageWebview {
    public static readonly viewType = 'chromiumI18n.createMessage';
    private _panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _filePath: string,
        private readonly _availableLanguages: string[],
        private readonly _allLanguages: string[],
        private readonly _defaultLocale: string,
        private readonly _onDidRequestAI: (data: CreateMessageData) => Promise<AIResultData>,
        private readonly _onDidCreate: (data: CreateMessageData) => void
    ) { }

    public show() {
        this._panel = vscode.window.createWebviewPanel(
            CreateMessageWebview.viewType,
            'Create GRD Message',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
            }
        );

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'requestAI':
                        try {
                            const result = await this._onDidRequestAI(message.data);
                            this._panel?.webview.postMessage({ command: 'aiResult', data: result });
                        } catch (e: any) {
                            this._panel?.webview.postMessage({ command: 'error', message: e.message || 'AI processing failed' });
                        }
                        return;
                    case 'create':
                        this._onDidCreate(message.data);
                        this._panel?.dispose();
                        return;
                    case 'cancel':
                        this._panel?.dispose();
                        return;
                }
            },
            null,
            []
        );

        // Send initialization data
        const sortedInputLangs = getSortedLanguages(this._allLanguages);
        this._panel.webview.postMessage({
            command: 'init',
            filePath: this._filePath,
            availableLanguages: this._availableLanguages.map(lang => ({
                code: lang,
                label: `${getLanguageDisplayName(lang)} (${lang})`
            })),
            allLanguages: sortedInputLangs.map(lang => ({
                code: lang,
                label: `${getLanguageDisplayName(lang)} (${lang})`
            })),
            defaultLocale: this._defaultLocale
        });
    }

    private _getHtmlForWebview(): string {
        // Try dist path first (production), then src path (development)
        const distPath = path.join(this._extensionUri.fsPath, 'dist', 'createMessageView.html');
        const srcPath = path.join(
            this._extensionUri.fsPath,
            'src',
            'modules',
            'chromium-i18n',
            'views',
            'createMessageView.html'
        );

        const templatePath = fs.existsSync(distPath) ? distPath : srcPath;
        const html = fs.readFileSync(templatePath, 'utf-8');
        return html;
    }
}

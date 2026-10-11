// ScriptEngine.ts
import { App, Notice, TFile, MarkdownView, Editor, requestUrl } from 'obsidian';
import type ChemEditPlugin from './main';

export class ChemScriptEngine {
    plugin: ChemEditPlugin;
    app: App;
    private registeredCommandIds: string[] = [];

    constructor(plugin: ChemEditPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    async loadScripts() {
        this.registeredCommandIds.forEach(id => {
            const fullId = `chemedit:${id}`;
            // @ts-ignore
            if (this.app.commands.removeCommand) this.app.commands.removeCommand(fullId);
            else {
                // @ts-ignore
                delete this.app.commands.commands[fullId];
                // @ts-ignore
                delete this.app.commands.editorCommands[fullId];
            }
        });
        this.registeredCommandIds = [];

        const folderPath = this.plugin.settings.scriptsFolder;
        if (!folderPath) return;

        const folderExists = await this.app.vault.adapter.exists(folderPath);
        if (!folderExists) return;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) return;

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension === 'js') as TFile[];

        for (const file of files) {
            const cleanName = file.basename;
            const commandId = `script-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            
            this.plugin.addCommand({
                id: commandId,
                name: `Run Script: ${cleanName}`,
                editorCallback: async (editor: Editor, view: MarkdownView) => {
                    await this.executeScript(file, editor, view);
                }
            });

            this.registeredCommandIds.push(commandId);
        }
    }

    private async executeScript(file: TFile, editor: Editor, view: MarkdownView) {
        try {
            const code = await this.app.vault.read(file);
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            
            // WE NOW PASS Notice AND requestUrl DIRECTLY INTO THE SANDBOX!
            const fn = new AsyncFunction('app', 'plugin', 'api', 'editor', 'view', 'Notice', 'requestUrl', code);
            await fn(this.app, this.plugin, this.plugin.api, editor, view, Notice, requestUrl);
            
        } catch (err: any) {
            new Notice(`❌ ChemEdit Script Error: ${err.message}`);
            console.error(err);
        }
    }
}
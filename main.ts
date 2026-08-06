import { App, Modal, Plugin, MarkdownView, PluginSettingTab, Setting, Editor, Notice, requestUrl } from 'obsidian';
import * as http from 'http';
import * as https from 'https';
import SmiDrawer from 'smiles-drawer';

// --- SETTINGS INTERFACE & DEFAULTS ---
interface ChemEditSettings {
    width: number;
    height: number;
    lightTheme: string;
    darkTheme: string;
}

const DEFAULT_SETTINGS: ChemEditSettings = {
    width: 300,
    height: 300,
    lightTheme: 'light',
    darkTheme: 'dark'
}

export default class ChemEditPlugin extends Plugin {
    server: http.Server | null = null;
    port: number = 0;
    settings: ChemEditSettings;
    
    // Create a memory cache to make Ketcher load instantly after the first open!
    assetCache = new Map<string, { type: string, data: ArrayBuffer }>();

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new ChemEditSettingTab(this.app, this));
        this.startKetcherServer();

        this.addRibbonIcon('hexagon', 'Draw New Molecule (ChemEdit)', () => {
            this.openNewDrawingModal();
        });

        this.addCommand({
            id: 'insert-new-molecule',
            name: 'Draw new molecule/reaction',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new KetcherModal(this, "", (newSmiles) => {
                    this.insertSmilesAtCursor(editor, newSmiles);
                }).open();
            }
        });

        this.registerMarkdownCodeBlockProcessor("smiles", (source, el, ctx) => {
            const cleanSmiles = source.trim();
            
            const wrapper = document.createElement("div");
            wrapper.style.cursor = "pointer";
            wrapper.title = "Double-click to edit structure";
            el.appendChild(wrapper);

            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
            
            const drawerOptions = {
                width: this.settings.width,
                height: this.settings.height
            };

            try {
                // @ts-ignore
                const Smi: any = SmiDrawer; 

                if (cleanSmiles.includes('>')) {
                    Smi.parseReaction(cleanSmiles, 
                        (tree: any) => {
                            const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                            const svg = rxnDrawer.draw(tree, "svg", theme);
                            wrapper.appendChild(svg);
                        },
                        (err: any) => el.createDiv({ text: `Reaction Error: ${err}`, cls: 'color-red' })
                    );
                } else {
                    const canvas = document.createElement("canvas");
                    wrapper.appendChild(canvas);
                    Smi.parse(cleanSmiles, 
                        (tree: any) => {
                            const drawer = new Smi.Drawer(drawerOptions);
                            drawer.draw(tree, canvas, theme);
                        },
                        (err: any) => el.createDiv({ text: `Molecule Error: ${err}`, cls: 'color-red' })
                    );
                }
            } catch (err: any) {
                el.createDiv({ text: `Drawer Error: ${err.message}`, cls: 'color-red' });
            }

            wrapper.addEventListener("dblclick", () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;

                const info = ctx.getSectionInfo(el);
                if (!info) return;

                new KetcherModal(this, cleanSmiles, (newSmiles) => {
                    const editor = view.editor;
                    editor.replaceRange(
                        newSmiles + "\n",
                        { line: info.lineStart + 1, ch: 0 },
                        { line: info.lineEnd, ch: 0 }
                    );
                }).open();
            });
        });
    }

    onunload() {
        if (this.server) {
            this.server.close();
            console.log("ChemEdit: Ketcher proxy server shut down.");
        }
        this.assetCache.clear(); // Free memory
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    openNewDrawingModal() {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice("Please open a Markdown file first to insert a drawing.");
            return;
        }
        new KetcherModal(this, "", (newSmiles) => {
            this.insertSmilesAtCursor(view.editor, newSmiles);
        }).open();
    }

    insertSmilesAtCursor(editor: Editor, smiles: string) {
        const cursor = editor.getCursor();
        const textToInsert = `\`\`\`smiles\n${smiles}\n\`\`\`\n`;
        editor.replaceRange(textToInsert, cursor);
        editor.setCursor({ line: cursor.line + 3, ch: 0 });
    }

    startKetcherServer() {
        this.server = http.createServer(async (req, res) => {
            try {
                const urlPath = req.url!;

                if (urlPath === '/' || urlPath === '/index.html' || urlPath.startsWith('/?')) {
                    const response = await requestUrl({
                        url: 'https://lifescience.opensource.epam.com/KetcherDemoSA/index.html',
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    
                    let html = response.text;
                    const bridgeScript = `
                    <script>
                        window.addEventListener('message', function(event) {
                            if (!event.data) return;
                            if (event.data.type === 'setSmiles') {
                                var check = setInterval(function() {
                                    if (window.ketcher) {
                                        window.ketcher.setMolecule(event.data.smiles);
                                        clearInterval(check);
                                    }
                                }, 200);
                            } else if (event.data.type === 'getSmiles') {
                                if (window.ketcher) {
                                    window.ketcher.getSmiles().then(function(smiles) {
                                        window.parent.postMessage({ type: 'saveSmiles', smiles: smiles }, '*');
                                    });
                                }
                            }
                        });
                    </script>`;

                    html = html.replace('<head>', '<head>\n' + bridgeScript);

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html, 'utf-8');
                    return;
                }

                const cleanPath = urlPath.split('?')[0];
                const targetUrl = cleanPath.startsWith('/KetcherDemoSA')
                    ? 'https://lifescience.opensource.epam.com' + urlPath
                    : 'https://lifescience.opensource.epam.com/KetcherDemoSA' + (urlPath.startsWith('/') ? '' : '/') + urlPath;

                // --- INSTANT CACHE SYSTEM ---
                if (this.assetCache.has(targetUrl)) {
                    const cached = this.assetCache.get(targetUrl)!;
                    res.writeHead(200, {
                        'Content-Type': cached.type,
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(Buffer.from(cached.data));
                    return;
                }

                const assetRes = await requestUrl({
                    url: targetUrl,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*' }
                });

                let contentType = 'application/octet-stream';
                if (cleanPath.endsWith('.js')) contentType = 'application/javascript';
                else if (cleanPath.endsWith('.css')) contentType = 'text/css';
                else if (cleanPath.endsWith('.svg')) contentType = 'image/svg+xml';
                else if (cleanPath.endsWith('.woff2')) contentType = 'font/woff2';
                else if (cleanPath.endsWith('.png')) contentType = 'image/png';
                else if (cleanPath.endsWith('.json')) contentType = 'application/json';
                else if (assetRes.headers['content-type']) contentType = assetRes.headers['content-type'];

                // Save to Cache so we never download it again this session
                this.assetCache.set(targetUrl, { type: contentType, data: assetRes.arrayBuffer });

                res.writeHead(assetRes.status || 200, {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(Buffer.from(assetRes.arrayBuffer));

            } catch (e: any) {
                res.writeHead(500);
                res.end();
            }
        });

        this.server.listen(0, '127.0.0.1', () => {
            this.port = (this.server?.address() as any).port;
        });
    }
}

class KetcherModal extends Modal {
    plugin: ChemEditPlugin;
    initialSmiles: string;
    onSave: (smiles: string) => void;
    messageListener: (event: MessageEvent) => void;

    constructor(plugin: ChemEditPlugin, initialSmiles: string, onSave: (smiles: string) => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.initialSmiles = initialSmiles;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        this.modalEl.style.width = "85vw";
        this.modalEl.style.height = "85vh";

        const iframe = document.createElement("iframe");
        
        iframe.src = `http://127.0.0.1:${this.plugin.port}/`;
        iframe.style.width = "100%";
        iframe.style.height = "calc(100% - 50px)";
        iframe.style.border = "none";
        iframe.style.backgroundColor = "white"; 
        
        contentEl.appendChild(iframe);

        iframe.onload = () => {
            if (this.initialSmiles && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'setSmiles', smiles: this.initialSmiles }, '*');
            }
        };

        this.messageListener = (event: MessageEvent) => {
            if (event.data && event.data.type === 'saveSmiles') {
                this.onSave(event.data.smiles);
                this.close();
            }
        };
        window.addEventListener('message', this.messageListener);

        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.marginTop = "10px";
        btnContainer.style.gap = "10px";

        const saveBtn = btnContainer.createEl("button", { text: "Save to Note", cls: "mod-cta" });
        const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });

        saveBtn.onclick = () => {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'getSmiles' }, '*');
            }
        };

        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        window.removeEventListener('message', this.messageListener);
        this.contentEl.empty();
    }
}

class ChemEditSettingTab extends PluginSettingTab {
    plugin: ChemEditPlugin;

    constructor(app: App, plugin: ChemEditPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'ChemEdit Settings'});

        new Setting(containerEl)
            .setName('Image Width')
            .setDesc('Set the width of the rendered structure (in pixels)')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(this.plugin.settings.width.toString())
                .onChange(async (value) => {
                    this.plugin.settings.width = parseInt(value) || 300;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Height')
            .setDesc('Set the height of the rendered structure (in pixels)')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(this.plugin.settings.height.toString())
                .onChange(async (value) => {
                    this.plugin.settings.height = parseInt(value) || 300;
                    await this.plugin.saveSettings();
                }));

        const themeOptions = {
            'light': 'Light',
            'dark': 'Dark',
            'oldschool': 'Oldschool (B&W)',
            'solarized': 'Solarized Light',
            'solarized-dark': 'Solarized Dark',
            'matrix': 'Matrix',
            'cyberpunk': 'Cyberpunk'
        };

        new Setting(containerEl)
            .setName('Light Theme')
            .setDesc('Color theme used when Obsidian is in Light Mode')
            .addDropdown(dropdown => dropdown
                .addOptions(themeOptions)
                .setValue(this.plugin.settings.lightTheme)
                .onChange(async (value) => {
                    this.plugin.settings.lightTheme = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Dark Theme')
            .setDesc('Color theme used when Obsidian is in Dark Mode')
            .addDropdown(dropdown => dropdown
                .addOptions(themeOptions)
                .setValue(this.plugin.settings.darkTheme)
                .onChange(async (value) => {
                    this.plugin.settings.darkTheme = value;
                    await this.plugin.saveSettings();
                }));
    }
}
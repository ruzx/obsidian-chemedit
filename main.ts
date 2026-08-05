import { App, Modal, Plugin, MarkdownView, PluginSettingTab, Setting, Editor, Notice } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import SmiDrawer from 'smiles-drawer';

// --- SETTINGS INTERFACE & DEFAULTS ---
interface ChemEditSettings {
    width: number;
    height: number;
    lightTheme: string;
    darkTheme: string;
    compactDrawing: boolean;
}

const DEFAULT_SETTINGS: ChemEditSettings = {
    width: 300,
    height: 300,
    lightTheme: 'light',
    darkTheme: 'dark',
    compactDrawing: false
}

export default class ChemEditPlugin extends Plugin {
    server: http.Server | null = null;
    port: number = 0;
    settings: ChemEditSettings;

    async onload() {
        await this.loadSettings();

        // 1. Add Settings Tab
        this.addSettingTab(new ChemEditSettingTab(this.app, this));

        // 2. Start the local server to host Ketcher
        this.startKetcherServer();

        // 3. Add a Ribbon Icon to instantly draw a new molecule
        this.addRibbonIcon('hexagon', 'Draw New Molecule (ChemEdit)', () => {
            this.openNewDrawingModal();
        });

        // 4. Add a Command Palette command for keyboard users
        this.addCommand({
            id: 'insert-new-molecule',
            name: 'Draw new molecule/reaction',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new KetcherModal(this, "", (newSmiles) => {
                    this.insertSmilesAtCursor(editor, newSmiles);
                }).open();
            }
        });

        // 5. Register the Markdown code block processor
        this.registerMarkdownCodeBlockProcessor("smiles", (source, el, ctx) => {
            const cleanSmiles = source.trim();
            
            const wrapper = document.createElement("div");
            wrapper.style.cursor = "pointer";
            wrapper.title = "Double-click to edit structure";
            el.appendChild(wrapper);

            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
            
            // Build the options object from settings
            const drawerOptions = {
                width: this.settings.width,
                height: this.settings.height,
                compactDrawing: this.settings.compactDrawing,
				atomVisualization: 'default', // <-- REQUIRED for Ac, Me, Et, etc.
				explicitHydrogens: false      // <-- Helps compact drawing trigger correctly
            };

            try {
                const Smi: any = SmiDrawer; 

                if (cleanSmiles.includes('>')) {
                    // Reactions
                    Smi.parseReaction(cleanSmiles, 
                        (tree: any) => {
                            const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                            const svg = rxnDrawer.draw(tree, "svg", theme);
                            wrapper.appendChild(svg);
                        },
                        (err: any) => el.createDiv({ text: `Reaction Error: ${err}`, cls: 'color-red' })
                    );
                } else {
                    // Molecules
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

            // Edit existing structure
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
            console.log("ChemEdit: Ketcher server shut down.");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /** Helper to open a blank Ketcher modal and insert into the active file */
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

    /** Helper to insert the SMILES block into the editor */
    insertSmilesAtCursor(editor: Editor, smiles: string) {
        const cursor = editor.getCursor();
        const textToInsert = `\`\`\`smiles\n${smiles}\n\`\`\`\n`;
        editor.replaceRange(textToInsert, cursor);
        // Move the cursor below the newly inserted block
        editor.setCursor({ line: cursor.line + 3, ch: 0 });
    }

    startKetcherServer() {
        // @ts-ignore
        const basePath = this.app.vault.adapter.getBasePath();
        const ketcherDir = path.join(basePath, this.manifest.dir, 'ketcher');

        this.server = http.createServer((req, res) => {
            const urlPath = req.url!.split('?')[0];
            let filePath = path.join(ketcherDir, urlPath === '/' ? 'index.html' : urlPath);

            if (!filePath.startsWith(ketcherDir)) {
                res.writeHead(403);
                res.end();
                return;
            }

            const extname = path.extname(filePath);
            let contentType = 'text/html';
            switch (extname) {
                case '.js': contentType = 'application/javascript'; break;
                case '.css': contentType = 'text/css'; break;
                case '.json': contentType = 'application/json'; break;
                case '.png': contentType = 'image/png'; break;
                case '.svg': contentType = 'image/svg+xml'; break;
                case '.wasm': contentType = 'application/wasm'; break;
            }

            fs.readFile(filePath, (err, content) => {
                if (err) {
                    res.writeHead(404);
                    res.end('File not found');
                    return;
                }

                if (filePath.endsWith('index.html')) {
                    let html = content.toString('utf-8');
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
                    html = html.replace('</head>', bridgeScript + '</head>');
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html, 'utf-8');
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content);
                }
            });
        });

        this.server.listen(0, '127.0.0.1', () => {
            this.port = (this.server?.address() as any).port;
            console.log(`ChemEdit: Ketcher local server running on port ${this.port}`);
        });
    }
}

// --- MODAL ---
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

// --- SETTINGS TAB ---
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

        // Theme options natively supported by smiles-drawer
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

        new Setting(containerEl)
            .setName('Compact Drawing')
            .setDesc('Linearize simple structures and abbreviate common functional groups (e.g. show "Ac" instead of acetyl group)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.compactDrawing)
                .onChange(async (value) => {
                    this.plugin.settings.compactDrawing = value;
                    await this.plugin.saveSettings();
                }));
    }
}
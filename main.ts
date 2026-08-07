import { App, Modal, Plugin, MarkdownView, PluginSettingTab, Setting, Editor, Notice, requestUrl, TextFileView, WorkspaceLeaf, TFile } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import SmiDrawer from 'smiles-drawer';

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
    
    assetCache = new Map<string, { type: string, data: ArrayBuffer }>();

    hiddenIframe: HTMLIFrameElement;
    isHeadlessReady = false;
    isProcessingHeadless = false;
    headlessQueue: {id: string, data: string, format: string, resolve: (el: HTMLElement | null) => void}[] = [];
    renderQueue = new Map<string, (el: HTMLElement | null) => void>();
    renderTimeouts = new Map<string, NodeJS.Timeout>();

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChemEditSettingTab(this.app, this));
        
        this.startKetcherServer();

        this.registerView("chem-file-view", (leaf) => new ChemFileView(leaf, this));
        this.registerExtensions(["mol", "cdxml"], "chem-file-view");

        this.addRibbonIcon('hexagon', 'Draw New Molecule', () => {
            this.openNewDrawingModal();
        });

        this.addCommand({
            id: 'insert-new-molecule',
            name: 'Draw new SMILES molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData) => {
                    this.insertSmilesAtCursor(editor, newData);
                }).open();
            }
        });

        this.registerMarkdownPostProcessor(async (el, ctx) => {
            const embeds = el.querySelectorAll('.internal-embed');
            
            embeds.forEach(async (embed) => {
                const src = embed.getAttribute('src');
                if (src && (src.toLowerCase().endsWith('.mol') || src.toLowerCase().endsWith('.cdxml'))) {
                    
                    const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
                    if (!file || !(file instanceof TFile)) return;

                    embed.empty(); 
                    
                    const wrapper = document.createElement("div");
                    wrapper.style.cursor = "pointer";
                    wrapper.style.border = "1px solid var(--background-modifier-border)";
                    wrapper.style.borderRadius = "5px";
                    wrapper.style.padding = "10px";
                    wrapper.style.textAlign = "center";
                    wrapper.style.display = "block";
                    wrapper.style.margin = "10px 0";
                    wrapper.title = `Double-click to edit ${file.name}`;
                    wrapper.innerHTML = `<span class="color-text-muted">Loading preview...</span>`;
                    embed.appendChild(wrapper);

                    const fileData = await this.app.vault.read(file);
                    const format = file.extension.toLowerCase();
                    const previewEl = await this.renderMoleculeToPreview(fileData, format);
                    
                    if (!wrapper.isConnected) return;
                    wrapper.innerHTML = '';

                    if (previewEl) {
                        wrapper.appendChild(previewEl);
                    } else {
                        wrapper.innerHTML = `<div style="padding: 10px;">🧪 <b>${file.name}</b><br><span class="color-text-muted">Double-click to open Ketcher</span></div>`;
                    }

                    wrapper.addEventListener("dblclick", async (e) => {
                        e.stopPropagation(); 
                        const freshData = await this.app.vault.read(file);
                        
                        new KetcherModal(this, freshData, format, async (newData) => {
                            await this.app.vault.modify(file, newData);
                            wrapper.innerHTML = `<span class="color-text-muted">Updating...</span>`;
                            const updatedEl = await this.renderMoleculeToPreview(newData, format);
                            if(updatedEl && wrapper.isConnected) {
                                wrapper.innerHTML = '';
                                wrapper.appendChild(updatedEl);
                            }
                        }).open();
                    });
                }
            });
        });

        const fileCodeblockProcessor = async (source: string, el: HTMLElement, ctx: any) => {
            const match = source.match(/\[\[(.*?)\]\]/);
            if (match && match[1]) {
                const link = match[1];
                const file = this.app.metadataCache.getFirstLinkpathDest(link, ctx.sourcePath);
                if (file && file instanceof TFile) {
                    const format = file.extension.toLowerCase();
                    const wrapper = el.createDiv();
                    wrapper.style.textAlign = "center";
                    wrapper.style.border = "1px solid var(--background-modifier-border)";
                    wrapper.style.borderRadius = "5px";
                    wrapper.style.padding = "10px";
                    wrapper.style.cursor = "pointer";
                    wrapper.title = `Double-click to edit ${file.name}`;
                    wrapper.innerHTML = `<span class="color-text-muted">Loading preview...</span>`;
                    
                    const data = await this.app.vault.read(file);
                    const previewEl = await this.renderMoleculeToPreview(data, format);
                    
                    if (!wrapper.isConnected) return;
                    wrapper.empty();

                    if (previewEl) {
                        wrapper.appendChild(previewEl);
                    } else {
                        wrapper.innerHTML = `<div style="padding: 10px;">🧪 <b>${file.name}</b><br><span class="color-text-muted">Double-click to open Ketcher</span></div>`;
                    }

                    wrapper.addEventListener("dblclick", async (e) => {
                        e.stopPropagation();
                        const freshData = await this.app.vault.read(file);
                        new KetcherModal(this, freshData, format, async (newData) => {
                            await this.app.vault.modify(file, newData);
                            wrapper.innerHTML = `<span class="color-text-muted">Updating...</span>`;
                            const updatedEl = await this.renderMoleculeToPreview(newData, format);
                            if (updatedEl && wrapper.isConnected) {
                                wrapper.empty();
                                wrapper.appendChild(updatedEl);
                            }
                        }).open();
                    });
                    return;
                }
            }
            el.createDiv({ text: "Please use the format: [[filename.mol]]", cls: "color-red" });
        };

        this.registerMarkdownCodeBlockProcessor("mol", fileCodeblockProcessor);
        this.registerMarkdownCodeBlockProcessor("cdxml", fileCodeblockProcessor);

        this.registerMarkdownCodeBlockProcessor("smiles", (source, el) => {
            const cleanSmiles = source.trim();
            const wrapper = document.createElement("div");
            wrapper.style.cursor = "pointer";
            wrapper.title = "Double-click to edit structure";
            el.appendChild(wrapper);

            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
            const drawerOptions = { width: this.settings.width, height: this.settings.height };

            try {
                // @ts-ignore
                const Smi: any = SmiDrawer; 
                if (cleanSmiles.includes('>')) {
                    Smi.parseReaction(cleanSmiles, 
                        (tree: any) => {
                            const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                            wrapper.appendChild(rxnDrawer.draw(tree, "svg", theme));
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
                
                new KetcherModal(this, cleanSmiles, "smiles", (newData) => {
                    const editor = view.editor;
                    const content = editor.getValue();
                    const updatedContent = content.replace(source, newData + "\n");
                    editor.setValue(updatedContent);
                }).open();
            });
        });
    }

    onunload() {
        if (this.server) this.server.close();
        if (this.hiddenIframe) this.hiddenIframe.remove();
        this.renderTimeouts.forEach(t => clearTimeout(t));
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
        new KetcherModal(this, "", "smiles", (newSmiles) => {
            this.insertSmilesAtCursor(view.editor, newSmiles);
        }).open();
    }

    insertSmilesAtCursor(editor: Editor, smiles: string) {
        const cursor = editor.getCursor();
        const textToInsert = `\`\`\`smiles\n${smiles}\n\`\`\`\n`;
        editor.replaceRange(textToInsert, cursor);
        editor.setCursor({ line: cursor.line + 3, ch: 0 });
    }

    async renderMoleculeToPreview(data: string, format: string): Promise<HTMLElement | null> {
        return new Promise((resolve) => {
            const id = Math.random().toString(36).substring(7);
            this.renderQueue.set(id, resolve);
            this.headlessQueue.push({ id, data, format, resolve });
            this.processHeadlessQueue();
        });
    }

    processHeadlessQueue() {
        if (this.isProcessingHeadless || !this.isHeadlessReady || this.headlessQueue.length === 0) return;
        
        this.isProcessingHeadless = true;
        const task = this.headlessQueue.shift()!;
        
        const timeoutId = setTimeout(() => {
            console.warn(`ChemEdit: Ketcher timed out rendering ${task.id}. Skipping to next.`);
            const resolver = this.renderQueue.get(task.id);
            if (resolver) {
                resolver(null);
                this.renderQueue.delete(task.id);
            }
            this.isProcessingHeadless = false;
            this.processHeadlessQueue();
        }, 3000);

        this.renderTimeouts.set(task.id, timeoutId);
        
        this.hiddenIframe.contentWindow?.postMessage({
            type: 'renderPreview', id: task.id, data: task.data, format: task.format
        }, '*');
    }

    setupHeadlessRenderer() {
        this.hiddenIframe = document.createElement('iframe');
        this.hiddenIframe.src = `http://127.0.0.1:${this.port}/?t=${Date.now()}`;
        this.hiddenIframe.style.position = 'absolute';
        this.hiddenIframe.style.visibility = 'hidden';
        this.hiddenIframe.style.pointerEvents = 'none';
        this.hiddenIframe.style.width = '800px';
        this.hiddenIframe.style.height = '600px';
        document.body.appendChild(this.hiddenIframe);

        window.addEventListener('message', (event) => {
            if (!event.data) return;
            
            if (event.data.type === 'headlessReady') {
                this.isHeadlessReady = true;
                this.processHeadlessQueue();
            } 
            else if (event.data.type === 'previewSuccess') {
                const timeoutId = this.renderTimeouts.get(event.data.id);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    this.renderTimeouts.delete(event.data.id);
                }

                const resolver = this.renderQueue.get(event.data.id);
                if (resolver) {
                    if (event.data.smiles) {
                        try {
                            // @ts-ignore
                            const Smi: any = SmiDrawer;
                            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
                            const drawerOptions = { width: this.settings.width, height: this.settings.height };
                            
                            if (event.data.smiles.includes('>')) {
                                const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                                // @ts-ignore
                                Smi.parseReaction(event.data.smiles, (tree) => {
                                    resolver(rxnDrawer.draw(tree, "svg", theme));
                                });
                            } else {
                                const canvas = document.createElement("canvas");
                                Smi.parse(event.data.smiles, (tree: any) => {
                                    const drawer = new Smi.Drawer(drawerOptions);
                                    drawer.draw(tree, canvas, theme);
                                    resolver(canvas);
                                });
                            }
                        } catch(e) {
                            resolver(null);
                        }
                    } else if (event.data.svgUrl) {
                        const img = document.createElement("img");
                        img.src = event.data.svgUrl;
                        img.style.maxWidth = "100%";
                        img.style.maxHeight = "400px";
                        resolver(img);
                    } else {
                        resolver(null);
                    }
                    this.renderQueue.delete(event.data.id);
                }
                
                this.isProcessingHeadless = false;
                this.processHeadlessQueue();
            }
        });
    }

    getKetcherDir(): string {
        // @ts-ignore
        const basePath = this.app.vault.adapter.getBasePath();
        let baseDir = path.join(basePath, this.manifest.dir, 'ketcher');
        if (!fs.existsSync(path.join(baseDir, 'index.html')) && fs.existsSync(path.join(baseDir, 'standalone', 'index.html'))) {
            baseDir = path.join(baseDir, 'standalone');
        }
        return baseDir;
    }

    startKetcherServer() {
        this.server = http.createServer(async (req, res) => {
            try {
                const chunks: Buffer[] = [];
                req.on('data', chunk => chunks.push(chunk));
                req.on('end', async () => {
                    const urlPath = req.url!;
                    let cleanPath = urlPath.split('?')[0];

                    if (cleanPath.startsWith('/KetcherDemoSA')) {
                        cleanPath = cleanPath.substring('/KetcherDemoSA'.length);
                    }
                    if (cleanPath === '' || cleanPath === '/') cleanPath = '/index.html';

                    const ketcherDir = this.getKetcherDir();
                    const localFilePath = path.join(ketcherDir, cleanPath);
                    
                    const isApiCall = cleanPath.startsWith('/v2/');
                    const isOfflineMode = !isApiCall && fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile();

                    const bridgeScript = `
                    <script>
                        window.addEventListener('message', function(event) {
                            if (!event.data) return;
                            if (event.data.type === 'setMolecule') {
                                var check = setInterval(function() {
                                    if (window.ketcher) {
                                        window.ketcher.setMolecule(event.data.data);
                                        clearInterval(check);
                                    }
                                }, 200);
                            } else if (event.data.type === 'getMolecule') {
                                if (window.ketcher) {
                                    var format = event.data.format;
                                    var safeFallbackToMol = function() {
                                        window.ketcher.getMolfile().then(function(res) { window.parent.postMessage({ type: 'saveMolecule', data: res }, '*'); });
                                    };

                                    if (format === 'smiles') {
                                        window.ketcher.getSmiles().then(function(res) { window.parent.postMessage({ type: 'saveMolecule', data: res }, '*'); });
                                    } else if (format === 'cdxml') {
                                        if (typeof window.ketcher.getCDXml === 'function') {
                                            window.ketcher.getCDXml().then(function(res) { window.parent.postMessage({ type: 'saveMolecule', data: res }, '*'); }).catch(safeFallbackToMol);
                                        } else if (typeof window.ketcher.getCdxml === 'function') {
                                            window.ketcher.getCdxml().then(function(res) { window.parent.postMessage({ type: 'saveMolecule', data: res }, '*'); }).catch(safeFallbackToMol);
                                        } else {
                                            safeFallbackToMol();
                                        }
                                    } else {
                                        safeFallbackToMol();
                                    }
                                }
                            } else if (event.data.type === 'renderPreview') {
                                var fallbackToSmiles = function() {
                                    var p = window.ketcher.setMolecule(event.data.data);
                                    Promise.resolve(p).then(function() {
                                        return window.ketcher.getSmiles();
                                    }).then(function(smiles) {
                                        window.parent.postMessage({ type: 'previewSuccess', id: event.data.id, smiles: smiles }, '*');
                                    }).catch(function() {
                                        window.parent.postMessage({ type: 'previewSuccess', id: event.data.id, svgUrl: null }, '*');
                                    });
                                };

                                var attemptSVG = function() {
                                    if (!window.ketcher) {
                                        setTimeout(attemptSVG, 200);
                                        return;
                                    }
                                    if (window.ketcher.generateImage) {
                                        window.ketcher.generateImage(event.data.data, { outputFormat: 'svg', backgroundColor: 'transparent' })
                                            .then(function(blob) {
                                                var reader = new FileReader();
                                                reader.onload = function() { window.parent.postMessage({ type: 'previewSuccess', id: event.data.id, svgUrl: reader.result }, '*'); };
                                                reader.readAsDataURL(blob);
                                            })
                                            .catch(function(err) {
                                                fallbackToSmiles();
                                            });
                                    } else {
                                        fallbackToSmiles();
                                    }
                                };
                                attemptSVG();
                            }
                        });
                        var checkReady = setInterval(function() {
                            if (window.ketcher) {
                                clearInterval(checkReady);
                                window.parent.postMessage({ type: 'headlessReady' }, '*');
                            }
                        }, 200);
                    </script>`;

                    // 1. OFFLINE MODE
                    if (isOfflineMode) {
                        const ext = path.extname(localFilePath);
                        let mime = 'application/octet-stream';
                        if (ext === '.html') mime = 'text/html';
                        else if (ext === '.js') mime = 'application/javascript';
                        else if (ext === '.css') mime = 'text/css';
                        else if (ext === '.svg') mime = 'image/svg+xml';
                        else if (ext === '.wasm') mime = 'application/wasm';
                        else if (ext === '.json') mime = 'application/json';

                        const content = fs.readFileSync(localFilePath);
                        
                        if (cleanPath === '/index.html') {
                            let html = content.toString('utf-8');
                            html = html.replace('<head>', '<head>\n' + bridgeScript);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(html);
                        } else {
                            res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
                            res.end(content);
                        }
                        return;
                    }

                    // 2. ONLINE PROXY MODE
                    let targetUrl = isApiCall 
                        ? 'https://lifescience.opensource.epam.com' + cleanPath 
                        : 'https://lifescience.opensource.epam.com/KetcherDemoSA' + cleanPath;

                    if (req.method === 'GET' && this.assetCache.has(targetUrl)) {
                        const cached = this.assetCache.get(targetUrl)!;
                        res.writeHead(200, { 'Content-Type': cached.type, 'Access-Control-Allow-Origin': '*' });
                        res.end(Buffer.from(cached.data));
                        return;
                    }

                    const bodyBuffer = Buffer.concat(chunks);
                    const reqOptions: any = {
                        url: targetUrl,
                        method: req.method,
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36', 
                            'Accept': '*/*',
                            'Origin': 'https://lifescience.opensource.epam.com',
                            'Referer': 'https://lifescience.opensource.epam.com/KetcherDemoSA/index.html'
                        }
                    };

                    if (req.headers['content-type']) reqOptions.headers['Content-Type'] = req.headers['content-type'];
                    if (req.method !== 'GET' && req.method !== 'HEAD' && bodyBuffer.length > 0) {
                        reqOptions.body = bodyBuffer.buffer.slice(bodyBuffer.byteOffset, bodyBuffer.byteOffset + bodyBuffer.byteLength);
                    }

                    try {
                        const assetRes = await requestUrl(reqOptions);

                        if (cleanPath === '/index.html') {
                            // If EPAM threw an error for the main page, explicitly throw
                            if (assetRes.status >= 400) throw new Error(`HTTP ${assetRes.status}`);
                            
                            let html = assetRes.text;
                            html = html.replace('<head>', '<head>\n' + bridgeScript);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(html);
                            return;
                        }

                        let contentType = assetRes.headers['content-type'] || 'application/octet-stream';
                        if (cleanPath.endsWith('.js')) contentType = 'application/javascript';
                        else if (cleanPath.endsWith('.css')) contentType = 'text/css';
                        else if (cleanPath.endsWith('.wasm')) contentType = 'application/wasm';
                        else if (cleanPath.endsWith('.svg')) contentType = 'image/svg+xml';
                        else if (cleanPath.endsWith('.json')) contentType = 'application/json';

                        if (req.method === 'GET' && assetRes.status === 200) {
                            this.assetCache.set(targetUrl, { type: contentType, data: assetRes.arrayBuffer });
                        }

                        res.writeHead(assetRes.status || 200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
                        res.end(Buffer.from(assetRes.arrayBuffer));
                    } catch (e: any) {
                        if (cleanPath === '/index.html') {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`<div style="color:red; font-family: sans-serif; padding: 20px;">
                                <h2>Failed to load Ketcher Online</h2>
                                <p>Ensure you have an internet connection, or install the Offline Mode files.</p>
                                <p><i>Error: ${e.message || "404 Not Found"}</i></p>
                            </div>`);
                        } else {
                            res.writeHead(e.status || 404, { 'Access-Control-Allow-Origin': '*' });
                            res.end();
                        }
                    }
                });
            } catch (e: any) {
                res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
                res.end();
            }
        });

        this.server.listen(0, '127.0.0.1', () => {
            this.port = (this.server?.address() as any).port;
            this.setupHeadlessRenderer();
        });
    }
}

class ChemFileView extends TextFileView {
    plugin: ChemEditPlugin;
    
    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return "chem-file-view"; }
    getDisplayText() { return this.file ? this.file.name : "Molecule View"; }
    getIcon() { return "hexagon"; }
    getViewData() { return this.data; }

    async setViewData(data: string, clear: boolean) {
        this.data = data;
        const container = this.contentEl;
        container.empty();

        const wrapper = container.createDiv();
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.justifyContent = "center";
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
        wrapper.style.cursor = "pointer";
        wrapper.title = "Double-click to edit";
        wrapper.innerHTML = `<div class="color-text-muted">Loading preview...</div>`;

        const format = this.file?.extension === 'cdxml' ? 'cdxml' : 'mol';
        const previewEl = await this.plugin.renderMoleculeToPreview(data, format);
        
        wrapper.empty();
        if (previewEl) {
            wrapper.appendChild(previewEl);
        } else {
            wrapper.innerHTML = `<div class="color-text-muted">Error. Double-click to open editor.</div>`;
        }

        wrapper.ondblclick = () => {
            new KetcherModal(this.plugin, this.data, format, async (newData) => {
                this.data = newData;
                this.requestSave(); 
                this.setViewData(newData, false); 
            }).open();
        };
    }

    clear() {
        this.data = "";
        this.contentEl.empty();
    }
}

class KetcherModal extends Modal {
    plugin: ChemEditPlugin;
    initialData: string;
    format: string;
    onSave: (data: string) => void;
    messageListener: (event: MessageEvent) => void;

    constructor(plugin: ChemEditPlugin, initialData: string, format: string, onSave: (data: string) => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.initialData = initialData;
        this.format = format;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        this.modalEl.style.width = "85vw";
        this.modalEl.style.height = "85vh";

        const iframe = document.createElement("iframe");
        iframe.src = `http://127.0.0.1:${this.plugin.port}/?t=${Date.now()}`;
        iframe.style.width = "100%";
        iframe.style.height = "calc(100% - 50px)";
        iframe.style.border = "none";
        iframe.style.backgroundColor = "white"; 
        contentEl.appendChild(iframe);

        iframe.onload = () => {
            if (this.initialData && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'setMolecule', data: this.initialData }, '*');
            }
        };

        this.messageListener = (event: MessageEvent) => {
            if (event.data && event.data.type === 'saveMolecule') {
                this.onSave(event.data.data);
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
                iframe.contentWindow.postMessage({ type: 'getMolecule', format: this.format }, '*');
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

        const ketcherDir = this.plugin.getKetcherDir();
        const isOffline = fs.existsSync(path.join(ketcherDir, 'index.html'));

        containerEl.createEl('h3', { text: 'Offline Mode Status' });
        const statusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        
        if (isOffline) {
            statusEl.innerHTML = `<span style="color:var(--text-success); font-size:1.2em">✅ <b>Offline Mode Active</b></span><br>Local Ketcher installation detected. Your molecules are rendering rapidly, entirely offline and securely!`;
        } else {
            statusEl.innerHTML = `<span style="color:var(--text-warning); font-size:1.2em">⚠️ <b>Online Mode</b></span><br>Ketcher is currently streaming from EPAM Servers.<br><br>
            <div style="background:var(--background-secondary); border:1px solid var(--background-modifier-border); padding: 15px; border-radius: 5px; margin-top: 10px; color: var(--text-normal)">
                <b>To enable lightning-fast Offline Mode:</b><br><br>
                1. Download <a href="https://github.com/epam/ketcher/releases/download/v2.28.0/ketcher-standalone-2.28.0.zip" target="_blank"><b>ketcher-standalone.zip</b></a>.<br>
                2. Extract the folder into your Obsidian Vault plugins folder so it looks like this:<br>
                <code style="display:block; margin: 10px 0; padding: 10px; background: var(--background-primary); border-radius: 4px;">.../.obsidian/plugins/chemedit/ketcher/index.html</code>
                <i>(Note: If it extracts as a folder named 'standalone', you can just drop that whole folder into the 'ketcher' folder. The plugin will auto-detect it!)</i><br><br>
                3. Restart Obsidian.
            </div>`;
        }
        
        containerEl.createEl('br');

        new Setting(containerEl)
            .setName('Image Width')
            .setDesc('Set the width of the rendered SMILES structure (in pixels)')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(this.plugin.settings.width.toString())
                .onChange(async (value) => {
                    this.plugin.settings.width = parseInt(value) || 300;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Height')
            .setDesc('Set the height of the rendered SMILES structure (in pixels)')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(this.plugin.settings.height.toString())
                .onChange(async (value) => {
                    this.plugin.settings.height = parseInt(value) || 300;
                    await this.plugin.saveSettings();
                }));

        const themeOptions = {
            'light': 'Light', 'dark': 'Dark', 'oldschool': 'Oldschool (B&W)',
            'solarized': 'Solarized Light', 'solarized-dark': 'Solarized Dark',
            'matrix': 'Matrix', 'cyberpunk': 'Cyberpunk'
        };

        new Setting(containerEl)
            .setName('Light Theme')
            .addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.lightTheme)
                .onChange(async (value) => {
                    this.plugin.settings.lightTheme = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Dark Theme')
            .addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.darkTheme)
                .onChange(async (value) => {
                    this.plugin.settings.darkTheme = value;
                    await this.plugin.saveSettings();
                }));
    }
}
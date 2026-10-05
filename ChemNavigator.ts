// ChemNavigator.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, requestUrl } from 'obsidian';
import type ChemEditPlugin from './main';
import { calculateMwOffline, getCompoundLibrary } from './SharedEln';
import { ChemDataEngine } from './ChemDataEngine';

export const CHEM_NAVIGATOR_VIEW_TYPE = "chem-navigator-view";

interface NavWidget {
    id: string;
    title: string;
    visible: boolean;
}

// These are the widgets specific to the "Context" tab
const DEFAULT_CONTEXT_LAYOUT: NavWidget[] = [
    { id: 'preview', title: '🖼️ Structure Preview', visible: true },
    { id: 'stock', title: '📦 Inventory & Library Check', visible: true },
    { id: 'properties', title: '📊 Properties & MW', visible: true },
    { id: 'actions', title: '⚡ Quick Actions', visible: true },
    { id: 'weblinks', title: '🌐 Web Search Links', visible: true },
    { id: 'network', title: '🕸️ Sequence Map', visible: true }
];

export class ChemNavigatorView extends ItemView {
    plugin: ChemEditPlugin;
    
    headerPanel: HTMLElement;
    tabBar: HTMLElement;
    settingsPanel: HTMLElement;
    contentArea: HTMLElement;
    
    widgets: Record<string, HTMLElement> = {};
    widgetContents: Record<string, HTMLElement> = {};
    
    activeTab: string = 'context';
    contextLayout: NavWidget[] = [];
    isSettingsOpen = false;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return CHEM_NAVIGATOR_VIEW_TYPE; }
    getDisplayText() { return "Chem Navigator"; }
    getIcon() { return "flask-conical"; }

    async onOpen() {
        this.loadLayout();

        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-navigator-view');
        container.style.padding = "0"; 
        container.style.display = "flex";
        container.style.flexDirection = "column";

        // 1. HEADER
        this.headerPanel = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); flex-shrink: 0; z-index: 2;" }});
        this.headerPanel.createEl("h3", { text: "🧪 Chem Navigator", attr: { style: "margin: 0; font-size: 15px; font-weight: 700; color: var(--text-normal);" }});
        
        const tools = this.headerPanel.createDiv({ attr: { style: "display: flex; gap: 5px;" }});
        const settingsBtn = tools.createEl("button", { attr: { title: "Configure Context Layout", style: "background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" }});
        setIcon(settingsBtn, "settings");
        settingsBtn.onclick = () => this.toggleSettings();

        const refreshBtn = tools.createEl("button", { attr: { title: "Refresh Data", style: "background: transparent; border: none; box-shadow: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" }});
        setIcon(refreshBtn, "refresh-cw");
        refreshBtn.onclick = () => this.renderActiveTab();

        // 2. TAB BAR
        this.tabBar = container.createDiv({ attr: { style: "display: flex; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); padding: 0 10px; flex-shrink: 0; z-index: 2;" }});
        
        // RESTORED ALL TABS
        const tabs = [
            { id: 'context', icon: 'microscope', tooltip: 'Active Context' },
            { id: 'projects', icon: 'folder-tree', tooltip: 'Projects Tree' },
            { id: 'library', icon: 'library', tooltip: 'Compound Library' },
            { id: 'inventory', icon: 'package', tooltip: 'Inventory' },
            { id: 'search', icon: 'search', tooltip: 'Vault Search' },
            { id: 'tools', icon: 'wrench', tooltip: 'Utilities' }
        ];

        tabs.forEach(t => {
            const btn = this.tabBar.createEl("button", { attr: { title: t.tooltip, style: `flex: 1; padding: 10px 0; background: transparent; border: none; border-bottom: 2px solid transparent; box-shadow: none; cursor: pointer; display: flex; justify-content: center; align-items: center; border-radius: 0; color: var(--text-muted); transition: 0.2s;` }});
            setIcon(btn, t.icon);
            btn.id = `nav-tab-${t.id}`;
            
            btn.onclick = () => {
                this.activeTab = t.id;
                this.updateTabStyles();
                this.renderActiveTab();
            };
        });

        // 3. SETTINGS DRAWER
        this.settingsPanel = container.createDiv({ attr: { style: "display: none; flex-direction: column; padding: 15px; background: var(--background-secondary-alt); border-bottom: 2px solid var(--interactive-accent); box-shadow: inset 0 2px 4px rgba(0,0,0,0.05); flex-shrink: 0; z-index: 1;" }});

        // 4. CONTENT AREA
        this.contentArea = container.createDiv({ attr: { style: "flex-grow: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; background: var(--background-primary);" }});

        this.updateTabStyles();
        
        // Initialize Context Widget DOMs
        this.contextLayout.forEach(w => {
            const card = document.createElement("div");
            Object.assign(card.style, { display: "flex", flexDirection: "column", background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" });
            const cardHeader = card.createDiv({ attr: { style: "font-weight: 700; color: var(--text-normal); font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px;" }});
            cardHeader.innerHTML = w.title;
            const content = card.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 8px;" }});
            this.widgets[w.id] = card;
            this.widgetContents[w.id] = content;
        });

        await this.renderActiveTab();
        this.registerEvent(this.app.workspace.on('file-open', () => { if (this.activeTab === 'context') this.renderActiveTab(); }));
    }

    // ========================================================================
    // LAYOUT & SETTINGS (Only applies to Context Tab)
    // ========================================================================
    private updateTabStyles() {
        Array.from(this.tabBar.children).forEach((child: any) => {
            child.style.borderBottomColor = 'transparent';
            child.style.color = 'var(--text-muted)';
        });
        const activeBtn = this.tabBar.querySelector(`#nav-tab-${this.activeTab}`) as HTMLElement;
        if (activeBtn) {
            activeBtn.style.borderBottomColor = 'var(--interactive-accent)';
            activeBtn.style.color = 'var(--interactive-accent)';
        }
        
        const settingsBtn = this.headerPanel.querySelector('button[title="Configure Context Layout"]') as HTMLElement;
        if (settingsBtn) settingsBtn.style.display = this.activeTab === 'context' ? 'flex' : 'none';
        
        if (this.activeTab !== 'context') {
            this.isSettingsOpen = false;
            this.settingsPanel.style.display = 'none';
        }
    }

    private loadLayout() {
        try {
            const saved = window.localStorage.getItem('chemedit-context-layout');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.contextLayout = DEFAULT_CONTEXT_LAYOUT.map(def => {
                    const found = parsed.find((p:any) => p.id === def.id);
                    return found ? { ...def, visible: found.visible } : def;
                });
                this.contextLayout.sort((a, b) => {
                    const idxA = parsed.findIndex((p:any) => p.id === a.id);
                    const idxB = parsed.findIndex((p:any) => p.id === b.id);
                    return (idxA > -1 ? idxA : 99) - (idxB > -1 ? idxB : 99);
                });
                return;
            }
        } catch(e) {}
        this.contextLayout = JSON.parse(JSON.stringify(DEFAULT_CONTEXT_LAYOUT));
    }

    private saveLayout() { window.localStorage.setItem('chemedit-context-layout', JSON.stringify(this.contextLayout)); }

    private applyLayout() {
        Object.values(this.widgets).forEach(w => w.remove());
        this.contextLayout.forEach((w) => {
            const el = this.widgets[w.id];
            if (el && w.visible) this.contentArea.appendChild(el);
        });
    }

    private toggleSettings() {
        this.isSettingsOpen = !this.isSettingsOpen;
        this.settingsPanel.style.display = this.isSettingsOpen ? "flex" : "none";
        if (this.isSettingsOpen) this.renderSettingsUI();
    }

    private renderSettingsUI() {
        this.settingsPanel.empty();
        const header = this.settingsPanel.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;" }});
        header.createEl("div", { text: "Context Panel Layout", attr: { style: "font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" }});
        
        const closeBtn = header.createEl("button", { attr: { style: "background: transparent; border: none; padding: 0; box-shadow: none; cursor: pointer; height: 16px;" }});
        setIcon(closeBtn, "x");
        closeBtn.onclick = () => this.toggleSettings();

        this.contextLayout.forEach((w, i) => {
            const row = this.settingsPanel.createDiv({ attr: { style: "display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; margin-bottom: 6px;" }});
            
            const left = row.createDiv({ attr: { style: "display: flex; align-items: center; gap: 8px;" }});
            const visBtn = left.createEl("button", { text: w.visible ? "👁️" : "🚫", attr: { title: "Toggle Visibility", style: "padding: 2px 4px; font-size: 12px; background: transparent; border: none; box-shadow: none;" }});
            visBtn.onclick = () => { w.visible = !w.visible; this.saveLayout(); this.renderSettingsUI(); if (this.activeTab === 'context') this.applyLayout(); };
            left.createSpan({ text: w.title, attr: { style: `font-size: 12px; font-weight: 500; ${!w.visible ? "color: var(--text-muted); text-decoration: line-through;" : "color: var(--text-normal);"}` }});

            const right = row.createDiv({ attr: { style: "display: flex; gap: 4px;" }});
            const upBtn = right.createEl("button", { text: "▲", attr: { style: "padding: 2px 6px; font-size: 10px; height: 20px;", disabled: i === 0 ? true : undefined }});
            upBtn.onclick = () => this.swapWidget(i, i - 1);
            
            const dnBtn = right.createEl("button", { text: "▼", attr: { style: "padding: 2px 6px; font-size: 10px; height: 20px;", disabled: i === this.contextLayout.length - 1 ? true : undefined }});
            dnBtn.onclick = () => this.swapWidget(i, i + 1);
        });
    }

    private swapWidget(idx1: number, idx2: number) {
        const temp = this.contextLayout[idx1];
        this.contextLayout[idx1] = this.contextLayout[idx2];
        this.contextLayout[idx2] = temp;
        this.saveLayout();
        this.renderSettingsUI();
        if (this.activeTab === 'context') this.applyLayout();
    }

    // ========================================================================
    // TAB ROUTER
    // ========================================================================
    async renderActiveTab() {
        if (!['context', 'projects', 'library', 'inventory', 'search', 'tools'].includes(this.activeTab)) this.activeTab = 'context';

        if (this.activeTab !== 'context') {
            Object.values(this.widgets).forEach(w => w.remove());
            this.contentArea.empty();
        }

        if (this.activeTab === 'context') await this.renderContextTab();
        else if (this.activeTab === 'projects') await this.renderProjectsTab();
        else if (this.activeTab === 'library') await this.renderLibraryTab();
        else if (this.activeTab === 'inventory') await this.renderInventoryTab();
        else if (this.activeTab === 'search') await this.renderSearchTab();
        else if (this.activeTab === 'tools') await this.renderToolsTab();
    }

    // ========================================================================
    // 1. CONTEXT TAB
    // ========================================================================
    private async renderContextTab() {
        this.applyLayout(); 
        const file = this.app.workspace.getActiveFile();
        
        Object.values(this.widgetContents).forEach(w => w.empty());
        
        if (!file || file.extension !== 'md') {
            this.widgetContents['preview'].innerHTML = `<div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 12px; font-style: italic;">Open a chemical note to load context.</div>`;
            return;
        }

        const chemData = await this.extractChemistryFromNote(file);

        if (!chemData || chemData.smilesList.length === 0) {
            this.widgetContents['preview'].innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 12px; font-style: italic; display:flex; align-items:center; gap:6px; border: 1px dashed var(--background-modifier-border); border-radius: 8px;"><span style="color:var(--text-accent);">📄</span> ${file.basename} (No chemistry)</div>`;
            return;
        }

        const targetSmiles = chemData.smilesList[0];
        const isEln = chemData.type === 'eln';

        // 🖼️ WIDGET: PREVIEW
        if (this.widgetContents['preview']) {
            this.widgetContents['preview'].createDiv({ text: `🔬 ${chemData.name}`, attr: { style: "font-size: 13px; font-weight: bold; color: var(--text-accent); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" }});
            const previewWrapper = this.widgetContents['preview'].createDiv({ attr: { style: "width: 100%; height: 160px; background: var(--background-primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--background-modifier-border); box-shadow: inset 0 0 5px rgba(0,0,0,0.02);" }});
            previewWrapper.innerHTML = `⏳`;
            requestAnimationFrame(async () => {
                const renderEl = await this.plugin.api.renderStructure(targetSmiles, 240, 150);
                previewWrapper.empty();
                if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; previewWrapper.appendChild(renderEl); } else previewWrapper.innerHTML = `❌`;
            });
        }

        // 📦 WIDGET: STOCK & LIBRARY CHECK (OPTIMIZED)
        if (this.widgetContents['stock']) {
            const body = this.widgetContents['stock'];
            const checkBtn = body.createEl("button", { text: "🔍 Check Inventory & Library", attr: { style: "width: 100%; font-size: 11px; padding: 4px; height: 26px;" }});
            
            checkBtn.onclick = async () => {
                body.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">Checking inventory... ⏳</span>`;
                
                setTimeout(async () => {
                    const invFiles = this.getInventoryFiles();
                    let foundInInv = null;
                    
                    for (const f of invFiles) {
                        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                        if (fm && fm.smiles === targetSmiles) {
                            foundInInv = { file: f, loc: fm.location || "Unknown", amt: fm.amount || "-" };
                            break;
                        }
                    }

                    const lib = await getCompoundLibrary(this.plugin);
                    const foundInLib = lib.find(c => c.smiles === targetSmiles);

                    body.empty();
                    if (foundInInv) {
                        body.createDiv({ innerHTML: `✅ <b>In Inventory</b>`, attr: { style: "font-size:12px; color:var(--text-success); margin-bottom:4px;" }});
                        body.createDiv({ text: `📍 ${foundInInv.loc} | ⚖️ ${foundInInv.amt}`, attr: { style: "font-size:11px; color:var(--text-normal); cursor:pointer;", title: "Click to open" }}).onclick = () => this.app.workspace.getLeaf(false).openFile(foundInInv.file);
                    } else {
                        body.createDiv({ innerHTML: `❌ <b>Not in Inventory</b>`, attr: { style: "font-size:12px; color:var(--text-muted); margin-bottom:4px;" }});
                    }

                    if (foundInLib) {
                        body.createDiv({ innerHTML: `📚 <b>In Library</b> (${foundInLib.name})`, attr: { style: "font-size:12px; color:var(--text-accent); margin-top:6px;" }});
                    } else {
                        const addBtn = body.createEl("button", { text: "+ Add to Library", attr: { style: "margin-top:6px; font-size:10px; height:22px; width:max-content;" }});
                        addBtn.onclick = () => {
                            this.plugin.api.library.addCompound(chemData.name, targetSmiles);
                        };
                    }
                }, 10);
            };
        }

        // 📊 WIDGET: PROPERTIES
        if (this.widgetContents['properties']) {
            const body = this.widgetContents['properties'];
            const renderPropBox = async (title: string, smiles: string) => {
                if (!smiles) return;
                const box = body.createDiv({ attr: { style: "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 8px 12px; font-size: 11px; margin-bottom: 4px;" }});
                
                const props = ChemDataEngine.getPropertiesFromSmiles(smiles.split(' |')[0].trim());
                const mwProps = await calculateMwOffline(smiles, this.plugin);

                box.innerHTML = `
                    <div style="font-weight: 700; color: var(--text-accent); margin-bottom: 6px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 4px; display: flex; justify-content: space-between;">
                        <span>${title}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color: var(--text-muted);">Formula:</span><span style="font-weight: 600; color: var(--text-normal);">${mwProps.formula}</span></div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color: var(--text-muted);">Exact Mass:</span><span style="font-weight: 600; color: var(--text-normal);">${mwProps.mw.toFixed(2)}</span></div>
                `;

                if (props && props.logp) {
                    box.innerHTML += `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color: var(--text-muted);">LogP:</span><span style="font-weight: 600; color: var(--text-normal);">${props.logp.toFixed(2)}</span></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color: var(--text-muted);">TPSA:</span><span style="font-weight: 600; color: var(--text-normal);">${props.tpsa.toFixed(2)}</span></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span style="color: var(--text-muted);">H-Bond (D/A):</span><span style="font-weight: 600; color: var(--text-normal);">${props.hbd} / ${props.hba}</span></div>
                    `;
                    if (props.alerts && props.alerts !== "None") {
                        box.innerHTML += `<div style="margin-top: 6px; padding: 4px; background: #fde0df; border: 1px solid #f40724; border-radius: 4px; color: #f40724; font-weight: bold; text-align: center;">⚠️ ${props.alerts}</div>`;
                    }
                }
            };
            if (isEln && chemData.data?.reactants?.[0]?.smiles) await renderPropBox("Ref. Reactant", chemData.data.reactants[0].smiles);
            if (targetSmiles) await renderPropBox(isEln ? "Ref. Product" : "Structure Info", targetSmiles);
        }

        // ⚡ WIDGET: ACTIONS
        if (this.widgetContents['actions']) {
            const body = this.widgetContents['actions'];
            const actionGrid = body.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 8px;" }});
            const makeBtn = (text: string, onClick: () => void, fullWidth = false) => {
                const b = actionGrid.createEl("button", { text, attr: { style: `font-size: 11px; padding: 4px; height: 26px; border-radius: 4px; ${fullWidth ? 'grid-column: span 2;' : ''}` }});
                b.onclick = onClick;
            };
            makeBtn("📋 Copy SMILES", () => { navigator.clipboard.writeText(targetSmiles); new Notice("Copied!"); });
            makeBtn("✏️ Edit Structure", () => {
                this.plugin.api.ketcher.openEditor(targetSmiles, "smiles", async (newData: string) => {
                    const fileContent = await this.app.vault.read(file);
                    const newContent = fileContent.replace(targetSmiles, newData);
                    await this.app.vault.modify(file, newContent);
                    this.renderActiveTab();
                });
            });
            
            const findBtn = actionGrid.createEl("button", { text: "🔍 Find in Vault", attr: { style: "grid-column: span 2; font-size: 11px; padding: 4px; height: 26px; border-radius: 4px; background: var(--interactive-accent); color: var(--text-on-accent); border: none;" }});
            findBtn.onclick = () => {
                const searchPlugin = (this.app as any).internalPlugins?.getPluginById('global-search');
                if (searchPlugin && searchPlugin.instance) searchPlugin.instance.openGlobalSearch(`"${targetSmiles}"`);
            };
        }

        // 🌐 WIDGET: WEBLINKS
        if (this.widgetContents['weblinks']) {
            const body = this.widgetContents['weblinks'];
            const webGrid = body.createDiv({ attr: { style: "display: flex; gap: 10px; flex-wrap: wrap; background: var(--background-secondary-alt); padding: 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" }});
            const makeWebLink = (text: string, urlTemplate: string) => {
                if (!urlTemplate) return;
                const a = webGrid.createEl("a", { text, href: "#", attr: { style: "font-size: 11px; font-weight: 500; color: var(--text-accent); text-decoration: none;" }});
                a.onmouseover = () => a.style.textDecoration = 'underline';
                a.onmouseout = () => a.style.textDecoration = 'none';
                a.onclick = (e) => { e.preventDefault(); window.open(urlTemplate.replace(/\{\{smiles\}\}/gi, encodeURIComponent(targetSmiles)), '_blank'); };
            };
            makeWebLink("PubChem", this.plugin.settings.contextUrl1);
            makeWebLink("MolPort", this.plugin.settings.contextUrl2);
            makeWebLink("NMRium", this.plugin.settings.contextUrl3);
        }

        // 🕸️ WIDGET: NETWORK (AUTO-RUN WITH THREAD YIELDING)
        if (this.widgetContents['network']) {
            const body = this.widgetContents['network'];
            if (isEln && chemData.data) {
                body.innerHTML = `<div style="font-size: 11px; color: var(--text-muted); text-align: center;">Scanning pathway... ⏳</div>`;
                
                // Track the current file to prevent race conditions if user clicks away fast
                const currentFilePath = file.path;
                
                // Yield thread to let the rest of Obsidian UI update instantly
                setTimeout(async () => {
                    // Abort if user clicked another file while we were waiting
                    if (this.app.workspace.getActiveFile()?.path !== currentFilePath) return;
                    
                    try {
                        const connections = await this.buildFullSequence(file, chemData.data);
                        
                        // Abort if user clicked away during the async parse
                        if (this.app.workspace.getActiveFile()?.path !== currentFilePath) return;
                        
                        this.renderVerticalSequenceMap(body, connections.sequence, connections.samestep, file, chemData.data);
                    } catch (e) {
                        if (this.app.workspace.getActiveFile()?.path === currentFilePath) {
                            body.innerHTML = `<div style="text-align: center; color: var(--text-error); font-size: 11px;">Error scanning map.</div>`;
                        }
                    }
                }, 150); 
            } else {
                body.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 11px; font-style: italic;">Requires an ELN experiment block.</div>`;
            }
        }
    }

    // ========================================================================
    // FAST SEQUENCE ENGINE (Fortified & Directory Constrained)
    // ========================================================================
    
    // OPTIMIZED: Only checks files inside the ELN directory, or falls back to fast cache check
    private getElnFiles(): TFile[] {
        const elnDir = this.plugin.settings.elnDirectory;
        return this.app.vault.getMarkdownFiles().filter(f => {
            if (elnDir && !f.path.startsWith(elnDir)) return false;
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache) return false;
            
            const fmTags = cache.frontmatter?.tags || [];
            const hasFmTag = Array.isArray(fmTags) ? fmTags.includes('experiment') : fmTags === 'experiment';
            const hasInlineTag = cache.tags?.some(t => t.tag.toLowerCase().includes('experiment'));
            return hasFmTag || hasInlineTag || (elnDir && f.path.startsWith(elnDir));
        });
    }

    // OPTIMIZED: Only checks frontmatter cache, NO file reads!
    private getInventoryFiles(): TFile[] {
        return this.app.vault.getMarkdownFiles().filter(f => {
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache) return false;
            const fmTags = cache.frontmatter?.tags || [];
            const hasFmTag = Array.isArray(fmTags) ? fmTags.includes('inventory') : fmTags === 'inventory';
            const hasInlineTag = cache.tags?.some(t => t.tag.toLowerCase().includes('inventory'));
            const inFolder = f.path.toLowerCase().includes('/inventory/') || f.path.toLowerCase().startsWith('inventory/');
            return hasFmTag || hasInlineTag || inFolder;
        });
    }

    async buildFullSequence(currentFile: TFile, currentExpData: any) {
        const files = this.getElnFiles();
        const allExp: any[] = [];
        const normalize = (s: string) => s?.split(' |')[0].trim() || "";
        const { parseYaml } = require('obsidian');

        for (const f of files) {
            // Fast skip the current file, we already have its data parsed
            if (f.path === currentFile.path) continue;

            const content = await this.app.vault.cachedRead(f);
            const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            if (!elnMatch) continue;

            try {
                // Ultra-lightweight string cleaning before parsing
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m:any, p1:string) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                
                const data = parseYaml(safeSource);
                const limitingR = normalize(data.reactants?.find((r:any)=>r.is_limiting)?.smiles || data.reactants?.[0]?.smiles);
                const mainP = normalize(data.products?.[0]?.smiles);
                
                if (limitingR || mainP) {
                    allExp.push({ 
                        file: f, 
                        code: data.code || f.basename, 
                        rSmi: limitingR, 
                        pSmi: mainP, 
                        yieldNum: parseFloat(data.products?.[0]?.yield) || 0, 
                        yieldStr: data.products?.[0]?.yield ? `${data.products[0].yield}%` : '-' 
                    });
                }
            } catch(e) {}
        }

        // Add current file to the pool
        const rSmi = normalize(currentExpData?.reactants?.find((r:any)=>r.is_limiting)?.smiles || currentExpData?.reactants?.[0]?.smiles);
        const pSmi = normalize(currentExpData?.products?.[0]?.smiles);
        const currentExp = { 
            file: currentFile, 
            code: currentExpData?.code || currentFile.basename, 
            rSmi, 
            pSmi, 
            yieldStr: currentExpData?.products?.[0]?.yield ? `${currentExpData.products[0].yield}%` : '-', 
            yieldNum: parseFloat(currentExpData?.products?.[0]?.yield) || 0 
        };
        allExp.push(currentExp);

        const upstream: any[] = []; let curr = currentExp;
        while (curr && curr.rSmi) {
            const parents = allExp.filter(e => e.pSmi === curr.rSmi && e.file.path !== curr.file.path);
            if (parents.length === 0) break;
            parents.sort((a,b) => b.yieldNum - a.yieldNum); 
            const bestParent = parents[0];
            if (upstream.find(e => e.file.path === bestParent.file.path)) break; 
            upstream.push(bestParent); curr = bestParent;
        }

        const downstream: any[] = []; curr = currentExp;
        while (curr && curr.pSmi) {
            const children = allExp.filter(e => e.rSmi === curr.pSmi && e.file.path !== curr.file.path);
            if (children.length === 0) break;
            children.sort((a,b) => b.yieldNum - a.yieldNum); 
            const bestChild = children[0];
            if (downstream.find(e => e.file.path === bestChild.file.path)) break;
            downstream.push(bestChild); curr = bestChild;
        }

        const sequence = [...upstream.reverse(), currentExp, ...downstream];
        const samestep = allExp.filter(e => e.rSmi === currentExp.rSmi && e.pSmi === currentExp.pSmi && e.file.path !== currentFile.path);
        samestep.sort((a,b) => b.yieldNum - a.yieldNum);

        return { sequence, samestep };
    }

    private renderVerticalSequenceMap(container: HTMLElement, sequence: any[], samestep: any[], currentFile: TFile, currentExpData: any) {
        container.empty();
        container.createDiv({ text: `${sequence.length} Step Sequence`, attr: { style: "font-size: 11px; font-weight: bold; color: var(--text-muted); text-align: center; margin-bottom: 10px;" }});

        const mapWrapper = container.createDiv({ attr: { style: "display: flex; flex-direction: column; align-items: center; width: 100%;" }});
        const drawArrowDown = (parent: HTMLElement) => {
            const arr = parent.createDiv({ attr: { style: "display: flex; flex-direction: column; align-items: center; margin: 2px 0;" }});
            arr.createDiv({ attr: { style: "height: 15px; width: 2px; background: var(--background-modifier-border);" }});
            arr.createDiv({ attr: { style: "width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid var(--background-modifier-border);" }});
        };

        if (sequence.length === 1 && sequence[0].file.path === currentFile.path) {
            const reactantSmi = currentExpData.reactants?.find((r:any)=>r.is_limiting)?.smiles || currentExpData.reactants?.[0]?.smiles;
            if (reactantSmi) {
                const rNode = mapWrapper.createDiv({ attr: { style: `width: 110px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 5px; display: flex; flex-direction: column; align-items: center;` }});
                rNode.createDiv({ text: "Starting Material", attr: { style: "font-size: 9px; font-weight: bold; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: center;" }});
                const rPrev = rNode.createDiv({ attr: { style: "width: 90px; height: 60px; display: flex; align-items: center; justify-content: center; background: var(--background-secondary); border-radius: 4px;" }});
                rPrev.innerHTML = `⏳`;
                requestAnimationFrame(async () => {
                    const rEl = await this.plugin.api.renderStructure(reactantSmi, 90, 60);
                    rPrev.empty();
                    if (rEl) { rEl.style.maxWidth='100%'; rEl.style.maxHeight='100%'; rPrev.appendChild(rEl); } else rPrev.innerHTML = `❌`;
                });
                drawArrowDown(mapWrapper);
            }
        }

        sequence.forEach((exp, index) => {
            const isActive = exp.file.path === currentFile.path;
            const borderColor = isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)";
            const bgColor = isActive ? "var(--background-primary-alt)" : "var(--background-primary)";
            const shadow = isActive ? "0 4px 12px rgba(22, 119, 130, 0.15)" : "0 1px 3px rgba(0,0,0,0.02)";

            const node = mapWrapper.createDiv({ attr: { style: `width: 140px; background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.2s; box-shadow: ${shadow};` }});
            const nHeader = node.createDiv({ attr: { style: "display: flex; justify-content: space-between; width: 100%; margin-bottom: 6px; align-items: center;" }});
            
            if (isActive) { nHeader.createDiv({ text: `Step ${index + 1} (Current)`, attr: { style: "font-size: 9px; font-weight: bold; color: var(--interactive-accent); text-transform: uppercase;" }}); } 
            else { nHeader.createDiv({ text: `Step ${index + 1}`, attr: { style: "font-size: 9px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" }}); }

            const subHeader = node.createDiv({ attr: { style: "display: flex; justify-content: space-between; width: 100%; margin-bottom: 4px;" }});
            subHeader.createDiv({ text: exp.code, attr: { style: `font-size: 11px; font-weight: bold; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` }});
            if (exp.yieldStr && exp.yieldStr !== '-') subHeader.createDiv({ text: exp.yieldStr, attr: { style: "font-size: 10px; font-weight: bold; color: var(--text-success);" }});

            const preview = node.createDiv({ attr: { style: "width: 120px; height: 80px; display: flex; align-items: center; justify-content: center; background: var(--background-secondary); border-radius: 4px; border: 1px solid var(--background-modifier-border);" }});
            preview.innerHTML = `⏳`;

            requestAnimationFrame(async () => {
                const renderEl = await this.plugin.api.renderStructure(exp.pSmi, 120, 80);
                preview.empty();
                if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; preview.appendChild(renderEl); } else preview.innerHTML = `❌`;
            });

            node.onmouseover = () => node.style.transform = "scale(1.03)";
            node.onmouseout = () => node.style.transform = "scale(1)";
            node.onclick = () => { if (!isActive) this.app.workspace.getLeaf(false).openFile(exp.file); };

            if (index < sequence.length - 1) drawArrowDown(mapWrapper);
        });

        if (samestep.length > 0) {
            container.createDiv({ attr: { style: "margin-top: 25px; border-top: 1px dashed var(--background-modifier-border); padding-top: 15px; font-size: 11px; color: var(--text-muted); font-weight: bold;" }}).innerText = `🔄 Optimization Variants (${samestep.length})`;
            const variantList = container.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 4px; margin-top: 8px;" }});
            samestep.forEach((item: any) => {
                const row = variantList.createDiv({ attr: { style: "display: flex; justify-content: space-between; padding: 6px 10px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer; transition: 0.2s; font-size: 11px;" }});
                row.createEl("span", { text: item.code, attr: { style: "font-weight: 600; color: var(--text-normal);" }});
                row.createEl("span", { text: item.yieldStr, attr: { style: "font-weight: bold; color: var(--text-success);" }});
                row.onmouseover = () => { row.style.borderColor = "var(--interactive-accent)"; row.style.transform = "translateX(2px)"; };
                row.onmouseout = () => { row.style.borderColor = "var(--background-modifier-border)"; row.style.transform = "translateX(0)"; };
                row.onclick = () => this.app.workspace.getLeaf(false).openFile(item.file);
            });
        }
    }

    // ========================================================================
    // TAB: PROJECTS (Optimized for Directory)
    // ========================================================================
    private async renderProjectsTab() {
        const treeContainer = this.contentArea.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 10px; overflow-y: auto;" }});

        const files = this.getElnFiles();
        const projects = new Map<string, TFile[]>();

        for (const file of files) {
            let projName = "Unassigned";
            const fileContent = await this.app.vault.cachedRead(file);
            const pMatch = fileContent.match(/project:\s*(.+)/);
            if (pMatch && pMatch[1].trim()) projName = pMatch[1].trim();

            if (!projects.has(projName)) projects.set(projName, []);
            projects.get(projName)!.push(file);
        }

        if (projects.size === 0) {
            treeContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; font-style: italic; padding: 20px; border: 1px dashed var(--background-modifier-border); border-radius: 8px; text-align: center;">No ELN experiments found in your ELN Directory setting.</div>`;
            return;
        }

        const sortedProjects = Array.from(projects.keys()).sort((a,b) => a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b));

        for (const proj of sortedProjects) {
            const expList = projects.get(proj)!;
            const projWrapper = treeContainer.createDiv({ attr: { style: "border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02);" }});
            
            const projHeader = projWrapper.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--background-secondary); cursor: pointer;" }});
            projHeader.createDiv({ text: `📁 ${proj}`, attr: { style: "font-size: 13px; font-weight: bold; color: var(--text-normal);" }});
            
            const projTools = projHeader.createDiv({ attr: { style: "display: flex; gap: 5px;" }});
            const mapBtn = projTools.createEl("button", { text: "🗺️ Map", attr: { title: "Generate Synthesis Map", style: "padding: 2px 6px; height: 20px; font-size: 10px; background: transparent; border: 1px solid var(--background-modifier-border); box-shadow: none;" }});
            
            const listContainer = projWrapper.createDiv({ attr: { style: "display: none; flex-direction: column; padding: 5px; border-top: 1px solid var(--background-modifier-border);" }});
            
            projHeader.onclick = (e) => {
                if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
                listContainer.style.display = listContainer.style.display === 'none' ? 'flex' : 'none';
            };

            mapBtn.onclick = async () => {
                const safeName = proj === "Unassigned" ? "All" : proj.replace(/[\\/:"*?<>|]/g, '_');
                const filePath = `${this.plugin.settings.elnDirectory || ''}/${safeName}_Dashboard.md`.replace(/^\//, '');
                
                if (this.app.vault.getAbstractFileByPath(filePath)) {
                    new Notice(`Dashboard already exists at ${filePath}`);
                    this.app.workspace.getLeaf(false).openFile(this.app.vault.getAbstractFileByPath(filePath) as TFile);
                    return;
                }
                const content = `---\ntags: [dashboard]\n---\n# ${proj} - Synthesis Dashboard\n\n\`\`\`synthesis-map\npath: ${this.plugin.settings.elnDirectory || ''}\nproject: ${proj === "Unassigned" ? "" : proj}\n\`\`\`\n`;
                const newFile = await this.app.vault.create(filePath, content);
                this.app.workspace.getLeaf(false).openFile(newFile);
            };

            expList.sort((a,b) => a.basename.localeCompare(b.basename)).forEach(f => {
                const item = listContainer.createDiv({ text: `📄 ${f.basename}`, attr: { style: "padding: 4px 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; border-radius: 4px;" }});
                item.onmouseover = () => item.style.backgroundColor = "var(--background-modifier-hover)";
                item.onmouseout = () => item.style.backgroundColor = "transparent";
                item.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
            });
        }
    }

    // ========================================================================
    // TAB: LIBRARY (Optimized Single File Read)
    // ========================================================================
    private async renderLibraryTab() {
        const header = this.contentArea.createDiv({ attr: { style: "display:flex; flex-direction:column; gap:10px; margin-bottom: 10px;" }});
        
        const topActions = header.createDiv({ attr: { style: "display:flex; justify-content:space-between; align-items:center;" }});
        topActions.createEl("span", { text: "Search or Edit Library:", attr: { style: "font-size: 11px; color: var(--text-muted); font-weight:bold;" }});
        const editLibBtn = topActions.createEl("button", { text: "📝 Edit File", attr: { style: "font-size: 11px; padding: 4px 8px; border-radius: 4px; height:24px;" }});
        editLibBtn.onclick = () => {
            const libPath = this.plugin.settings?.libraryFilePath;
            if (!libPath) { new Notice("Library file path not set in settings."); return; }
            const file = this.app.vault.getAbstractFileByPath(libPath);
            if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
            else new Notice("Library file not found.");
        };

        const searchInp = header.createEl("input", { type: "search", placeholder: "Search reagents...", attr: { style: "width: 100%; font-size: 12px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" }});
        
        const grid = this.contentArea.createDiv({ attr: { style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 15px; padding-bottom: 20px;" }});
        grid.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; grid-column: 1/-1;">Loading...</div>`;
        
        const lib = await getCompoundLibrary(this.plugin);
        grid.empty();
        const cards: { el: HTMLElement, text: string }[] = [];

        lib.forEach(c => {
            const card = grid.createDiv({ attr: { style: "background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: transform 0.2s, border-color 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.02); position: relative;" }});
            
            const trashBtn = card.createEl("button", { text: "🗑️", attr: { title: "Remove from Library", style: "position: absolute; top: 4px; right: 4px; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 2px 4px; font-size: 10px; display: none;" }});
            
            card.onmouseover = () => { card.style.borderColor = "var(--interactive-accent)"; card.style.transform = "translateY(-2px)"; trashBtn.style.display = "block"; };
            card.onmouseout = () => { card.style.borderColor = "var(--background-modifier-border)"; card.style.transform = "translateY(0)"; trashBtn.style.display = "none"; };
            
            trashBtn.onclick = async (e) => {
                e.stopPropagation();
                const path = this.plugin.settings?.libraryFilePath;
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const lines = content.split('\n');
                    const newLines = lines.filter(l => !(l.includes(c.smiles) && l.includes(c.name)));
                    await this.app.vault.modify(file, newLines.join('\n'));
                    new Notice(`Removed ${c.name}`);
                    this.renderActiveTab();
                }
            };

            const preview = card.createDiv({ attr: { style: "width: 100px; height: 80px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border-radius: 4px;" }});
            preview.innerHTML = "⏳";
            
            requestAnimationFrame(async () => {
                const el = await this.plugin.api.renderStructure(c.smiles, 100, 80);
                preview.empty();
                if(el) { el.style.maxWidth='100%'; el.style.maxHeight='100%'; preview.appendChild(el); } else preview.innerHTML = "❌";
            });

            card.createDiv({ text: c.name, attr: { title: c.name, style: "font-size: 11px; font-weight: 600; text-align: center; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; color: var(--text-normal);" }});
            card.onclick = () => { navigator.clipboard.writeText(c.smiles); new Notice(`Copied ${c.name} SMILES!`); };

            cards.push({ el: card, text: `${c.name} ${c.smiles}`.toLowerCase() });
        });

        if (cards.length === 0) grid.innerHTML = `<span style="color:var(--text-muted); font-size:12px; font-style:italic; grid-column: 1/-1; text-align:center;">Library empty.</span>`;

        searchInp.addEventListener('input', (e: any) => {
            const query = e.target.value.toLowerCase();
            cards.forEach(c => { c.el.style.display = c.text.includes(query) ? "flex" : "none"; });
        });
    }

    // ========================================================================
    // TAB: INVENTORY (Optimized Memory Cache Only)
    // ========================================================================
    private async renderInventoryTab() {
        const header = this.contentArea.createDiv({ attr: { style: "display:flex; flex-direction:column; gap:10px; margin-bottom: 10px;" }});
        const searchInp = header.createEl("input", { type: "search", placeholder: "Search stock (name, location, CAS)...", attr: { style: "width: 100%; font-size: 12px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" }});
        
        const list = this.contentArea.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 8px;" }});
        const invFiles = this.getInventoryFiles();

        // Optimized rendering relies completely on frontmatter, NO cachedRead()
        const renderList = (query: string) => {
            list.empty();
            let count = 0;
            for (const f of invFiles) {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                const name = fm?.name || f.basename;
                const loc = fm?.location || "Unknown Location";
                const amt = fm?.amount || "-";
                const cas = fm?.cas || "";
                
                const searchStr = `${name} ${loc} ${cas}`.toLowerCase();
                if (query && !searchStr.includes(query)) continue;
                if (count > 100) break; // Limit rendering for speed
                count++;

                const item = list.createDiv({ attr: { style: "display: flex; flex-direction: column; padding: 10px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer; font-size: 11px; transition: 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.02);" }});
                item.onmouseover = () => item.style.borderColor = "var(--interactive-accent)";
                item.onmouseout = () => item.style.borderColor = "var(--background-modifier-border)";
                item.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
                
                item.createDiv({ text: name, attr: { style: "font-weight: 700; font-size: 13px; color: var(--text-accent); margin-bottom: 4px;" }});
                
                const metaRow = item.createDiv({ attr: { style: "display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);" }});
                metaRow.createSpan({ text: `📍 ${loc}` });
                metaRow.createSpan({ text: `⚖️ ${amt}`, attr: { style: "font-weight: bold; color: var(--text-normal);" }});
            }
            if (count === 0) list.innerHTML = `<span style="color:var(--text-muted); font-size:12px; font-style:italic;">No inventory found. Create notes inside an Inventory folder or add \`tags: [inventory]\`.</span>`;
        };

        searchInp.oninput = (e: any) => renderList(e.target.value.toLowerCase());
        renderList("");
    }

    // ========================================================================
    // TAB: SEARCH (Vault Text & Structure Search - FIX: ALL FILES)
    // ========================================================================
    private async renderSearchTab() {
        const header = this.contentArea.createDiv({ attr: { style: "display:flex; flex-direction:column; gap:10px; margin-bottom: 10px;" }});
        const textInp = header.createEl("input", { type: "search", placeholder: "Search the ENTIRE vault...", attr: { style: "width: 100%; font-size: 12px; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" }});
        
        // REPLACED SUBSTRUCTURE SEARCH WITH FULL-WIDTH EXACT MATCH
        const exactBtn = header.createEl("button", { text: "⬡ Structure Match (Entire Vault)", cls: "mod-cta", attr: { style: "width: 100%; height: 32px; font-size: 11px;" }});
        const resultsDiv = this.contentArea.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding-bottom: 20px;" }});

        const performSearch = async (mode: 'text'|'exact', query: string) => {
            resultsDiv.empty();
            resultsDiv.innerHTML = `<div style="text-align:center; font-size:12px; color: var(--text-accent); margin-top: 20px;">Scanning entire vault... ⏳<br><span style="font-size: 10px; color: var(--text-muted);">(Large vaults may take a few seconds)</span></div>`;
            
            // FIX: ALWAYS SEARCH ALL MARKDOWN FILES
            const files = this.app.vault.getMarkdownFiles();
            const matches: any[] = [];
            
            for (const f of files) {
                const chemData = await this.extractChemistryFromNote(f);
                if (!chemData) continue;

                let isMatch = false;

                if (mode === 'text') {
                    const searchStr = `${f.basename} ${chemData.name} ${chemData.smilesList.join(' ')}`.toLowerCase();
                    if (searchStr.includes(query.toLowerCase())) isMatch = true;
                } else if (mode === 'exact') {
                    const queryCanonical = this.plugin.api.data.molToSmiles(query) || query;
                    for (const s of chemData.smilesList) {
                         if (s.includes(query) || (this.plugin.api.data.molToSmiles(s) === queryCanonical && queryCanonical !== "")) {
                             isMatch = true; break;
                         }
                    }
                }

                if (isMatch) matches.push({ file: f, name: chemData.name, type: chemData.type });
            }

            resultsDiv.empty();
            if (matches.length === 0) {
                resultsDiv.innerHTML = `<div style="text-align:center; font-size:12px; color:var(--text-muted); margin-top: 20px;">No matches found.</div>`;
            } else {
                resultsDiv.createDiv({ text: `Found ${matches.length} matching notes:`, attr: { style: "font-size: 11px; font-weight: bold; color: var(--text-success); margin-bottom: 8px;" }});
                matches.forEach(m => {
                    const item = resultsDiv.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer; transition: 0.2s;" }});
                    item.createSpan({ text: m.name, attr: { style: "font-weight: 600; font-size: 12px; color: var(--text-normal); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width: 160px;" }});
                    
                    const badgeColor = m.type === 'eln' ? 'var(--text-accent)' : m.type === 'inventory' ? 'var(--text-warning)' : 'var(--text-muted)';
                    item.createSpan({ text: m.type.toUpperCase(), attr: { style: `color: ${badgeColor}; font-size: 9px; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-primary);` }});
                    
                    item.onmouseover = () => item.style.borderColor = "var(--interactive-accent)";
                    item.onmouseout = () => item.style.borderColor = "var(--background-modifier-border)";
                    item.onclick = () => this.app.workspace.getLeaf(false).openFile(m.file);
                });
            }
        };

        textInp.onkeydown = (e) => { if (e.key === 'Enter' && textInp.value.trim()) performSearch('text', textInp.value.trim()); };
        exactBtn.onclick = () => this.plugin.api.ketcher.openEditor("", "smiles", (q: string) => { if (q) performSearch('exact', q); });
    }

    // ========================================================================
    // TAB: TOOLS (Utilities)
    // ========================================================================
    private async renderToolsTab() {
        this.contentArea.createEl("h4", { text: "🛠️ Map Generators", attr: { style: "margin: 0 0 10px 0; font-size: 14px; color: var(--text-normal);" }});
        const mapBox = this.contentArea.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 8px; margin-bottom: 15px;" }});
        
        const genPlanBtn = mapBox.createEl("button", { text: "🎯 Create New Synthesis Plan", cls: "mod-cta", attr: { style: "width: 100%; height: 28px; font-size: 12px;" }});
        genPlanBtn.onclick = async () => {
            const file = await this.app.vault.create(`Synthesis Plan ${window.moment().format("HHmmss")}.md`, `---\ntags: [dashboard]\n---\n# New Synthesis Plan\n\n\`\`\`synthesis-plan\n\n\`\`\`\n`);
            this.app.workspace.getLeaf(false).openFile(file);
        };

        const genMapBtn = mapBox.createEl("button", { text: "🗺️ Create Folder Map Dashboard", attr: { style: "width: 100%; height: 28px; font-size: 12px;" }});
        genMapBtn.onclick = async () => {
            const folder = this.plugin.settings.elnDirectory || "";
            const file = await this.app.vault.create(`Synthesis Map ${window.moment().format("HHmmss")}.md`, `---\ntags: [dashboard]\n---\n# Synthesis Map\n\n\`\`\`synthesis-map\npath: ${folder}\n\`\`\`\n`);
            this.app.workspace.getLeaf(false).openFile(file);
        };

        this.contentArea.createEl("h4", { text: "🧮 Calculators", attr: { style: "margin: 10px 0; font-size: 14px; color: var(--text-normal);" }});

        // 1. Name to Structure Resolver
        const resolverBox = this.contentArea.createDiv({ attr: { style: "background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px; margin-bottom: 10px;" }});
        resolverBox.createDiv({ text: "Name to Structure (Web)", attr: { style: "font-weight: 700; font-size: 12px; margin-bottom: 8px; color: var(--text-accent);" }});
        const nameInp = resolverBox.createEl("input", { type: "text", placeholder: "e.g. Aspirin", attr: { style: "width: 100%; font-size: 12px; padding: 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border); margin-bottom: 8px;" }});
        const resolveBtn = resolverBox.createEl("button", { text: "Search", attr: { style: "width: 100%; height: 26px; font-size: 11px;" }});
        const resolveRes = resolverBox.createDiv({ attr: { style: "margin-top: 10px; display: none; flex-direction: column; gap: 6px;" }});
        
        resolveBtn.onclick = async () => {
            const name = nameInp.value.trim();
            if (!name) return;
            resolveBtn.innerText = "Searching...";
            try {
                let smi = "";
                const fetcher = async (url: string) => { const r = await requestUrl(url); return r.status === 200 ? r : null; };

                // 1. Try OPSIN (Fastest for IUPAC)
                try { const res = await fetcher(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(name)}.smi`); if(res) smi = res.text.trim(); } catch(e){}
                // 2. Try Cactus
                if (!smi) { try { const res = await fetcher(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/smiles`); if(res) smi = res.text.trim(); } catch(e){} }
                // 3. Try Pubchem
                if (!smi) { try { const res = await fetcher(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/IsomericSMILES/JSON`); if(res) smi = res.json.PropertyTable.Properties[0].IsomericSMILES; } catch(e){} }

                if (smi) {
                    resolveRes.style.display = "flex";
                    resolveRes.empty();
                    
                    const preview = resolveRes.createDiv({ attr: { style: "width: 100%; height: 120px; background: var(--background-primary); border-radius: 4px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 4px rgba(0,0,0,0.05);" }});
                    requestAnimationFrame(async () => {
                        const el = await this.plugin.api.renderStructure(smi, 200, 100);
                        if (el) { el.style.maxWidth='100%'; el.style.maxHeight='100%'; preview.appendChild(el); }
                    });

                    const btns = resolveRes.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
                    const cpyBtn = btns.createEl("button", { text: "📋 Copy SMILES", attr: { style: "flex: 1; height: 24px; font-size: 10px;" }});
                    cpyBtn.onclick = () => { navigator.clipboard.writeText(smi); new Notice("Copied!"); };
                    
                    const addBtn = btns.createEl("button", { text: "📚 Add to Lib", attr: { style: "flex: 1; height: 24px; font-size: 10px;" }});
                    addBtn.onclick = () => { this.plugin.api.library.addCompound(name, smi); };
                } else { new Notice("Not found."); }
            } catch(e) { new Notice("Search failed."); }
            resolveBtn.innerText = "Search";
        };

        nameInp.onkeydown = (e) => { if(e.key === 'Enter') resolveBtn.click(); };

        // 2. Offline Calculator
        const calcBox = this.contentArea.createDiv({ attr: { style: "background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px;" }});
        calcBox.createDiv({ text: "Quick Calculator (Offline)", attr: { style: "font-weight: 700; font-size: 12px; margin-bottom: 8px; color: var(--text-accent);" }});
        const smiInp = calcBox.createEl("input", { type: "text", placeholder: "Paste SMILES here...", attr: { style: "width: 100%; font-size: 12px; padding: 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border); margin-bottom: 8px;" }});
        const calcRes = calcBox.createDiv({ attr: { style: "font-size: 11px; color: var(--text-normal); display: flex; flex-direction: column; gap: 4px;" }});

        smiInp.oninput = async () => {
            const smi = smiInp.value.trim();
            calcRes.empty();
            if (!smi) return;
            
            calcRes.innerHTML = `<span style="color:var(--text-muted);">Calculating...</span>`;
            
            // Wait slightly for Ketcher Normalizer fallback to work
            const mwProps = await calculateMwOffline(smi, this.plugin);
            const oclProps = ChemDataEngine.getPropertiesFromSmiles(smi.split(' |')[0].trim());

            if (mwProps && mwProps.mw > 0) {
                calcRes.innerHTML = `
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted)">Formula:</span><b>${mwProps.formula}</b></div>
                    <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted)">Exact Mass:</span><b>${mwProps.mw.toFixed(3)}</b></div>
                    ${oclProps && oclProps.logp ? `
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted)">LogP:</span><b>${oclProps.logp.toFixed(2)}</b></div>
                        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted)">TPSA:</span><b>${oclProps.tpsa.toFixed(2)}</b></div>
                    ` : ''}
                `;
            } else { calcRes.innerHTML = `<span style="color:var(--text-error);">Invalid SMILES</span>`; }
        };
    }

    // ========================================================================
    // HELPER: EXTRACT CHEMISTRY
    // ========================================================================
    private async extractChemistryFromNote(file: TFile): Promise<{name: string, type: string, smilesList: string[], data?: any} | null> {
        const content = await this.app.vault.cachedRead(file);
        const smilesList: string[] = [];
        let name = file.basename;
        let type = 'note';
        let expData: any = null;

        const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
        if (elnMatch) {
            type = 'eln';
            try {
                const { parseYaml } = require('obsidian');
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m:any, p1:string) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                expData = parseYaml(safeSource);
                if (expData.code) name = expData.code;
                if (expData.reactants) expData.reactants.forEach((r:any) => { if(r.smiles) smilesList.push(r.smiles); });
                if (expData.products) expData.products.forEach((p:any) => { if(p.smiles) smilesList.push(p.smiles); });
            } catch(e) {}
        } else {
            const smiMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/g);
            if (smiMatch) {
                type = 'smiles';
                smiMatch.forEach(block => {
                    const s = block.replace(/```smiles|```/g, '').trim();
                    if (s) smilesList.push(s);
                });
            }
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.smiles) {
                type = cache.frontmatter.tags?.includes('inventory') ? 'inventory' : 'library';
                smilesList.push(cache.frontmatter.smiles);
            }
        }

        if (smilesList.length > 0) return { name, type, smilesList, data: expData };
        return null;
    }
}
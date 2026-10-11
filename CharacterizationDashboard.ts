// CharacterizationDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce, Menu, Modal, App } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const CHARACTERIZATION_DASHBOARD_VIEW_TYPE = "chem-characterization-dashboard";

interface CharEntry {
    file: TFile;
    name: string;
    smiles: string;
    metricsData: Record<string, any>; // Dynamically holds our tracking values
    score: number;
    timestamp: number;
    // For CSS-based filtering
    rowEl?: HTMLElement;
    searchText: string;
}

export class CharacterizationDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    tableBodyEl: HTMLElement;
    tableHeadTr: HTMLElement;
    
    allEntries: CharEntry[] = [];
    searchQuery: string = '';
    metricsList: string[] = []; // Stores the active user-defined metrics
    
    private observer: IntersectionObserver;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Lazy-loader for structures (Zero battery drain, only renders what is on screen)
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    const smiles = el.dataset.smiles;
                    if (smiles && !el.dataset.rendered) {
                        el.dataset.rendered = "true";
                        this.plugin.api.renderStructure(smiles, 120, 100).then(renderEl => {
                            el.empty();
                            if (renderEl) {
                                renderEl.style.maxWidth = '100%';
                                renderEl.style.maxHeight = '100%';
                                el.appendChild(renderEl);
                            } else {
                                el.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">Invalid</span>`;
                            }
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "150px", threshold: 0.1 });
    }

    getViewType() { return CHARACTERIZATION_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Compound Data Organizer"; }
    getIcon() { return "bar-chart-2"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-characterization-dashboard-view');
        
        Object.assign(container.style, { display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        renderLimsNav(titleArea, "data", this.plugin);

        titleArea.createEl("h2", { text: "Compound Data Organizer", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Track publication readiness and analytical spectra", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ Add Compound", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-char-dir') || "Characterization";
            this.createNewEntry(folder);
        };

        // --- TOOLBAR ---
        const toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center; flex-wrap: wrap;" }});
        
        // 1. Folder Setting
        const dirWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px;" }});
        dirWrap.createEl("span", { text: "📁 Folder:", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);" }});
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-char-dir') || "Characterization", attr: { style: "width: 120px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-char-dir', e.target.value.trim());
            this.loadData();
        };

        // 2. DYNAMIC METRICS SETTING
        const metricWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px;" }});
        metricWrap.createEl("span", { text: "⚙️ Metrics (YAML keys):", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);", title: "Comma separated list of data you want to track." }});
        const metricInp = metricWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-char-metrics') || "hnmr, cnmr, hrms, ir, mp", attr: { style: "width: 220px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        metricInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-char-metrics', e.target.value.trim());
            this.loadData();
        };

        const searchInp = toolbarEl.createEl("input", { type: "search", placeholder: "Search compound name...", attr: { style: "width: 220px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => { 
            this.searchQuery = e.target.value.toLowerCase(); 
            this.applyFilters(); // FAST CSS FILTER
        };

        // --- TABLE ---
        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: center; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        this.tableHeadTr = thead.createEl("tr");
        this.tableBodyEl = table.createEl("tbody");

        await this.loadData();

        // BATTERY-EFFICIENT AUTO-REFRESH
        const requestRefresh = debounce(() => this.loadData(), 2000, true);
        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private async createNewEntry(folder: string) {
        if (!await this.app.vault.adapter.exists(folder)) await this.app.vault.createFolder(folder);
        
        const name = "Compound_" + window.moment().format("HHmmss");
        
        // Dynamically insert the user's chosen metrics into the new file!
        let metricsYaml = "";
        this.metricsList.forEach(m => { metricsYaml += `${m}: false\n`; });

        const content = `---\ntags: [characterization]\nname: "${name}"\nsmiles: ""\n${metricsYaml}---\n# ${name}\n\n*Drop spectral data files (PDFs, MNova, images) into this folder and link them above!*\n`;
        const file = await this.app.vault.create(`${folder}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
    }

    private async loadData() {
        const targetDir = window.localStorage.getItem('chem-char-dir') || "Characterization";
        const metricsStr = window.localStorage.getItem('chem-char-metrics') || "hnmr, cnmr, hrms, ir, mp";
        
        // Parse the custom metrics
        this.metricsList = metricsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

        const files = this.app.vault.getMarkdownFiles();
        const entries: CharEntry[] = [];

        for (const file of files) {
            // 1. FAST RAM-ONLY PRE-FILTER
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const fmTags = fm.tags || [];
            const isTagged = Array.isArray(fmTags) ? (fmTags.includes('characterization') || fmTags.includes('compound')) : (fmTags === 'characterization' || fmTags === 'compound');

            if (!inFolder && !isTagged) continue;

            let smiles = fm.smiles || "";
            
            // Extract dynamically mapped data
            let collectedCount = 0;
            const metricsData: Record<string, any> = {};
            
            this.metricsList.forEach(m => {
                const val = fm[m];
                metricsData[m] = val;
                if (val && val !== 'false' && val !== false) collectedCount++;
            });

            // Calculate dynamic score
            const score = this.metricsList.length > 0 ? Math.round((collectedCount / this.metricsList.length) * 100) : 0;
            const name = fm.name || file.basename;

            entries.push({
                file, name, smiles, metricsData, score, timestamp: file.stat.mtime, searchText: name.toLowerCase()
            });
        }

        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.observer.disconnect();

        // 1. Rebuild Headers Dynamically
        this.tableHeadTr.empty();
        const formatHeader = (key: string) => {
            if (key === 'hnmr') return '1H NMR';
            if (key === 'cnmr') return '13C NMR';
            if (key === 'mp') return 'M.P.';
            return key.toUpperCase();
        };

        const staticCols = ["Structure", "Compound"];
        const dynamicCols = this.metricsList.map(formatHeader);
        const allCols = [...staticCols, ...dynamicCols, "Readiness"];

        allCols.forEach((c, i) => {
            this.tableHeadTr.createEl("th", { text: c, attr: { style: `padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; ${i < 2 ? 'text-align: left;' : ''}` }});
        });

        // 2. Rebuild Body using Anti-Blink DocumentFragment
        const fragment = document.createDocumentFragment();

        if (this.allEntries.length === 0) {
            const emptyTr = document.createElement("tr");
            emptyTr.innerHTML = `<td colspan="${allCols.length}" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No compounds found. Click '+ Add Compound' to start.</td>`;
            fragment.appendChild(emptyTr);
        } else {
            this.allEntries.forEach(e => {
                const tr = document.createElement("tr");
                tr.style.transition = "background 0.2s";
                e.rowEl = tr;
                tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
                tr.onmouseout = () => tr.style.backgroundColor = "transparent";

                // Structure
                const tdStruct = tr.createEl("td", { attr: { style: "padding: 10px; border-bottom: 1px solid var(--background-modifier-border-hover); text-align: left;" }});
                const structWrap = tdStruct.createDiv({ attr: { 'data-smiles': e.smiles, style: "width: 120px; height: 100px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer;" }});
                structWrap.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
                if (e.smiles) {
                    structWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">⏳</span>`;
                    this.observer.observe(structWrap);
                } else {
                    structWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">No Structure</span>`;
                }

                // Name
                const tdName = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); text-align: left;" }});
                tdName.createDiv({ text: e.name, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; cursor: pointer;" }}).onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
                
                // Dynamic Data Cells
                this.metricsList.forEach(m => {
                    this.createDataCell(tr, e.file, m, e.metricsData[m]);
                });

                // Progress
                const tdProg = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
                const pColor = e.score === 100 ? 'var(--text-success)' : e.score >= 60 ? 'var(--text-warning)' : 'var(--text-error)';
                tdProg.innerHTML = `<div style="font-size:11px; font-weight:bold; margin-bottom:4px; color:${pColor};">${e.score}%</div>
                                    <div style="width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden;">
                                        <div style="width: ${e.score}%; height: 100%; background: ${pColor}; transition: width 0.3s;"></div>
                                    </div>`;
                
                fragment.appendChild(tr);
            });
        }

        // Swap body instantly
        this.tableBodyEl.empty();
        this.tableBodyEl.appendChild(fragment);
    }

    private createDataCell(tr: HTMLElement, file: TFile, key: string, val: any) {
        const td = tr.createEl("td", { attr: { style: "padding: 10px; border-bottom: 1px solid var(--background-modifier-border-hover); vertical-align: middle;" }});
        
        const isDone = !!val && val !== 'false' && val !== false;
        const isLink = typeof val === 'string' && val.includes('[[');
        const displayStr = isLink ? '📄' : (isDone ? '✅' : '❌');
        const color = isDone ? (isLink ? 'var(--text-accent)' : 'var(--text-success)') : 'var(--text-faint)';

        const btn = td.createEl("button", { text: displayStr, attr: { title: val ? String(val) : "Missing", style: `background: ${isDone ? 'var(--background-primary)' : 'transparent'}; border: 1px solid ${isDone ? color : 'transparent'}; border-radius: 6px; font-size: 14px; padding: 4px 8px; color: ${color}; box-shadow: none; cursor: pointer;` }});

        btn.onclick = (e) => {
            const menu = new Menu();
            if (isLink) {
                menu.addItem(i => i.setTitle(`Extract Link: ${val.replace(/[[\]]/g, '')}`).setIcon("link").onClick(() => {
                    const cleanName = val.replace('[[', '').replace(']]', '');
                    const targetFile = this.app.metadataCache.getFirstLinkpathDest(cleanName, file.path);
                    if (targetFile) this.app.workspace.getLeaf(false).openFile(targetFile);
                    else new Notice("Linked file not found.");
                }));
                menu.addSeparator();
            }
            menu.addItem(i => i.setTitle("Mark as Collected (✅)").setIcon("check").onClick(() => this.app.fileManager.processFrontMatter(file, fm => fm[key] = true)));
            menu.addItem(i => i.setTitle("Link File / Text (📄)").setIcon("paperclip").onClick(() => {
                new DataPromptModal(this.app, key.toUpperCase(), val?.toString() || "", (newVal) => {
                    this.app.fileManager.processFrontMatter(file, fm => fm[key] = newVal);
                }).open();
            }));
            menu.addItem(i => i.setTitle("Mark as Missing (❌)").setIcon("cross").onClick(() => this.app.fileManager.processFrontMatter(file, fm => { fm[key] = false; })));
            menu.showAtMouseEvent(e);
        };
    }

    private applyFilters() {
        this.allEntries.forEach(e => {
            if (e.rowEl) e.rowEl.style.display = (!this.searchQuery || e.searchText.includes(this.searchQuery)) ? "" : "none";
        });
    }

    async onClose() { this.observer.disconnect(); }
}

class DataPromptModal extends Modal {
    onSubmit: (val: string) => void; 
    keyName: string; 
    initialVal: string;
    constructor(app: App, keyName: string, initialVal: string, onSubmit: (val: string) => void) {
        super(app); this.keyName = keyName; this.initialVal = initialVal; this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: `Set data for ${this.keyName}` });
        contentEl.createEl("p", { text: "Tip: You can paste an Obsidian link here like [[spectra.pdf]]", cls: "color-text-muted", attr: {style: "font-size: 12px; margin-top: 0;"}});
        
        const input = contentEl.createEl("input", { type: "text", value: this.initialVal === 'true' || this.initialVal === 'false' ? '' : this.initialVal });
        input.style.width = "100%"; input.style.marginBottom = "15px";
        
        const saveBtn = contentEl.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { this.onSubmit(input.value.trim()); this.close(); };
        input.onkeydown = (e) => { if (e.key === "Enter") saveBtn.click(); };
        setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}
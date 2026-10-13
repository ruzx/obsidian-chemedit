// ElnDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { CreateExperimentModal, createNewElnExperiment } from './SharedEln';
import { renderLimsNav } from './SharedBase';

export const ELN_DASHBOARD_VIEW_TYPE = "chem-eln-dashboard";

interface ElnEntry {
    file: TFile;
    code: string;
    project: string;
    status: string;
    date: string;
    yieldStr: string;
    rxnSmiles: string;
    timestamp: number;
    // For CSS-based filtering
    rowEl?: HTMLElement;
    searchText: string;
}

export class ElnDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    
    allEntries: ElnEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    private observer: IntersectionObserver;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Lazy-loader for Reaction Schemes to keep the dashboard lightning fast
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    const smiles = el.dataset.smiles;
                    
                    if (smiles && !el.dataset.rendered) {
                        el.dataset.rendered = "true";
                        
                        this.plugin.api.renderStructure(smiles, 280, 110).then(renderEl => {
                            el.empty();
                            if (renderEl) {
                                renderEl.style.maxWidth = '100%';
                                renderEl.style.maxHeight = '100%';
                                el.appendChild(renderEl);
                            } else {
                                el.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">Invalid Structure</span>`;
                            }
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "150px", threshold: 0.1 });
    }

    getViewType() { return ELN_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "ELN Dashboard"; }
    getIcon() { return "book-open"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('chem-eln-dashboard-view');
        
        Object.assign(container.style, {
            display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)"
        });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
        
        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "eln", this.plugin);

        titleArea.createEl("h2", { text: "Laboratory Notebook", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Manage and track all your chemical experiments", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ New Experiment", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => {
            const currentDir = window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || "/");
            new CreateExperimentModal(this.app, this.plugin, this.plugin.settings.elnPrefix, currentDir, async (expCode: string) => {
                await createNewElnExperiment(this.app, expCode, currentDir, this.plugin.settings.elnSections);
                this.loadExperiments();
            }).open();
        };

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = this.toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        const filterTabs = leftTools.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
        const tabs = ['All', 'Planned', 'Running', 'Completed', 'Failed'];
        
        tabs.forEach(t => {
            const btn = filterTabs.createEl("button", { text: t, attr: { style: `border-radius: 20px; padding: 4px 16px; font-size: 12px; font-weight: 600; border: 1px solid ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}; background: ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-primary)'}; color: ${this.currentFilter === t ? 'var(--text-on-accent)' : 'var(--text-muted)'}; box-shadow: none;` }});
            btn.onclick = () => {
                this.currentFilter = t;
                this.renderToolbar();
                this.applyFilters(); // FAST CSS FILTER
            };
        });

        // Quick Folder Setting (Supports Subfolders)
        const dirWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px; margin-left: 10px;" }});
        dirWrap.createEl("span", { text: "📁 Folder:", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);" }});
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || ""), attr: { placeholder: "e.g. ELN/2026", style: "width: 140px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-eln-dir', e.target.value.trim());
            this.loadExperiments();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search reference, project...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters(); // FAST CSS FILTER
        };

        // --- TABLE CONTAINER ---
        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        const tr = thead.createEl("tr");
        const cols = [
            { name: "Reference", width: "120px" },
            { name: "Reaction Scheme", width: "320px" },
            { name: "Project", width: "150px" },
            { name: "Yield", width: "80px" },
            { name: "Last Edited", width: "120px" },
            { name: "Status", width: "120px" }
        ];

        cols.forEach(c => {
            tr.createEl("th", { text: c.name, attr: { style: `padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; width: ${c.width};` }});
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadExperiments();

        // BATTERY-EFFICIENT AUTO-REFRESH
        // Waits 2 seconds after vault activity stops before rebuilding the table
        const requestRefresh = debounce(() => {
            this.loadExperiments();
        }, 2000, true); 

        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private renderToolbar() {
        const btns = this.toolbarEl.querySelectorAll('button');
        btns.forEach(btn => {
            const isMatch = btn.innerText === this.currentFilter;
            btn.style.background = isMatch ? 'var(--interactive-accent)' : 'var(--background-primary)';
            btn.style.color = isMatch ? 'var(--text-on-accent)' : 'var(--text-muted)';
            btn.style.borderColor = isMatch ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        });
    }

    private async loadExperiments() {
        const { parseYaml } = require('obsidian');
        const files = this.app.vault.getMarkdownFiles();
        const entries: ElnEntry[] = [];
        
        const targetDir = window.localStorage.getItem('chem-eln-dir') ?? (this.plugin.settings.elnDirectory || "");

        for (const file of files) {
            // 1. FAST RAM-ONLY PRE-FILTER
            // Using startsWith naturally includes all nested subfolders!
            const inFolder = !targetDir || file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = Array.isArray(fmTags) ? fmTags.includes('experiment') : fmTags === 'experiment';
            
            if (!inFolder && !isTagged) continue;

            // 2. CHECK FOR CODEBLOCK WITHOUT READING DISK
            const hasCodeBlock = cache?.sections?.some(s => s.type === 'code');
            if (!hasCodeBlock) continue;

            // 3. READ DISK ONLY WHEN NECESSARY
            const content = await this.app.vault.cachedRead(file);
            const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            
            if (elnMatch) {
                try {
                    const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m: any, p1: string) => {
                        let s = p1.trim(); if (!s) return m;
                        const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                        return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                    });

                    const data = parseYaml(safeSource);
                    
                    const rs = (data.reactants || []).map((r:any) => r.smiles).filter(Boolean).join('.');
                    const ps = (data.products || []).map((p:any) => p.smiles).filter(Boolean).join('.');
                    const rxnSmiles = rs || ps ? `${rs}>>${ps}` : "";

                    const code = data.code || file.basename;
                    const project = data.project || 'Unassigned';

                    entries.push({
                        file,
                        code: code,
                        project: project,
                        status: data.status || 'Planned',
                        date: data.date || window.moment(file.stat.mtime).format("MMM D, YYYY"),
                        yieldStr: data.products?.[0]?.yield ? `${data.products[0].yield}%` : '-',
                        rxnSmiles: rxnSmiles,
                        timestamp: file.stat.mtime,
                        searchText: `${code} ${project} ${data.status || ''}`.toLowerCase()
                    });
                } catch (e) {}
            }
        }

        // Sort by newest first
        this.allEntries = entries.sort((a, b) => b.timestamp - a.timestamp);
        
        // Build DOM exactly once using a DocumentFragment to completely eliminate blinking
        this.buildTableDOM();
        
        // Hide non-matching rows instantly
        this.applyFilters();
    }

    private buildTableDOM() {
        // DocumentFragment allows us to build the entire table offline
        // and inject it into the DOM in a single synchronous frame!
        const fragment = document.createDocumentFragment();
        this.observer.disconnect();

        if (this.allEntries.length === 0) {
            const emptyTr = document.createElement("tr");
            emptyTr.innerHTML = `<td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No experiments found. Create notes tagged with [experiment].</td>`;
            fragment.appendChild(emptyTr);
        } else {
            this.allEntries.forEach(e => {
                const tr = document.createElement("tr");
                tr.style.cursor = "pointer";
                tr.style.transition = "background 0.2s";
                e.rowEl = tr; // Store reference for CSS filtering

                tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
                tr.onmouseout = () => tr.style.backgroundColor = "transparent";
                tr.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

                // Ref Code
                const tdCode = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
                tdCode.createDiv({ text: e.code, attr: { style: "font-weight: 700; color: var(--text-accent);" }});

                // Reaction Scheme (Lazy Loaded)
                const tdScheme = tr.createEl("td", { attr: { style: "padding: 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
                const schemeWrap = tdScheme.createDiv({ attr: { 'data-smiles': e.rxnSmiles, style: "width: 280px; height: 90px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px;" }});
                
                if (e.rxnSmiles) {
                    schemeWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">⏳ Loading...</span>`;
                    this.observer.observe(schemeWrap);
                } else {
                    schemeWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">No Structure</span>`;
                }

                // Project
                tr.createEl("td", { text: e.project, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); color: var(--text-normal);" }});

                // Yield
                const yColor = e.yieldStr !== '-' ? (parseFloat(e.yieldStr) >= 80 ? 'var(--text-success)' : 'var(--text-normal)') : 'var(--text-muted)';
                tr.createEl("td", { text: e.yieldStr, attr: { style: `padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); font-weight: 600; color: ${yColor};` }});

                // Date
                tr.createEl("td", { text: e.date, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); color: var(--text-muted);" }});

                // Status Badge
                const tdStatus = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
                
                let bg = 'var(--background-primary)', color = 'var(--text-muted)', border = 'var(--background-modifier-border)';
                if (e.status === 'Completed') { color = 'var(--text-success)'; border = 'var(--text-success)'; }
                else if (e.status === 'Running') { color = 'var(--text-warning)'; border = 'var(--text-warning)'; }
                else if (e.status === 'Failed') { color = 'var(--text-error)'; border = 'var(--text-error)'; }
                else if (e.status === 'Planned') { color = 'var(--text-accent)'; border = 'var(--text-accent)'; }

                tdStatus.createDiv({ text: e.status.toUpperCase(), attr: { style: `display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; color: ${color}; border: 1px solid ${border}; background: ${bg};` }});

                fragment.appendChild(tr);
            });
        }

        // Swap the entire body at once to completely stop blinking
        this.tableBodyEl.empty();
        this.tableBodyEl.appendChild(fragment);
    }

    // CPU-Free Filtering: Toggles display:none directly on the DOM rows
    private applyFilters() {
        this.allEntries.forEach(e => {
            if (!e.rowEl) return;
            
            const matchFilter = this.currentFilter === 'All' || e.status === this.currentFilter;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            
            if (matchFilter && matchSearch) {
                e.rowEl.style.display = ""; // Show row instantly
            } else {
                e.rowEl.style.display = "none"; // Hide row instantly
            }
        });
    }

    async onClose() {
        this.observer.disconnect();
    }
}
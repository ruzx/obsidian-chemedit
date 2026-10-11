// LibraryDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';
import { calculateMwOffline } from './SharedEln';

export const LIBRARY_DASHBOARD_VIEW_TYPE = "chem-library-dashboard";

interface LibraryEntry {
    file: TFile;
    name: string;
    smiles: string;
    formula: string;
    mw: number;
    tags: string[];
}

export class LibraryDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    tableBodyEl: HTMLElement;
    allEntries: LibraryEntry[] = [];
    searchQuery: string = '';
    private observer: IntersectionObserver;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    const smiles = el.dataset.smiles;
                    if (smiles && !el.dataset.rendered) {
                        el.dataset.rendered = "true";
                        this.plugin.api.renderStructure(smiles, 120, 100).then(renderEl => {
                            el.empty();
                            if (renderEl) { renderEl.style.maxWidth = '100%'; renderEl.style.maxHeight = '100%'; el.appendChild(renderEl); } 
                            else el.innerHTML = `<span style="color:var(--text-muted);">Invalid</span>`;
                        });
                    }
                }
            });
        }, { root: null, rootMargin: "100px", threshold: 0.1 });
    }

    getViewType() { return LIBRARY_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Compounds Library"; }
    getIcon() { return "library"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-library-dashboard-view');
        Object.assign(container.style, { display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        renderLimsNav(titleArea, "library", this.plugin);

        titleArea.createEl("h2", { text: "Compounds Library", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Central database of reference structures and building blocks", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ Add Compound", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => {
            this.plugin.api.ketcher.openEditor("", "smiles", async (smiles: string) => {
                if (!smiles) return;
                const name = "Compound_" + window.moment().format("HHmmss");
                const content = `---\ntags: [library]\nname: "${name}"\nsmiles: "${smiles}"\n---\n# ${name}\n\n\`\`\`smiles\n${smiles}\n\`\`\`\n`;
                const file = await this.app.vault.create(`Library/${name}.md`, content);
                this.app.workspace.getLeaf(false).openFile(file);
            });
        };

        const toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: flex-end; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const searchInp = toolbarEl.createEl("input", { type: "search", placeholder: "Search name, SMILES, or formula...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => { this.searchQuery = e.target.value.toLowerCase(); this.renderTable(); };

        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        const tr = thead.createEl("tr");
        ["Structure", "Name", "Properties", "SMILES", "Actions"].forEach(c => {
            tr.createEl("th", { text: c, attr: { style: "padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;" }});
        });

        this.tableBodyEl = table.createEl("tbody");
        await this.loadLibrary();
        this.registerEvent(this.app.metadataCache.on('resolved', () => this.loadLibrary()));
    }

    private async loadLibrary() {
        const files = this.app.vault.getMarkdownFiles();
        this.allEntries = [];
        for (const file of files) {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            const isLib = fm?.tags?.includes('library') || file.path.toLowerCase().includes('library/');
            if (!isLib) continue;

            let smiles = fm?.smiles || "";
            if (!smiles) {
                const content = await this.app.vault.cachedRead(file);
                const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                if (blockMatch) smiles = blockMatch[1].trim();
            }

            let mw = fm?.mw || 0;
            let formula = fm?.formula || "";
            if (smiles && (!mw || !formula)) {
                const p = await calculateMwOffline(smiles, this.plugin);
                if (p) { mw = p.mw; formula = p.formula; }
            }

            this.allEntries.push({
                file, name: fm?.name || file.basename, smiles, formula, mw, tags: fm?.tags || []
            });
        }
        this.allEntries.sort((a, b) => a.name.localeCompare(b.name));
        this.renderTable();
    }

    private renderTable() {
        this.tableBodyEl.empty();
        this.observer.disconnect();

        const filtered = this.allEntries.filter(e => !this.searchQuery || `${e.name} ${e.smiles} ${e.formula}`.toLowerCase().includes(this.searchQuery));

        if (filtered.length === 0) {
            this.tableBodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No compounds found. Create a note in a 'Library' folder or use tags: [library].</td></tr>`;
            return;
        }

        filtered.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr", { attr: { style: "transition: background 0.2s;" }});
            tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
            tr.onmouseout = () => tr.style.backgroundColor = "transparent";

            const tdStruct = tr.createEl("td", { attr: { style: "padding: 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const structWrap = tdStruct.createDiv({ attr: { 'data-smiles': e.smiles, style: "width: 120px; height: 100px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer;" }});
            structWrap.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            structWrap.innerHTML = e.smiles ? `<span style="color:var(--text-muted); font-size: 11px;">⏳ Loading...</span>` : `<span style="color:var(--text-muted); font-size: 11px;">No Structure</span>`;
            if (e.smiles) this.observer.observe(structWrap);

            const tdName = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdName.createDiv({ text: e.name, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; margin-bottom: 4px; cursor: pointer;" }}).onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

            const tdProps = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdProps.createDiv({ text: `Formula: ${e.formula || '-'}`, attr: { style: "font-size: 12px; color: var(--text-normal); font-weight: 600;" }});
            tdProps.createDiv({ text: `MW: ${e.mw ? e.mw.toFixed(2) : '-'}`, attr: { style: "font-size: 12px; color: var(--text-muted);" }});

            tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); max-width: 200px;" }}).createEl("code", { text: e.smiles.length > 30 ? e.smiles.substring(0, 30) + "..." : e.smiles, attr: { style: "font-size: 10px; word-break: break-all;" }});

            const tdAct = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdAct.createEl("button", { text: "📋 Copy SMILES", attr: { style: "font-size: 11px; padding: 4px 12px; width: 100%; margin-bottom: 6px;" }}).onclick = () => { navigator.clipboard.writeText(e.smiles); new Notice("Copied!"); };
        });
    }
    async onClose() { this.observer.disconnect(); }
}
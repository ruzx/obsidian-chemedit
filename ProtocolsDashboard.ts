// ProtocolsDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const PROTOCOLS_DASHBOARD_VIEW_TYPE = "chem-protocols-dashboard";

interface ProtocolEntry {
    file: TFile;
    title: string;
    author: string;
    status: string;
    lastReviewed: string;
    // For CSS-based filtering
    rowEl?: HTMLElement;
    searchText: string;
}

export class ProtocolsDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: ProtocolEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return PROTOCOLS_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Lab Protocols"; }
    getIcon() { return "file-text"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-protocols-dashboard-view');
        Object.assign(container.style, { display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "protocols", this.plugin);

        titleArea.createEl("h2", { text: "Standard Operating Procedures", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Manage lab methodologies, reaction protocols, and safety rules", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ New Protocol", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => this.createNewProtocol();

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = this.toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        const filterTabs = leftTools.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
        const tabs = ['All', 'Draft', 'Approved', 'Obsolete'];
        
        tabs.forEach(t => {
            const btn = filterTabs.createEl("button", { text: t, attr: { style: `border-radius: 20px; padding: 4px 16px; font-size: 12px; font-weight: 600; border: 1px solid ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}; background: ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-primary)'}; color: ${this.currentFilter === t ? 'var(--text-on-accent)' : 'var(--text-muted)'}; box-shadow: none;` }});
            btn.onclick = () => {
                this.currentFilter = t;
                this.renderToolbar();
                this.applyFilters(); // FAST CSS FILTER
            };
        });

        // Quick Folder Setting
        const dirWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px; margin-left: 10px;" }});
        dirWrap.createEl("span", { text: "📁 Folder:", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);" }});
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-protocols-dir') || "Protocols", attr: { style: "width: 120px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-protocols-dir', e.target.value.trim());
            this.loadProtocols();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search protocol titles, authors...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => { 
            this.searchQuery = e.target.value.toLowerCase(); 
            this.applyFilters(); // FAST CSS FILTER
        };

        // --- TABLE ---
        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        const tr = thead.createEl("tr");
        ["Protocol Title", "Author", "Status", "Last Reviewed", "Actions"].forEach(c => {
            tr.createEl("th", { text: c, attr: { style: "padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;" }});
        });

        this.tableBodyEl = table.createEl("tbody");
        
        await this.loadProtocols();
        
        // BATTERY-EFFICIENT AUTO-REFRESH
        const requestRefresh = debounce(() => this.loadProtocols(), 2000, true); 
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

    private async createNewProtocol() {
        const targetDir = window.localStorage.getItem('chem-protocols-dir') || "Protocols";
        if (!await this.app.vault.adapter.exists(targetDir)) {
            await this.app.vault.createFolder(targetDir);
        }

        const name = "SOP - " + window.moment().format("HHmmss");
        const content = `---\ntags: [protocol]\ntitle: "${name}"\nauthor: "Current User"\nstatus: "Draft"\nlast_reviewed: "${window.moment().format("YYYY-MM-DD")}"\n---\n# ${name}\n\n## ⚠️ Safety Precautions\n- Wear PPE.\n\n## 🧪 Reagents & Materials\n- \n\n## 📝 Step-by-Step Procedure\n1. \n`;
        const file = await this.app.vault.create(`${targetDir}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
    }

    private async loadProtocols() {
        const targetDir = window.localStorage.getItem('chem-protocols-dir') || "Protocols";
        const files = this.app.vault.getMarkdownFiles();
        const entries: ProtocolEntry[] = [];

        for (const file of files) {
            // 1. FAST PRE-FILTER (RAM Only)
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? (fmTags.includes('protocol') || fmTags.includes('sop')) : (fmTags === 'protocol' || fmTags === 'sop'));

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const title = fm.title || file.basename;
            const author = fm.author || "Unknown";

            entries.push({
                file,
                title,
                author,
                status: fm.status || "Draft",
                lastReviewed: fm.last_reviewed || "-",
                searchText: `${title} ${author} ${fm.status || ''}`.toLowerCase()
            });
        }
        
        this.allEntries = entries.sort((a, b) => a.title.localeCompare(b.title));
        
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            this.tableBodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No protocols found. Create a note in a 'Protocols' folder or use tags: [protocol].</td></tr>`;
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr", { attr: { style: "cursor: default; transition: background 0.2s;" }});
            e.rowEl = tr;

            tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
            tr.onmouseout = () => tr.style.backgroundColor = "transparent";

            // Title
            const tdName = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const nameLink = tdName.createDiv({ text: `📄 ${e.title}`, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; cursor: pointer;" }});
            nameLink.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);

            // Author
            tr.createEl("td", { text: e.author, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); font-weight: 500;" }});

            // Status Badge
            const tdStatus = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            let color = 'var(--text-warning)', bg = 'var(--background-primary)';
            if (e.status === 'Approved') color = 'var(--text-success)';
            else if (e.status === 'Obsolete') color = 'var(--text-error)';
            
            tdStatus.createDiv({ text: e.status.toUpperCase(), attr: { style: `display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; color: ${color}; border: 1px solid ${color}; background: ${bg};` }});

            // Last Reviewed Date
            tr.createEl("td", { text: e.lastReviewed, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); color: var(--text-muted);" }});

            // Actions
            const tdAct = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const btn = tdAct.createEl("button", { text: "✍️ Mark Reviewed", attr: { style: "font-size: 11px; padding: 4px 12px; width: 100%;" }});
            btn.onclick = async () => {
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.last_reviewed = window.moment().format("YYYY-MM-DD"); 
                    fm.status = "Approved"; 
                });
                new Notice(`${e.title} marked as Reviewed & Approved.`);
                // Table will auto-refresh via the debounced vault modify event
            };
        });
    }

    // CPU-Free Filtering: Toggles display:none directly on the DOM rows
    private applyFilters() {
        this.allEntries.forEach(e => {
            if (!e.rowEl) return;
            const matchFilter = this.currentFilter === 'All' || e.status === this.currentFilter;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            
            if (matchFilter && matchSearch) {
                e.rowEl.style.display = ""; 
            } else {
                e.rowEl.style.display = "none";
            }
        });
    }

    async onClose() {}
}
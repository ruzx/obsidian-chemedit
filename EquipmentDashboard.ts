// EquipmentDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const EQUIPMENT_DASHBOARD_VIEW_TYPE = "chem-equipment-dashboard";

interface EquipmentEntry {
    file: TFile;
    name: string;
    location: string;
    status: string;
    bookedBy: string;
    nextMaintenance: string;
    contact: string;
    rowEl?: HTMLElement;
    searchText: string;
}

export class EquipmentDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: EquipmentEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return EQUIPMENT_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Lab Equipment"; }
    getIcon() { return "microscope"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-equipment-dashboard-view');
        
        Object.assign(container.style, { 
            display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" 
        });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "equipment", this.plugin);

        titleArea.createEl("h2", { text: "Lab Equipment", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Track instrument bookings, manuals, and maintenance logs", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ Add Instrument", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => this.createNewEquipment();

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = this.toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        const filterTabs = leftTools.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
        const tabs = ['All', 'Available', 'In Use', 'Maintenance'];
        
        tabs.forEach(t => {
            const btn = filterTabs.createEl("button", { text: t, attr: { style: `border-radius: 20px; padding: 4px 16px; font-size: 12px; font-weight: 600; border: 1px solid ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}; background: ${this.currentFilter === t ? 'var(--interactive-accent)' : 'var(--background-primary)'}; color: ${this.currentFilter === t ? 'var(--text-on-accent)' : 'var(--text-muted)'}; box-shadow: none;` }});
            btn.onclick = () => {
                this.currentFilter = t;
                this.renderToolbar();
                this.applyFilters();
            };
        });

        // Quick Folder Setting
        const dirWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px; margin-left: 10px;" }});
        dirWrap.createEl("span", { text: "📁 Folder:", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);" }});
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-equip-dir') || "Equipment", attr: { style: "width: 120px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-equip-dir', e.target.value.trim());
            this.loadEquipment();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search instrument or location...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => { 
            this.searchQuery = e.target.value.toLowerCase(); 
            this.applyFilters();
        };

        // --- TABLE CONTAINER ---
        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        const tr = thead.createEl("tr");
        ["Instrument", "Location", "Status", "Maintenance", "Actions"].forEach(c => {
            tr.createEl("th", { text: c, attr: { style: "padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;" }});
        });

        this.tableBodyEl = table.createEl("tbody");
        
        await this.loadEquipment();

        // BATTERY-EFFICIENT AUTO-REFRESH (Using the imported debounce)
        const requestRefresh = debounce(() => this.loadEquipment(), 2000, true); 
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

    private async createNewEquipment() {
        const targetDir = window.localStorage.getItem('chem-equip-dir') || "Equipment";
        if (!await this.app.vault.adapter.exists(targetDir)) {
            await this.app.vault.createFolder(targetDir);
        }

        const name = "New Instrument " + window.moment().format("HHmmss");
        const content = `---\ntags: [equipment]\nname: "${name}"\nlocation: "Unassigned"\nstatus: "Available"\nbooked_by: ""\nnext_maintenance: "${window.moment().add(1, 'year').format("YYYY-MM-DD")}"\ncontact: ""\n---\n# ${name}\n\n## 📖 Standard Operating Procedure\n1. Turn on the machine...\n\n## 🔗 Important Links\n- [Link to PDF Manual]()\n\n## 🛠️ Service Logs\n- **${window.moment().format("YYYY-MM-DD")}:** Added to system.\n`;
        const file = await this.app.vault.create(`${targetDir}/${name}.md`, content);
        this.app.workspace.getLeaf(false).openFile(file);
        
        // Using Notice correctly here
        new Notice(`Created ${name}`);
    }

    private async loadEquipment() {
        const targetDir = window.localStorage.getItem('chem-equip-dir') || "Equipment";
        const files = this.app.vault.getMarkdownFiles();
        const entries: EquipmentEntry[] = [];

        for (const file of files) {
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? fmTags.includes('equipment') : fmTags === 'equipment');

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const name = fm.name || file.basename;
            const location = fm.location || "Unknown";
            const contact = fm.contact || "";

            entries.push({
                file,
                name,
                location,
                status: fm.status || "Available",
                bookedBy: fm.booked_by || "",
                nextMaintenance: fm.next_maintenance || "-",
                contact,
                searchText: `${name} ${location} ${contact}`.toLowerCase()
            });
        }
        
        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            this.tableBodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No equipment found. Create notes in an 'Equipment' folder or use tags: [equipment].</td></tr>`;
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr", { attr: { style: "cursor: default; transition: background 0.2s;" }});
            e.rowEl = tr; 

            tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
            tr.onmouseout = () => tr.style.backgroundColor = "transparent";

            const tdName = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const nameLink = tdName.createDiv({ text: `🔬 ${e.name}`, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; cursor: pointer; margin-bottom: 4px;" }});
            nameLink.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            if (e.contact) tdName.createDiv({ text: `Contact: ${e.contact}`, attr: { style: "font-size: 11px; color: var(--text-muted);" }});

            tr.createEl("td", { text: `📍 ${e.location}`, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); font-weight: 500;" }});

            const tdStatus = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const isAvail = e.status === 'Available';
            const color = isAvail ? 'var(--text-success)' : e.status === 'Maintenance' ? 'var(--text-error)' : 'var(--text-warning)';
            
            tdStatus.createDiv({ text: e.status.toUpperCase(), attr: { style: `display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; color: ${color}; border: 1px solid ${color}; background: var(--background-primary); margin-bottom: 4px;` }});
            if (e.bookedBy) tdStatus.createDiv({ text: `👤 ${e.bookedBy}`, attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 4px;" }});

            tr.createEl("td", { text: e.nextMaintenance, attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover); color: var(--text-muted);" }});

            const tdAct = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const actContainer = tdAct.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 6px;" }});
            
            const btn = actContainer.createEl("button", { text: isAvail ? "📅 Book" : "✅ Release", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
            btn.onclick = async () => {
                const newStatus = isAvail ? 'In Use' : 'Available';
                const user = isAvail ? "Current User" : "";
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.status = newStatus; 
                    fm.booked_by = user; 
                });
                new Notice(`${e.name} is now ${newStatus}.`);
            };

            if (e.status !== 'Maintenance') {
                const maintBtn = actContainer.createEl("button", { text: "🔧 Maint.", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
                maintBtn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = 'Maintenance'; 
                        fm.booked_by = "Service Team"; 
                    });
                    new Notice(`${e.name} set to Maintenance.`);
                };
            }
        });
    }

    private applyFilters() {
        this.allEntries.forEach(e => {
            if (!e.rowEl) return;
            const matchFilter = this.currentFilter === 'All' || e.status === this.currentFilter;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            e.rowEl.style.display = (matchFilter && matchSearch) ? "" : "none";
        });
    }

    async onClose() {}
}
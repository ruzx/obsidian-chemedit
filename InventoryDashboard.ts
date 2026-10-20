// InventoryDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { AddInventoryModal, QrCodeModal, renderLimsNav } from './SharedBase';

export const INVENTORY_DASHBOARD_VIEW_TYPE = "chem-inventory-dashboard";

interface InventoryEntry {
    file: TFile;
    name: string;
    smiles: string;
    cas: string;
    supplier: string;
    location: string;
    amount: string;
    status: string;
    checkedOutBy: string;
    lastUpdated: string;
    timestamp: number;
    // For CSS-based filtering
    rowEl?: HTMLElement;
    searchText: string;
}

export class InventoryDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    
    allEntries: InventoryEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    private observer: IntersectionObserver;

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Lazy-loader for structures to ensure maximum performance
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

    getViewType() { return INVENTORY_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Chemical Inventory"; }
    getIcon() { return "package"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-inventory-dashboard-view');
        
        Object.assign(container.style, {
            display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)"
        });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "inventory", this.plugin);

        titleArea.createEl("h2", { text: "Chemical Inventory", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Track reagents, locations, and stock levels", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ Add Item", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-inv-dir') || "Inventory";
            new AddInventoryModal(this.app, this.plugin, folder, () => {
                this.loadInventory();
            }).open();
        };

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = this.toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        const filterTabs = leftTools.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
        const tabs = ['All', 'Available', 'Checked Out'];
        
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
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-inv-dir') || "Inventory", attr: { style: "width: 120px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-inv-dir', e.target.value.trim());
            this.loadInventory();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search name, CAS, location...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
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
            { name: "Structure", width: "140px" },
            { name: "Item Details", width: "250px" },
            { name: "Location & Stock", width: "150px" },
            { name: "Status", width: "120px" },
            { name: "Actions", width: "120px" }
        ];

        cols.forEach(c => {
            tr.createEl("th", { text: c.name, attr: { style: `padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; width: ${c.width};` }});
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadInventory();
        
        // BATTERY-EFFICIENT AUTO-REFRESH
        // Waits 2 seconds after vault activity stops before rebuilding the table
        const requestRefresh = debounce(() => {
            this.loadInventory();
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

    private async loadInventory() {
        const targetDir = window.localStorage.getItem('chem-inv-dir') || "Inventory";
        const files = this.app.vault.getMarkdownFiles();
        const entries: InventoryEntry[] = [];

        for (const file of files) {
            // 1. FAST PRE-FILTER (Zero battery drain, checks RAM cache and path strings)
            const inFolder = targetDir && file.path.startsWith(targetDir);
            
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            const fmTags = fm?.tags || [];
            const isTagged = (Array.isArray(fmTags) ? fmTags.includes('inventory') : fmTags === 'inventory');

            // Skip file instantly if it doesn't meet criteria
            if (!inFolder && !isTagged) continue;

            let smiles = fm?.smiles || "";
            
            // 2. AVOID CONTENT READING UNLESS NECESSARY
            // We only read the file content to find a SMILES string if the frontmatter didn't have one
            if (!smiles) {
                const hasCodeBlock = cache?.sections?.some(s => s.type === 'code');
                if (hasCodeBlock) {
                    const content = await this.app.vault.cachedRead(file);
                    const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                    if (blockMatch) smiles = blockMatch[1].trim();
                }
            }

            const name = fm?.name || file.basename;
            const cas = fm?.cas || "";
            const supplier = fm?.supplier || "-";
            const location = fm?.location || "Unassigned";

            entries.push({
                file,
                name: name,
                smiles: smiles,
                cas: cas,
                supplier: supplier,
                location: location,
                amount: fm?.amount || "-",
                status: fm?.status || "Available",
                checkedOutBy: fm?.checked_out_by || "",
                lastUpdated: fm?.last_updated || "-",
                timestamp: file.stat.mtime,
                searchText: `${name} ${cas} ${supplier} ${location}`.toLowerCase()
            });
        }

        // Sort alphabetically by default
        this.allEntries = entries.sort((a, b) => a.name.localeCompare(b.name));
        
        // Build DOM exactly once
        this.buildTableDOM();
        
        // Hide non-matching rows instantly
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();
        this.observer.disconnect();

        if (this.allEntries.length === 0) {
            this.tableBodyEl.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No inventory items found. Add items to an Inventory folder or use tags: [inventory].</td></tr>`;
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr", { attr: { style: "transition: background 0.2s;" }});
            e.rowEl = tr; // Store reference for CSS filtering

            tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
            tr.onmouseout = () => tr.style.backgroundColor = "transparent";

            // 1. Structure (Lazy Loaded)
            const tdStruct = tr.createEl("td", { attr: { style: "padding: 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const structWrap = tdStruct.createDiv({ attr: { 'data-smiles': e.smiles, style: "width: 120px; height: 100px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer;" }});
            
            structWrap.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file); 
            
            if (e.smiles) {
                structWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">⏳ Loading...</span>`;
                this.observer.observe(structWrap);
            } else {
                structWrap.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">No Structure</span>`;
            }

            // 2. Item Details
            const tdDetails = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const nameEl = tdDetails.createDiv({ text: e.name, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; margin-bottom: 6px; cursor: pointer;" }});
            nameEl.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            
            if (e.cas) tdDetails.createDiv({ text: `CAS: ${e.cas}`, attr: { style: "font-size: 11px; color: var(--text-muted); margin-bottom: 2px;" }});
            tdDetails.createDiv({ text: `Supplier: ${e.supplier}`, attr: { style: "font-size: 11px; color: var(--text-muted);" }});

            // 3. Location & Stock
            const tdLoc = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdLoc.createDiv({ text: `📍 ${e.location}`, attr: { style: "font-size: 13px; color: var(--text-normal); font-weight: 500; margin-bottom: 4px;" }});
            tdLoc.createDiv({ text: `⚖️ ${e.amount}`, attr: { style: "font-size: 12px; color: var(--text-muted);" }});

            // 4. Status Badge
            const tdStatus = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const isAvail = e.status === 'Available';
            const color = isAvail ? 'var(--text-success)' : 'var(--text-warning)';
            const border = isAvail ? 'var(--text-success)' : 'var(--text-warning)';
            
            tdStatus.createDiv({ text: e.status.toUpperCase(), attr: { style: `display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; color: ${color}; border: 1px solid ${border}; background: var(--background-primary); margin-bottom: 4px;` }});
            
            if (!isAvail && e.checkedOutBy) {
                tdStatus.createDiv({ text: `👤 ${e.checkedOutBy}`, attr: { style: "font-size: 11px; color: var(--text-muted); margin-top: 4px;" }});
            }

            // 5. Actions
            const tdActions = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const actContainer = tdActions.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 6px;" }});
            
            // Check In/Out Button
            const toggleBtn = actContainer.createEl("button", { text: isAvail ? "📤 Check Out" : "📥 Return", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
            toggleBtn.onclick = async () => {
                const newStatus = isAvail ? 'Checked Out' : 'Available';
                const user = newStatus === 'Checked Out' ? "Current User" : ""; 
                
                await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                    fm.status = newStatus; 
                    fm.checked_out_by = user;
                    fm.last_updated = window.moment().format("YYYY-MM-DD");
                });
                
                new Notice(`${e.name} is now ${newStatus}`);
                // Note: The UI will auto-refresh via the debounced vault modify event
            };

            // QR Code Button
            const qrBtn = actContainer.createEl("button", { text: "🖨️ Label", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
            qrBtn.onclick = () => {
                new QrCodeModal(this.app, e.file).open();
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
                e.rowEl.style.display = ""; // Show row
            } else {
                e.rowEl.style.display = "none"; // Hide row instantly
            }
        });
    }

    async onClose() {
        this.observer.disconnect();
    }
}
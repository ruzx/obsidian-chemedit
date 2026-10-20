// OrdersDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, debounce, Modal, App, Setting } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const ORDERS_DASHBOARD_VIEW_TYPE = "chem-orders-dashboard";

interface OrderEntry {
    file: TFile;
    name: string;
    type: string; // Chemical, Consumable, Equipment
    supplier: string;
    catalog: string;
    amount: string;
    price: string;
    status: string;
    requester: string;
    orderDate: string;
    receiveDate: string;
    timestamp: number;
    // For CSS-based filtering
    rowEl?: HTMLElement;
    searchText: string;
}

export class OrdersDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    toolbarEl: HTMLElement;
    tableBodyEl: HTMLElement;
    allEntries: OrderEntry[] = [];
    currentFilter: string = 'All';
    searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return ORDERS_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Orders & Requests"; }
    getIcon() { return "shopping-cart"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-orders-dashboard-view');
        
        Object.assign(container.style, {
            display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)"
        });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "orders", this.plugin);

        titleArea.createEl("h2", { text: "Orders & Requests", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Track chemicals, consumables, and equipment purchases", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        const newBtn = header.createEl("button", { text: "+ New Request", cls: "mod-cta", attr: { style: "height: 36px; font-size: 14px; font-weight: 600; padding: 0 20px;" }});
        newBtn.onclick = () => {
            const folder = window.localStorage.getItem('chem-orders-dir') || "Orders";
            new CreateOrderModal(this.app, folder).open();
        };

        // --- TOOLBAR ---
        this.toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = this.toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        const filterTabs = leftTools.createDiv({ attr: { style: "display: flex; gap: 8px;" }});
        const tabs = ['All', 'Planned', 'Ordered', 'Received'];
        
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
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-orders-dir') || "Orders", attr: { style: "width: 120px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-orders-dir', e.target.value.trim());
            this.loadOrders();
        };

        const searchInp = this.toolbarEl.createEl("input", { type: "search", placeholder: "Search item, supplier, catalog...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        };

        // --- TABLE CONTAINER ---
        const tableContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 0 30px 30px 30px;" }});
        const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; font-size: 13px;" }});
        const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-primary); z-index: 10;" }});
        
        const tr = thead.createEl("tr");
        const cols = [
            { name: "Item", width: "200px" },
            { name: "Supplier Info", width: "200px" },
            { name: "Amount & Price", width: "150px" },
            { name: "Requester", width: "150px" },
            { name: "Status", width: "120px" },
            { name: "Actions", width: "120px" }
        ];

        cols.forEach(c => {
            tr.createEl("th", { text: c.name, attr: { style: `padding: 16px 10px; border-bottom: 2px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; width: ${c.width};` }});
        });

        this.tableBodyEl = table.createEl("tbody");

        await this.loadOrders();
        
        // BATTERY-EFFICIENT AUTO-REFRESH
        const requestRefresh = debounce(() => this.loadOrders(), 2000, true); 
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

    private async loadOrders() {
        const targetDir = window.localStorage.getItem('chem-orders-dir') || "Orders";
        const files = this.app.vault.getMarkdownFiles();
        const entries: OrderEntry[] = [];

        for (const file of files) {
            // 1. FAST PRE-FILTER (RAM Only)
            const inFolder = targetDir && file.path.startsWith(targetDir);
            const cache = this.app.metadataCache.getFileCache(file);
            const fmTags = cache?.frontmatter?.tags || [];
            const isTagged = Array.isArray(fmTags) ? fmTags.includes('order') : fmTags === 'order';

            if (!inFolder && !isTagged) continue;

            const fm = cache?.frontmatter || {};
            const name = fm.name || file.basename;
            const type = fm.type || "Chemical";
            const supplier = fm.supplier || "-";
            const catalog = fm.catalog || "-";
            const status = fm.status || "Planned";

            entries.push({
                file,
                name,
                type,
                supplier,
                catalog,
                amount: fm.amount || "-",
                price: fm.price || "-",
                status,
                requester: fm.requester || "-",
                orderDate: fm.order_date || "-",
                receiveDate: fm.receive_date || "-",
                timestamp: file.stat.mtime,
                searchText: `${name} ${type} ${supplier} ${catalog} ${fm.requester||''}`.toLowerCase()
            });
        }

        // Sort by Planned first, then Ordered, then Received, then Name
        const statusWeight: Record<string, number> = { "Planned": 1, "Ordered": 2, "Received": 3 };
        this.allEntries = entries.sort((a, b) => {
            const wA = statusWeight[a.status] || 99;
            const wB = statusWeight[b.status] || 99;
            if (wA !== wB) return wA - wB;
            return b.timestamp - a.timestamp; // Newest first for same status
        });
        
        this.buildTableDOM();
        this.applyFilters();
    }

    private buildTableDOM() {
        this.tableBodyEl.empty();

        if (this.allEntries.length === 0) {
            this.tableBodyEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted); font-style: italic;">No orders found. Add requests to an Orders folder or use tags: [order].</td></tr>`;
            return;
        }

        this.allEntries.forEach(e => {
            const tr = this.tableBodyEl.createEl("tr", { attr: { style: "cursor: default; transition: background 0.2s;" }});
            e.rowEl = tr;

            tr.onmouseover = () => tr.style.backgroundColor = "var(--background-secondary-alt)";
            tr.onmouseout = () => tr.style.backgroundColor = "transparent";

            // 1. Item Name & Type
            const tdItem = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            const nameEl = tdItem.createDiv({ text: e.name, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px; margin-bottom: 4px; cursor: pointer;" }});
            nameEl.onclick = () => this.app.workspace.getLeaf(false).openFile(e.file);
            
            const typeIcon = e.type === "Chemical" ? "🧪" : e.type === "Consumable" ? "🧤" : "🔬";
            tdItem.createDiv({ text: `${typeIcon} ${e.type}`, attr: { style: "font-size: 11px; color: var(--text-muted); font-weight: 600;" }});

            // 2. Supplier Info
            const tdSup = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdSup.createDiv({ text: e.supplier, attr: { style: "font-size: 13px; color: var(--text-normal); font-weight: 600; margin-bottom: 4px;" }});
            tdSup.createDiv({ text: `Cat: ${e.catalog}`, attr: { style: "font-size: 11px; color: var(--text-muted); font-family: monospace;" }});

            // 3. Amount & Price
            const tdAmt = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdAmt.createDiv({ text: e.amount, attr: { style: "font-size: 13px; color: var(--text-normal); font-weight: 600; margin-bottom: 4px;" }});
            tdAmt.createDiv({ text: e.price, attr: { style: "font-size: 12px; color: var(--text-success); font-weight: 600;" }});

            // 4. Requester & Dates
            const tdReq = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            tdReq.createDiv({ text: `👤 ${e.requester}`, attr: { style: "font-size: 12px; color: var(--text-normal); margin-bottom: 4px;" }});
            if (e.orderDate && e.orderDate !== "-") tdReq.createDiv({ text: `Ordered: ${e.orderDate}`, attr: { style: "font-size: 10px; color: var(--text-muted);" }});
            if (e.receiveDate && e.receiveDate !== "-") tdReq.createDiv({ text: `Rcvd: ${e.receiveDate}`, attr: { style: "font-size: 10px; color: var(--text-muted);" }});

            // 5. Status Badge
            const tdStatus = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            let color = 'var(--text-muted)', bg = 'var(--background-primary)';
            if (e.status === 'Planned') color = 'var(--text-accent)';
            else if (e.status === 'Ordered') color = 'var(--text-warning)';
            else if (e.status === 'Received') color = 'var(--text-success)';
            
            tdStatus.createDiv({ text: e.status.toUpperCase(), attr: { style: `display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; color: ${color}; border: 1px solid ${color}; background: ${bg};` }});

            // 6. Actions (The pipeline toggles)
            const tdActions = tr.createEl("td", { attr: { style: "padding: 16px 10px; border-bottom: 1px solid var(--background-modifier-border-hover);" }});
            
            if (e.status === 'Planned') {
                const btn = tdActions.createEl("button", { text: "🛒 Mark Ordered", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
                btn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = "Ordered"; 
                        fm.order_date = window.moment().format("YYYY-MM-DD");
                    });
                };
            } else if (e.status === 'Ordered') {
                const btn = tdActions.createEl("button", { text: "📦 Mark Received", attr: { style: "font-size: 11px; padding: 4px; height: 26px; width: 100%;" }});
                btn.onclick = async () => {
                    await this.app.fileManager.processFrontMatter(e.file, (fm: any) => { 
                        fm.status = "Received"; 
                        fm.receive_date = window.moment().format("YYYY-MM-DD");
                    });
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
}

class CreateOrderModal extends Modal {
    folder: string;
    data = { name: "", type: "Chemical", supplier: "", catalog: "", amount: "", price: "" };

    constructor(app: App, folder: string) {
        super(app); this.folder = folder;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "New Order Request" });

        new Setting(contentEl).setName("Item Name").addText(t => t.onChange(v => this.data.name = v));
        new Setting(contentEl).setName("Type").addDropdown(d => d.addOption("Chemical", "🧪 Chemical").addOption("Consumable", "🧤 Consumable / Labware").addOption("Equipment", "🔬 Equipment").setValue("Chemical").onChange(v => this.data.type = v));
        new Setting(contentEl).setName("Supplier").addText(t => t.onChange(v => this.data.supplier = v));
        new Setting(contentEl).setName("Catalog #").addText(t => t.onChange(v => this.data.catalog = v));
        new Setting(contentEl).setName("Amount (e.g. 500g, 10pk)").addText(t => t.onChange(v => this.data.amount = v));
        new Setting(contentEl).setName("Estimated Price").addText(t => t.onChange(v => this.data.price = v));

        new Setting(contentEl).addButton(btn => btn.setButtonText("Create Request").setCta().onClick(async () => {
            if (!this.data.name.trim()) { new Notice("Name is required"); return; }
            
            if (!await this.app.vault.adapter.exists(this.folder)) {
                await this.app.vault.createFolder(this.folder);
            }

            const safeName = this.data.name.replace(/[\\/:"*?<>|]/g, '_') + "_" + window.moment().format("HHmmss");
            const content = `---
tags: [order]
name: "${this.data.name}"
type: "${this.data.type}"
supplier: "${this.data.supplier}"
catalog: "${this.data.catalog}"
amount: "${this.data.amount}"
price: "${this.data.price}"
status: "Planned"
requester: "Current User"
order_date: ""
receive_date: ""
---
# ${this.data.name} Request

## 🔗 Links / Quotes
- [Product Link]()

## 📝 Notes
- Why do we need this? 
`;
            const file = await this.app.vault.create(`${this.folder}/${safeName}.md`, content);
            this.app.workspace.getLeaf(false).openFile(file);
            new Notice("Order request created!");
            this.close();
        }));
    }
    onClose() { this.contentEl.empty(); }
}
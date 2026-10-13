// SharedBase.ts
import { App, Modal, Notice, requestUrl, TFile } from 'obsidian';
import { CreateExperimentModal, createNewElnExperiment } from './SharedEln';
import { ChemDataEngine } from './ChemDataEngine';

export class ChemDatabaseRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderDatabase(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml } = require('obsidian');
        let config: any = {};
        try { config = parseYaml(source); } catch (e) { config = { type: 'library', folder: '', layout: 'table' }; }

        const folderPath = config.folder || config.path || "";
        const dbType = config.type || "library"; // "library", "inventory", "eln", "equipment"
        const layout = config.layout || "table"; // "table" or "grid"

        if (!folderPath) {
            el.createEl("div", { text: "⚠️ Please specify a folder (e.g., path: Library/)", cls: "color-text-error" });
            return;
        }

        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            const errWrap = el.createDiv();
            errWrap.createEl("span", { text: `Folder not found: ${folderPath}. `, cls: "color-text-error" });
            const createBtn = errWrap.createEl("button", { text: "Create Folder", attr: { style: "padding: 2px 8px; font-size: 11px;" }});
            createBtn.onclick = async () => {
                await this.plugin.app.vault.createFolder(folderPath);
                new Notice(`Created folder: ${folderPath}`);
                this.renderDatabase(source, el, ctx); 
            };
            return;
        }

        const wrapper = el.createDiv();
        wrapper.style.border = "1px solid var(--background-modifier-border)";
        wrapper.style.borderRadius = "8px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.overflow = "hidden";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.marginTop = "10px";

        // --- TOOLBAR ---
        const toolbar = wrapper.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); flex-wrap: wrap; gap: 10px;" }});
        
        let titleText = "📚 Compound Library";
        if (dbType === 'inventory') titleText = "📦 Chemical Inventory";
        else if (dbType === 'equipment') titleText = "🔬 Lab Equipment Tracker";
        else if (dbType === 'eln') titleText = "🧪 ELN Database";
        
        toolbar.createEl("h3", { text: titleText, attr: { style: "margin: 0; font-size: 16px; font-weight: 600;" }});

        const rightTools = toolbar.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center; flex-wrap: wrap;" }});
        
        const activeSearchBadge = rightTools.createDiv({ attr: { style: "display: none; align-items: center; gap: 5px; background: var(--interactive-accent); color: var(--text-on-accent); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;" }});
        activeSearchBadge.innerHTML = `<span>⬡ Substructure Active</span><button style="background:transparent; border:none; color:inherit; padding:0; height:auto; cursor:pointer;">✖</button>`;
        const clearBadgeBtn = activeSearchBadge.querySelector("button") as HTMLElement;

        let isSubstructActive = false;
        let currentQuery = "";
        const rows: { el: HTMLElement, text: string, smiles: string }[] = [];

        const searchInput = rightTools.createEl("input", { 
            type: "search", 
            placeholder: "Search database...", 
            attr: { style: "width: 220px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" } 
        });

        const applyFilters = () => {
            const textQuery = searchInput.value.toLowerCase();
            rows.forEach(r => {
                let textMatch = r.text.includes(textQuery);
                let subMatch = true;
                if (isSubstructActive && currentQuery) {
                    subMatch = ChemDataEngine.isSubstructureMatch(r.smiles, currentQuery);
                }
                r.el.style.display = (textMatch && subMatch) ? "" : "none";
            });
        };

        if (dbType !== 'equipment') {
            const smartsBtn = rightTools.createEl("button", { text: "⬡ Substructure", attr: { style: "font-size: 12px; height: 28px;" }});
            smartsBtn.onclick = async () => {
                this.plugin.openKetcherModal("", "smiles", (query: string) => {
                    if (!query || query.trim() === "") return;
                    currentQuery = query;
                    isSubstructActive = true;
                    activeSearchBadge.style.display = "flex";
                    applyFilters();
                });
            };
        }
        
        const addBtn = rightTools.createEl("button", { text: "➕ Add Item", cls: "mod-cta", attr: { style: "font-size: 12px; height: 28px;" }});

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension === 'md');

        // --- GRID LAYOUT ---
        if (layout === 'grid' || layout === 'cards') {
            const gridContainer = wrapper.createDiv({ attr: { style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 16px; max-height: 600px; overflow-y: auto; background: var(--background-primary-alt);" }});
            
            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                const content = await this.plugin.app.vault.cachedRead(file);
                let smiles = fm.smiles || this.extractSmilesFromContent(content);
                
                if (dbType === 'eln') {
                    const blockMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
                    if (!blockMatch) continue;
                    const elnData = parseYaml(blockMatch[1]);
                    const rctSmiles = elnData.reactants?.[0]?.smiles || "";
                    const prdSmiles = elnData.products?.[0]?.smiles || "";
                    smiles = prdSmiles || rctSmiles; 
                    fm.name = elnData.code || file.basename;
                    fm.formula = elnData.status || "Planned";
                    fm.mw = fm.date || "";
                } else if (dbType === 'equipment') {
                    smiles = ""; // Equipment doesn't need structures
                } else if (!smiles) continue;

                const card = gridContainer.createDiv({ attr: { style: "border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; background: var(--background-primary); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; flex-direction: column;" }});
                card.onmouseover = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 6px 12px rgba(0,0,0,0.1)"; card.style.borderColor = "var(--interactive-accent)"; };
                card.onmouseout = () => { card.style.transform = "translateY(0)"; card.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)"; card.style.borderColor = "var(--background-modifier-border)"; };
                card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                if (dbType !== 'equipment') {
                    const previewWrapper = card.createDiv({ attr: { style: "height: 160px; display: flex; align-items: center; justify-content: center; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); padding: 10px;" }});
                    previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳</span>`;
                    
                    requestAnimationFrame(async () => {
                        const originalW = this.plugin.settings.width; const originalH = this.plugin.settings.height;
                        this.plugin.settings.width = 200; this.plugin.settings.height = 140;
                        try {
                            let previewEl;
                            try {
                                previewEl = await this.plugin.renderMoleculeToPreview(smiles, 'smiles', false);
                            } catch {
                                if (smiles.includes('>>')) previewEl = await this.plugin.renderMoleculeToPreview(smiles.split('>>')[1], 'smiles', false);
                            }
                            previewWrapper.empty();
                            if (previewEl) { previewEl.style.maxWidth = '100%'; previewEl.style.maxHeight = '100%'; previewWrapper.appendChild(previewEl); } 
                            else previewWrapper.innerHTML = `<span class="color-text-muted">No structure</span>`;
                        } catch { previewWrapper.innerHTML = `❌`; }
                        finally { this.plugin.settings.width = originalW; this.plugin.settings.height = originalH; }
                    });
                }

                const details = card.createDiv({ attr: { style: "padding: 12px; display: flex; flex-direction: column; gap: 4px;" }});
                details.createEl("div", { text: fm.name || file.basename, attr: { style: "font-weight: 600; font-size: 14px; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" }});
                
                const metaRow = details.createDiv({ attr: { style: "display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);" }});
                if (dbType === 'equipment') {
                    metaRow.createEl("span", { text: fm.location || "Unassigned" });
                    metaRow.createEl("span", { text: fm.status || "Available" });
                } else {
                    metaRow.createEl("span", { text: fm.formula || "-" });
                    metaRow.createEl("span", { text: fm.mw ? `${fm.mw} g/mol` : "-" });
                }

                const searchableText = `${fm.name} ${fm.formula} ${smiles} ${file.basename} ${fm.location} ${fm.status}`.toLowerCase();
                rows.push({ el: card, text: searchableText, smiles: smiles });
            }

            if (rows.length === 0) gridContainer.createEl("div", { text: "No items found.", attr: { style: "grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted);" }});

        } else {
            // --- TABLE LAYOUT ---
            const tableContainer = wrapper.createDiv({ attr: { style: "overflow-x: auto; max-height: 500px; overflow-y: auto;" }});
            const table = tableContainer.createEl("table", { attr: { style: "width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;" }});
            const thead = table.createEl("thead", { attr: { style: "position: sticky; top: 0; background: var(--background-secondary); z-index: 2;" }});
            const tr = thead.createEl("tr");

            let columns = [];
            if (dbType === 'inventory') columns = ["Structure", "Name", "Location", "Amount", "Status", "Actions"];
            else if (dbType === 'equipment') columns = ["Instrument", "Location", "Status", "Booked By", "Last Maint.", "Actions"];
            else if (dbType === 'eln') columns = ["Code", "Reaction", "Status", "Date"];
            else columns = ["Structure", "Name", "MW", "Formula", "SMILES"];

            columns.forEach(text => tr.createEl("th", { text, attr: { style: "padding: 10px; border-bottom: 2px solid var(--background-modifier-border); font-weight: 600; color: var(--text-muted); white-space: nowrap;" }}));

            const tbody = table.createEl("tbody");

            for (const file of files) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                const content = await this.plugin.app.vault.cachedRead(file);

                const row = tbody.createEl("tr", { attr: { style: "border-bottom: 1px solid var(--background-modifier-border-hover); transition: background 0.2s;" }});
                row.onmouseover = () => row.style.backgroundColor = "var(--background-modifier-hover)";
                row.onmouseout = () => row.style.backgroundColor = "transparent";

                let searchableText = file.basename;

                // Inline Editing functionality
                const createEditableCell = (value: string, yamlKey: string, fallback: string) => {
                    const td = row.createEl("td", { attr: { style: "padding: 10px; cursor: text; min-width: 80px;" }});
                    td.innerText = value || fallback;
                    td.onclick = (e) => {
                        e.stopPropagation();
                        if (td.querySelector('input')) return;
                        const input = document.createElement('input');
                        input.value = value || "";
                        input.style.width = "100%"; input.style.padding = "2px 4px";
                        td.empty(); td.appendChild(input); input.focus();

                        const saveVal = async () => {
                            const newVal = input.value;
                            td.innerText = newVal || fallback;
                            if (newVal !== value) {
                                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => { frontmatter[yamlKey] = newVal; });
                                new Notice(`Updated ${yamlKey}`);
                            }
                        };
                        input.onblur = () => saveVal();
                        input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); };
                    };
                };

                let rowSmiles = "";

                if (dbType === 'equipment') {
                    const tdName = row.createEl("td", { text: fm.name || file.basename, attr: { style: "padding: 10px; font-weight: 600; cursor: pointer; color: var(--text-accent);" }});
                    tdName.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);
            
                    createEditableCell(fm.location, "location", "Unassigned");
                    
                    const statusColor = fm.status === 'In Use' ? 'var(--text-warning)' : fm.status === 'Maintenance' ? 'var(--text-error)' : 'var(--text-success)';
                    const displayStatus = fm.status || 'Available';
                    row.createEl("td", { innerHTML: `<span style="border: 1px solid ${statusColor}; color: ${statusColor}; padding: 2px 8px; border-radius: 12px; font-size: 11px;">${displayStatus}</span>`, attr: { style: "padding: 10px;" }});
                    
                    createEditableCell(fm.booked_by, "booked_by", "-");
                    createEditableCell(fm.last_maintenance, "last_maintenance", "-");
            
                    const actionTd = row.createEl("td", { attr: { style: "padding: 10px;" }});
                    const toggleBtn = actionTd.createEl("button", { text: displayStatus === 'Available' ? "Book" : "Release", attr: { style: "font-size: 10px; padding: 2px 6px;" }});
                    toggleBtn.onclick = async () => {
                        const newStatus = displayStatus === 'Available' ? 'In Use' : 'Available';
                        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => { frontmatter.status = newStatus; });
                        this.renderDatabase(source, el, ctx); 
                    };
            
                    searchableText += ` ${fm.name} ${fm.location} ${fm.status}`;
            
                } else if (dbType === 'inventory') {
                    if (!fm.smiles && !content.includes('smiles')) continue;
                    rowSmiles = fm.smiles || this.extractSmilesFromContent(content);
                    this.createStructureCell(row, rowSmiles, 'smiles', 90, 90);
                    
                    const tdName = row.createEl("td", { text: fm.name || file.basename, attr: { style: "padding: 10px; font-weight: 600; cursor: pointer; color: var(--text-accent);" }});
                    tdName.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);
            
                    createEditableCell(fm.location, "location", "-");
                    createEditableCell(fm.amount, "amount", "-");
            
                    const invStatus = fm.status || 'Available';
                    const invStatusColor = invStatus === 'Available' ? 'var(--text-success)' : 'var(--text-warning)';
                    row.createEl("td", { innerHTML: `<span style="color: ${invStatusColor}; font-weight: bold; font-size: 11px;">${invStatus}</span><br><span style="font-size:9px; color:var(--text-muted);">${fm.checked_out_by || ''}</span>`, attr: { style: "padding: 10px;" }});
            
                    const actionTd = row.createEl("td", { attr: { style: "padding: 10px; display: flex; gap: 4px; flex-direction: column;" }});
                    
                    const checkoutBtn = actionTd.createEl("button", { text: invStatus === 'Available' ? "📤 Check Out" : "📥 Return", attr: { style: "font-size: 10px; padding: 2px 6px;" }});
                    checkoutBtn.onclick = async () => {
                        const newStatus = invStatus === 'Available' ? 'Checked Out' : 'Available';
                        const user = newStatus === 'Checked Out' ? "Current User" : ""; 
                        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => { 
                            frontmatter.status = newStatus; 
                            frontmatter.checked_out_by = user;
                            frontmatter.last_updated = window.moment().format("YYYY-MM-DD");
                        });
                        this.renderDatabase(source, el, ctx);
                    };
            
                    const qrBtn = actionTd.createEl("button", { text: "🖨️ QR Label", attr: { style: "font-size: 10px; padding: 2px 6px;" }});
                    qrBtn.onclick = () => {
                        new QrCodeModal(this.plugin.app, file).open();
                    };
            
                    searchableText += ` ${fm.name} ${fm.location} ${fm.supplier}`;

                } else if (dbType === 'eln') {
                    const blockMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
                    if (!blockMatch) continue;
                    const elnData = parseYaml(blockMatch[1]);
                    
                    const rctSmiles = elnData.reactants?.[0]?.smiles || "";
                    const prdSmiles = elnData.products?.[0]?.smiles || "";
                    
                    if (rctSmiles && prdSmiles) rowSmiles = `${rctSmiles}>>${prdSmiles}`;
                    else rowSmiles = prdSmiles || rctSmiles;

                    const tdCode = row.createEl("td", { text: elnData.code || file.basename, attr: { style: "padding: 10px; font-weight: 600; cursor: pointer; color: var(--text-accent);" }});
                    tdCode.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                    if (rowSmiles) {
                        this.createStructureCell(row, rowSmiles, 'smiles', 150, 80);
                    } else {
                        row.createEl("td", { innerHTML: `<span class="color-text-muted">No structures</span>`, attr: { style: "padding: 10px; text-align: center;" }});
                    }
                    
                    const statusColor = elnData.status === 'Completed' ? 'var(--text-success)' : elnData.status === 'Failed' ? 'var(--text-error)' : 'var(--text-warning)';
                    row.createEl("td", { innerHTML: `<span style="border: 1px solid ${statusColor}; color: ${statusColor}; padding: 2px 8px; border-radius: 12px; font-size: 11px;">${elnData.status || '-'}</span>`, attr: { style: "padding: 10px;" }});
                    createEditableCell(fm.date, "date", "-");
                    
                    searchableText += ` ${elnData.code} ${elnData.status}`;

                } else {
                    if (!fm.smiles && !content.includes('smiles')) continue;
                    rowSmiles = fm.smiles || this.extractSmilesFromContent(content);
                    this.createStructureCell(row, rowSmiles, 'smiles', 100, 100);
                    
                    const tdName = row.createEl("td", { text: fm.name || file.basename, attr: { style: "padding: 10px; font-weight: 600; cursor: pointer; color: var(--text-accent);" }});
                    tdName.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                    row.createEl("td", { text: fm.mw || '-', attr: { style: "padding: 10px; color: var(--text-muted);" }});
                    row.createEl("td", { text: fm.formula || '-', attr: { style: "padding: 10px; color: var(--text-muted);" }});
                    
                    const tdSmiles = row.createEl("td", { attr: { style: "padding: 10px;" }});
                    const sCode = tdSmiles.createEl("code", { text: rowSmiles.length > 20 ? rowSmiles.substring(0,20)+'...' : rowSmiles, attr: { style: "font-size: 11px; cursor: copy;" }});
                    sCode.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(rowSmiles); new Notice("Copied SMILES!"); };

                    searchableText += ` ${fm.name} ${fm.formula} ${rowSmiles}`;
                }
                rows.push({ el: row, text: searchableText.toLowerCase(), smiles: rowSmiles });
            }

            if (rows.length === 0) tbody.createEl("tr").createEl("td", { text: "No items found.", attr: { colspan: columns.length, style: "padding: 20px; text-align: center; color: var(--text-muted);" }});
        }

        searchInput.addEventListener("input", () => applyFilters());

        clearBadgeBtn.onclick = () => {
            isSubstructActive = false; currentQuery = ""; activeSearchBadge.style.display = "none";
            applyFilters();
        };

        addBtn.onclick = () => {
            if (dbType === 'inventory') {
                new AddInventoryModal(this.plugin.app, this.plugin, folderPath, () => this.renderDatabase(source, el, ctx)).open();
            } else if (dbType === 'equipment') {
                this.createEquipmentFile(folderPath, () => this.renderDatabase(source, el, ctx));
            } else if (dbType === 'eln') {
                new CreateExperimentModal(this.plugin.app, this.plugin, this.plugin.settings.elnPrefix, folderPath, async (expCode: string) => {
                    await createNewElnExperiment(this.plugin.app, expCode, folderPath, this.plugin.settings.elnSections);
                    this.renderDatabase(source, el, ctx); 
                }).open();
            } else {
                addCompoundToLibrary(this.plugin.app, this.plugin, folderPath, () => this.renderDatabase(source, el, ctx));
            }
        };
    }

    async createEquipmentFile(folder: string, onComplete: () => void) {
        const name = "New Equipment " + window.moment().format("HHmmss");
        const safeName = name.replace(/[\\/:"*?<>|]/g, '_');
        const content = `---
tags: [equipment]
name: "${name}"
location: "Unassigned"
status: "Available"
booked_by: ""
last_maintenance: "${window.moment().format("YYYY-MM-DD")}"
---
# ${name}
**Operating Instructions / Notes:**
`;
        if (!await this.plugin.app.vault.adapter.exists(folder)) await this.plugin.app.vault.createFolder(folder);
        await this.plugin.app.vault.create(`${folder}/${safeName}.md`, content);
        new Notice("Equipment added!");
        onComplete();
    }

    extractSmilesFromContent(content: string): string {
        const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
        if (blockMatch) return blockMatch[1].trim();
        const inlineMatch = content.match(/\$smiles=([^\s]+)/);
        if (inlineMatch) return inlineMatch[1].trim();
        return "";
    }

    createStructureCell(row: HTMLElement, data: string, format: string, w: number, h: number) {
        const td = row.createEl("td", { attr: { style: `padding: 10px; width: ${w+20}px;` }});
        const previewWrapper = td.createDiv({ attr: { style: `width: ${w}px; height: ${h}px; display: flex; align-items: center; justify-content: center;` }});
        previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:10px;">⏳</span>`;
        
        requestAnimationFrame(async () => {
            const originalW = this.plugin.settings.width; const originalH = this.plugin.settings.height;
            this.plugin.settings.width = w; this.plugin.settings.height = h;
            try {
                let previewEl;
                try {
                    previewEl = await this.plugin.renderMoleculeToPreview(data, format, false);
                } catch {
                    if (data.includes('>>')) previewEl = await this.plugin.renderMoleculeToPreview(data.split('>>')[1], format, false);
                }
                previewWrapper.empty();
                if (previewEl) {
                    previewEl.style.maxWidth = '100%'; previewEl.style.maxHeight = '100%';
                    previewWrapper.appendChild(previewEl);
                } else previewWrapper.innerHTML = `<span class="color-text-muted">Error</span>`;
            } catch { previewWrapper.innerHTML = `<span class="color-text-muted">Error</span>`; }
            finally { this.plugin.settings.width = originalW; this.plugin.settings.height = originalH; }
        });
    }
}

export function addCompoundToLibrary(app: App, plugin: any, folder: string, onComplete: () => void, initialData: string = "") {
    plugin.openKetcherModal(initialData, "smiles", async (smi: string) => {
        let name = "Compound " + window.moment().format("HHmmss");
        let mw = 0; let formula = "";
        
        try {
            const chemData = ChemDataEngine.getPropertiesFromSmiles(smi);
            if (chemData) { mw = chemData.mw; formula = chemData.formula; }
            
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smi)}/property/Title/JSON`);
            if (res.status === 200) {
                const props = res.json.PropertyTable.Properties[0];
                name = props.Title || name;
            }
        } catch(e) {}
        
        const safeName = name.replace(/[\\/:"*?<>|]/g, '_');
        const content = `---
tags: [library]
name: "${name}"
formula: "${formula}"
mw: ${mw}
smiles: "${smi}"
---
# ${name}
\`\`\`smiles\n${smi}\n\`\`\`\n`;
        
        if (!await app.vault.adapter.exists(folder)) await app.vault.createFolder(folder);
        
        await app.vault.create(`${folder}/${safeName}.md`, content);
        new Notice("Added to Library Database!");
        onComplete();
    });
}

export class AddInventoryModal extends Modal {
    plugin: any; folder: string; onComplete: () => void;
    data = { name: "", smiles: "", mw: 0, formula: "", location: "", amount: "", supplier: "", cas: "", lot: "", expiration: "", purity: "" };

    constructor(app: App, plugin: any, folder: string, onComplete: () => void) {
        super(app); this.plugin = plugin; this.folder = folder; this.onComplete = onComplete;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Add to Inventory" });
        
        const topRow = contentEl.createDiv({ attr: { style: "display:flex; gap: 10px; margin-bottom: 15px;" }});
        const nameInp = topRow.createEl("input", { type: "text", placeholder: "Chemical Name", attr: { style: "flex: 1;" }});
        nameInp.onchange = (e: any) => this.data.name = e.target.value;
        
        const autoBtn = topRow.createEl("button", { text: "🔍 Auto-Fill from Name" });
        autoBtn.onclick = () => this.autoFillFromName();

        const grid = contentEl.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;" }});
        const addInput = (label: string, key: keyof typeof this.data) => {
            const w = grid.createDiv(); w.createEl("div", { text: label, cls: "color-text-muted", attr: { style: "font-size:12px;"}});
            const i = w.createEl("input", { type: "text", value: this.data[key]?.toString(), attr: { style: "width:100%;" }});
            i.onchange = (e: any) => (this.data as any)[key] = e.target.value;
            return i;
        };
        
        addInput("SMILES String", "smiles"); addInput("Location (e.g. Cabinet 3)", "location"); 
        addInput("Amount (e.g. 500 mL)", "amount"); addInput("Supplier", "supplier"); 
        addInput("CAS Number", "cas"); addInput("Lot Number", "lot"); 
        addInput("Purity", "purity"); addInput("Expiration", "expiration");

        const botRow = contentEl.createDiv({ attr: { style: "display:flex; justify-content:flex-end; gap:10px;" }});
        const cancel = botRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        const save = botRow.createEl("button", { text: "Save Item", cls: "mod-cta" });
        save.onclick = async () => {
            if (!this.data.name) { new Notice("Name required"); return; }
            const safeName = this.data.name.replace(/[\\/:"*?<>|]/g, '_');
            const content = `---
tags: [inventory]
name: "${this.data.name}"
formula: "${this.data.formula}"
mw: ${this.data.mw || 0}
location: "${this.data.location}"
amount: "${this.data.amount}"
status: "Available"
checked_out_by: ""
supplier: "${this.data.supplier}"
cas: "${this.data.cas}"
lot: "${this.data.lot}"
purity: "${this.data.purity}"
expiration: "${this.data.expiration}"
smiles: "${this.data.smiles}"
---
# ${this.data.name}
\`\`\`smiles\n${this.data.smiles || "C"}\n\`\`\`
`;
            try {
                if (!await this.plugin.app.vault.adapter.exists(this.folder)) await this.plugin.app.vault.createFolder(this.folder);
                await this.plugin.app.vault.create(`${this.folder}/${safeName}.md`, content);
                new Notice("Item added to inventory!");
                this.onComplete(); this.close();
            } catch (e: any) {
                new Notice(`File creation failed: ${e.message}`);
            }
        };
    }

    async autoFillFromName() {
        if (!this.data.name) return;
        new Notice("Fetching data...");
        try {
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(this.data.name)}/property/IsomericSMILES,MolecularWeight,MolecularFormula/JSON`);
            if (res.status === 200) {
                const props = res.json.PropertyTable.Properties[0];
                this.data.smiles = props.IsomericSMILES || "";
                this.data.mw = parseFloat(props.MolecularWeight);
                this.data.formula = props.MolecularFormula;
                this.contentEl.empty(); this.onOpen(); 
                new Notice("Auto-fill successful!");
            }
        } catch(e) {
            new Notice("Could not find chemical data.");
        }
    }
    onClose() { this.contentEl.empty(); }
}

export class QrCodeModal extends Modal {
    file: TFile;
    qrDataUrl: string = "";

    constructor(app: App, file: TFile) {
        super(app);
        this.file = file;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const vaultName = encodeURIComponent(this.app.vault.getName());
        const filePath = encodeURIComponent(this.file.path);
        const obsidianUri = `obsidian://open?vault=${vaultName}&file=${filePath}`;

        contentEl.createEl("h3", { text: "Print Sample Label", attr: { style: "text-align: center; margin-bottom: 5px;" }});
        contentEl.createEl("p", { text: this.file.basename, attr: { style: "text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 0;" }});

        const qrContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: center; padding: 20px; background: white; border-radius: 8px; width: 200px; margin: 0 auto 20px auto;" }});
        
        try {
            // Stub QR Code output securely until npm 'qrcode' is included in project
            // this.qrDataUrl = await QRCode.toDataURL(obsidianUri, { width: 150, margin: 1 });
            // qrContainer.createEl("img", { attr: { src: this.qrDataUrl, width: "150", height: "150" }});
            qrContainer.createEl("span", { text: "QR code functionality coming soon.", attr: { style: "color: var(--text-muted); font-size: 11px; text-align: center;" }});
        } catch (err) {
            qrContainer.createEl("span", { text: "Failed to generate QR code offline.", cls: "color-text-error" });
        }

        const printBtn = contentEl.createEl("button", { text: "Print Label", cls: "mod-cta", attr: { style: "width: 100%;" }});
        printBtn.onclick = () => {
            if (!this.qrDataUrl) {
                new Notice("QR code not generated yet.");
                return;
            }
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(`
                    <html><head><title>Print Label</title></head>
                    <body style="display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
                        <div style="text-align:center; font-family:sans-serif;">
                            <img src="${this.qrDataUrl}" width="100" height="100" />
                            <div style="font-size:10px; margin-top:5px; font-weight:bold;">${this.file.basename}</div>
                        </div>
                        <script>window.onload = function() { window.print(); window.close(); }</script>
                    </body></html>
                `);
                printWindow.document.close();
            }
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// Dashboards
export function renderLimsNav(parent: HTMLElement, activeTab: string, plugin: any) {
    const navSwitcher = parent.createDiv({ attr: { style: "display: flex; gap: 20px; margin-bottom: 12px; flex-wrap: wrap;" }});
    const s = plugin.settings;
    
    const makeNav = (text: string, id: string, onClick: () => void) => {
        const isActive = id === activeTab;
        const el = navSwitcher.createEl("span", { text, attr: { style: `font-size: 13px; font-weight: ${isActive ? '700' : '600'}; color: ${isActive ? 'var(--text-normal)' : 'var(--text-muted)'}; border-bottom: 2px solid ${isActive ? 'var(--interactive-accent)' : 'transparent'}; cursor: ${isActive ? 'default' : 'pointer'}; transition: color 0.2s; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;` }});
        if (!isActive) {
            el.onmouseover = () => el.style.color = "var(--text-normal)";
            el.onmouseout = () => el.style.color = "var(--text-muted)";
            el.onclick = onClick;
        }
    };

    if (s.enableElnDashboard) makeNav("🧪 ELN", "eln", () => plugin.activateElnDashboard());
    if (s.enableOrdersDashboard) makeNav("🛒 Orders", "orders", () => plugin.activateOrdersDashboard());
    if (s.enableInventoryDashboard) makeNav("📦 Inventory", "inventory", () => plugin.activateInventoryDashboard());
    if (s.enableEquipmentDashboard) makeNav("🔬 Equipment", "equipment", () => plugin.activateEquipmentDashboard());
    if (s.enableProtocolsDashboard) makeNav("📄 Protocols", "protocols", () => plugin.activateProtocolsDashboard());
    if (s.enableLibraryDashboard) makeNav("📚 Library", "library", () => plugin.activateLibraryDashboard());
    if (s.enableGalleryDashboard) makeNav("🖼️ Gallery", "gallery", () => plugin.activateGalleryDashboard());
    if (s.enableCharacterizationDashboard) makeNav("📊 Data", "data", () => plugin.activateCharacterizationDashboard());
}
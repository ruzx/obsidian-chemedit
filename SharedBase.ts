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
        const dbType = config.type || "library"; // "library", "inventory", "eln"
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
        
        const titleText = dbType === 'inventory' ? "📦 Chemical Inventory" : dbType === 'eln' ? "🧪 ELN Database" : "📚 Compound Library";
        toolbar.createEl("h3", { text: titleText, attr: { style: "margin: 0; font-size: 16px; font-weight: 600;" }});

        const rightTools = toolbar.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center; flex-wrap: wrap;" }});
        
        const activeSearchBadge = rightTools.createDiv({ attr: { style: "display: none; align-items: center; gap: 5px; background: var(--interactive-accent); color: var(--text-on-accent); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;" }});
        activeSearchBadge.innerHTML = `<span>⬡ Substructure Active</span><button style="background:transparent; border:none; color:inherit; padding:0; height:auto; cursor:pointer;">✖</button>`;
        const clearBadgeBtn = activeSearchBadge.querySelector("button") as HTMLElement;

        const smartsBtn = rightTools.createEl("button", { text: "⬡ Substructure", attr: { style: "font-size: 12px; height: 28px;" }});
        const searchInput = rightTools.createEl("input", { 
            type: "search", 
            placeholder: "Search name, SMILES, formula...", 
            attr: { style: "width: 220px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" } 
        });
        const addBtn = rightTools.createEl("button", { text: "➕ Add Item", cls: "mod-cta", attr: { style: "font-size: 12px; height: 28px;" }});

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension === 'md');
        const rows: { el: HTMLElement, text: string, smiles: string }[] = [];

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
                } else if (!smiles) continue;

                const card = gridContainer.createDiv({ attr: { style: "border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; background: var(--background-primary); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; flex-direction: column;" }});
                card.onmouseover = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 6px 12px rgba(0,0,0,0.1)"; card.style.borderColor = "var(--interactive-accent)"; };
                card.onmouseout = () => { card.style.transform = "translateY(0)"; card.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)"; card.style.borderColor = "var(--background-modifier-border)"; };
                card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

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

                const details = card.createDiv({ attr: { style: "padding: 12px; display: flex; flex-direction: column; gap: 4px;" }});
                details.createEl("div", { text: fm.name || file.basename, attr: { style: "font-weight: 600; font-size: 14px; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" }});
                
                const metaRow = details.createDiv({ attr: { style: "display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);" }});
                metaRow.createEl("span", { text: fm.formula || "-" });
                metaRow.createEl("span", { text: fm.mw ? `${fm.mw} g/mol` : "-" });

                const searchableText = `${fm.name} ${fm.formula} ${smiles} ${file.basename}`.toLowerCase();
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
            if (dbType === 'inventory') columns = ["Structure", "Name", "Location", "Amount", "Supplier", "Purity", "Lot", "Exp."];
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

                if (dbType === 'eln') {
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

                } else if (dbType === 'inventory') {
                    if (!fm.smiles && !content.includes('smiles')) continue;
                    rowSmiles = fm.smiles || this.extractSmilesFromContent(content);
                    this.createStructureCell(row, rowSmiles, 'smiles', 90, 90);
                    
                    const tdName = row.createEl("td", { text: fm.name || file.basename, attr: { style: "padding: 10px; font-weight: 600; cursor: pointer; color: var(--text-accent);" }});
                    tdName.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                    createEditableCell(fm.location, "location", "-");
                    createEditableCell(fm.amount, "amount", "-");
                    createEditableCell(fm.supplier, "supplier", "-");
                    createEditableCell(fm.purity, "purity", "-");
                    createEditableCell(fm.lot, "lot", "-");
                    createEditableCell(fm.expiration, "expiration", "-");
                    searchableText += ` ${fm.name} ${fm.location} ${fm.supplier}`;

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

        // --- FILTER ENGINE (TEXT & SMART OFFLINE SUBSTRUCTURE) ---
        let isSubstructActive = false;
        let currentQuery = "";

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

        searchInput.addEventListener("input", () => applyFilters());

        clearBadgeBtn.onclick = () => {
            isSubstructActive = false; currentQuery = ""; activeSearchBadge.style.display = "none";
            applyFilters();
        };

        smartsBtn.onclick = async () => {
            this.plugin.openKetcherModal("", "smiles", (query: string) => {
                if (!query || query.trim() === "") return;
                currentQuery = query;
                isSubstructActive = true;
                activeSearchBadge.style.display = "flex";
                applyFilters();
            });
        };

        addBtn.onclick = () => {
            if (dbType === 'inventory') {
                new AddInventoryModal(this.plugin.app, this.plugin, folderPath, () => this.renderDatabase(source, el, ctx)).open();
            } else if (dbType === 'eln') {
                // FIXED Auto-Increment parameters
                new CreateExperimentModal(this.plugin.app, this.plugin, this.plugin.settings.elnPrefix, folderPath, async (expCode: string) => {
                    await createNewElnExperiment(this.plugin.app, expCode, folderPath, this.plugin.settings.elnSections);
                    this.renderDatabase(source, el, ctx); 
                }).open();
            } else {
                addCompoundToLibrary(this.plugin.app, this.plugin, folderPath, () => this.renderDatabase(source, el, ctx));
            }
        };
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
        
        // Ensure folder exists before saving
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
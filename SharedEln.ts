// SharedEln.ts
import { App, Modal, Notice, requestUrl, MarkdownView } from 'obsidian';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';

export class SharedElnRenderer {
    app: App;
    mediaSavePath: string;

    constructor(app: App, mediaSavePath: string) {
        this.app = app;
        this.mediaSavePath = mediaSavePath;
    }

    async renderElnBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        wrapper.style.position = "relative"; 
        wrapper.style.border = "1px solid var(--background-modifier-border)";
        wrapper.style.padding = "35px 15px 15px 15px"; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Calculating...</h3>`;

        try {
            const data = parseYaml(source);
            if (!data.reactants) data.reactants = [];
            if (!data.products) data.products = [];

            wrapper.innerHTML = '';

            // --- ACTION BAR ---
            const actionBar = wrapper.createDiv();
            actionBar.style.position = "absolute"; actionBar.style.top = "8px"; actionBar.style.right = "10px";
            actionBar.style.display = "flex"; actionBar.style.gap = "5px"; actionBar.style.zIndex = "10";

            const createBtn = (text: string, title: string, onClick: () => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.title = title; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 8px";
                btn.style.backgroundColor = "var(--background-secondary)"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-normal)"; btn.style.borderRadius = "4px";
                btn.onclick = onClick; return btn;
            };

            const appendBelowBlock = (text: string) => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const info = ctx.getSectionInfo(el);
                if (info) { view.editor.replaceRange(`\n${text}\n`, {line: info.lineEnd + 1, ch: 0}); }
            };

            createBtn("📷 Photo", "Add Photo", () => {
                takeStandardPhoto(async (buffer, ext) => {
                    const link = await saveMediaFile(this.app, buffer, this.mediaSavePath, `Photo_${window.moment().format("YYYYMMDD_HHmmss")}.${ext}`);
                    appendBelowBlock(`![[${link}]]`); new Notice("Photo appended below reaction block.");
                });
            });

            createBtn("🧪 TLC", "Add Digital TLC", () => {
                new TlcModal(this.app, async (pngData, rfData) => {
                    const link = await saveMediaFile(this.app, pngData, this.mediaSavePath, `TLC_${window.moment().format("YYYYMMDD_HHmmss")}.png`);
                    let md = `![[${link}]]\n\n| Spot | $R_f$ |\n|---|---|\n`;
                    rfData.forEach((s, i) => md += `| ${i+1} | **${s.rf.toFixed(2)}** |\n`);
                    appendBelowBlock(md); new Notice("TLC appended below reaction block.");
                }).open();
            });

            createBtn("📝 Edit", "Edit Metadata", () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const info = ctx.getSectionInfo(el);
                if (info) {
                    new ElnMetaEditorModal(this.app, data, (updatedYamlObj) => {
                        const newYaml = stringifyYaml(updatedYamlObj);
                        const blockText = `\`\`\`eln\n${newYaml}\`\`\``;
                        view.editor.replaceRange(blockText, {line: info.lineStart, ch: 0}, {line: info.lineEnd, ch: view.editor.getLine(info.lineEnd).length});
                    }).open();
                }
            });

            const fetchChemProps = async (smiles: string) => {
                try {
                    const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/MolecularWeight,MolecularFormula/JSON`);
                    const props = res.json.PropertyTable.Properties[0];
                    return { mw: parseFloat(props.MolecularWeight), formula: props.MolecularFormula };
                } catch { return { mw: 0, formula: "Unknown" }; }
            };

            for (const r of data.reactants) {
                if (r.smiles && (!r.mw || !r.formula)) { const p = await fetchChemProps(r.smiles); r.mw = r.mw || p.mw; r.formula = r.formula || p.formula; }
            }
            for (const p of data.products) {
                if (p.smiles && (!p.mw || !p.formula)) { const p2 = await fetchChemProps(p.smiles); p.mw = p.mw || p2.mw; p.formula = p.formula || p2.formula; }
            }

            let refMmol = data.reference_amount || 0;
            if (refMmol === 0) {
                const baseR = data.reactants.find((r: any) => r.eq === 1 && r.mass);
                if (baseR && baseR.mw) refMmol = baseR.mass / baseR.mw;
            }

            data.reactants.forEach((r: any) => {
                r.eq = r.eq || 1; r.mmol = r.mmol || (refMmol * r.eq);
                if (!r.mass && r.mw) r.mass = r.mmol * r.mw;
                if (r.mass && r.density) r.volume = (r.mass / 1000) / r.density;
            });
            data.products.forEach((p: any) => {
                p.eq = p.eq || 1; p.theory_mmol = refMmol * p.eq; p.theory_mass = p.theory_mmol * p.mw;
                if (p.mass_isolated) { p.yield = ((p.mass_isolated / p.theory_mass) * 100).toFixed(1); p.mmol_isolated = p.mass_isolated / p.mw; }
            });

            const thColor = "var(--background-secondary-alt)"; 
            const bdColor = "var(--background-modifier-border-hover)";
            const textColor = "var(--text-normal)";

            let html = `<div style="font-size: 14px; color: ${textColor}; margin-top:5px;">`;
            html += `<div style="border-bottom: 2px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 20px;"><h2 style="margin: 0; font-size: 20px; font-weight: 700;">${data.code || data.id || 'Reaction Scheme'}</h2></div>`;

            html += `<div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; padding: 15px; margin-bottom: 20px; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--background-modifier-border);">`;
            data.reactants.forEach((r: any, i: number) => {
                if(i > 0) html += `<div style="font-size: 20px; font-weight: bold; color: var(--text-muted);">+</div>`;
                html += `<div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="eln-structure scheme-size" data-type="reactants" data-index="${i}" data-smiles="${r.smiles || ''}" style="width:110px; height:110px; cursor:pointer;" title="Double-click to edit"></div>
                    <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">${r.eq || 1} eq</div>
                </div>`;
            });
            html += `<div style="display: flex; flex-direction: column; align-items: center; margin: 10px;">
                <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.temperature || ''}</div>
                <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.duration || ''}</div>
                <div style="font-size: 28px; font-weight: bold; line-height: 0.8; margin: 4px 0;">⟶</div>
                <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.solvent || ''}</div>
            </div>`;
            data.products.forEach((p: any, i: number) => {
                if(i > 0) html += `<div style="font-size: 20px; font-weight: bold; color: var(--text-muted);">+</div>`;
                html += `<div style="display: flex; flex-direction: column; align-items: center;">
                    <div class="eln-structure scheme-size" data-type="products" data-index="${i}" data-smiles="${p.smiles || ''}" style="width:110px; height:110px; cursor:pointer;" title="Double-click to edit"></div>
                    <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">${p.eq || 1} eq</div>
                </div>`;
            });
            html += `</div>`;

            html += `<div style="display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 15px; background: var(--background-secondary-alt); padding: 10px 15px; border-radius: 6px; margin-bottom: 25px; font-size: 13px;">
                <div style="flex: 1 1 100px;"><b style="color:var(--text-muted);">Duration:</b> ${data.duration || '-'}</div>
                <div style="flex: 1 1 100px;"><b style="color:var(--text-muted);">Solvent:</b> ${data.solvent || '-'}</div>
                <div style="flex: 1 1 100px;"><b style="color:var(--text-muted);">Temp:</b> ${data.temperature || '-'}</div>
            </div>`;
            
            html += `<h4 style="margin-bottom: 10px; margin-top: 0;">Reactants</h4>
                <div style="width: 100%; overflow-x: auto; margin-bottom: 30px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 650px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">Formula</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">m [mg]</th><th style="padding: 10px;">V [ml]</th>
                    </tr>`;
            data.reactants.forEach((r: any, i: number) => {
                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    <td style="padding: 10px; font-weight:500;">${r.eq || '-'}</td>
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="reactants" data-index="${i}" data-smiles="${r.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    <td style="padding: 10px;"><b>${r.name || '-'}</b></td>
                    <td style="padding: 10px; color:var(--text-muted);">${r.formula || '-'}</td>
                    <td style="padding: 10px; color:var(--text-muted);">${r.mw ? r.mw.toFixed(2) : '-'}</td>
                    <td style="padding: 10px;">${r.mmol ? r.mmol.toFixed(2) : '-'}</td>
                    <td style="padding: 10px;">${r.mass ? r.mass.toFixed(1) : '-'}</td>
                    <td style="padding: 10px;">${r.volume ? r.volume.toFixed(3) : '-'}</td>
                </tr>`;
            });
            
            html += `</table></div><h4 style="margin-bottom: 10px;">Products</h4>
                <div style="width: 100%; overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 600px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">m [mg]</th><th style="padding: 10px;">Yield [%]</th>
                    </tr>`;
            data.products.forEach((p: any, i: number) => {
                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    <td style="padding: 10px; font-weight:500;">${p.eq || '-'}</td>
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="products" data-index="${i}" data-smiles="${p.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    <td style="padding: 10px;"><b>${p.name || '-'}</b></td>
                    <td style="padding: 10px; color:var(--text-muted);">${p.mw ? p.mw.toFixed(2) : '-'}</td>
                    <td style="padding: 10px;">${p.mmol_isolated ? p.mmol_isolated.toFixed(2) : (p.theory_mmol ? p.theory_mmol.toFixed(2) : '-')}</td>
                    <td style="padding: 10px;">${p.mass_isolated ? p.mass_isolated.toFixed(1) : '-'}</td>
                    <td style="padding: 10px; font-size: 14px; color: var(--text-success);"><b>${p.yield ? p.yield + '%' : '-'}</b></td>
                </tr>`;
            });
            html += `</table></div>`;

            if (data.procedure || data.notes) {
                html += `<div style="margin-top: 20px; padding: 15px; background: var(--background-secondary); border-radius: 8px; border-left: 4px solid var(--interactive-accent);">
                    <b style="display: block; margin-bottom: 5px;">Procedure / Notes:</b>
                    <div style="color: var(--text-muted); white-space: pre-wrap; font-size: 13px;">${data.procedure || data.notes}</div>
                </div>`;
            }
            html += `</div>`;
            
            const contentDiv = wrapper.createDiv();
            contentDiv.innerHTML = html;
            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>ELN Formatting Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}

// ------------------------------------------------------------------
// ELN META EDITOR MODAL (MOBILE RESPONSIVE UI FIX)
// ------------------------------------------------------------------
export class ElnMetaEditorModal extends Modal {
    data: any; onSave: (updated: any) => void;
    constructor(app: App, yamlObj: any, onSave: (updated: any) => void) {
        super(app); this.data = JSON.parse(JSON.stringify(yamlObj));
        if (!this.data.reactants) this.data.reactants = [];
        if (!this.data.products) this.data.products = [];
        this.onSave = onSave;
    }

    async fetchNameFromSmiles(smiles: string): Promise<string> {
        try {
            const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/Title/JSON`;
            const res = await requestUrl({ url });
            if (res.status === 200) return res.json.PropertyTable.Properties[0].Title;
        } catch(e) {
            try {
                const url2 = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/iupac_name`;
                const res2 = await requestUrl({ url: url2 });
                if (res2.status === 200) return res2.text.trim();
            } catch(err) { }
        }
        return "";
    }
    
    onOpen() { this.render(); }
    
    render() {
        const { contentEl } = this; contentEl.empty();
        
        // --- HEADER ---
        const header = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;" }});
        header.createEl("h2", { text: "Edit ELN", attr: { style: "margin: 0; font-size: 1.2em;" } });
        const saveBtn = header.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { this.onSave(this.data); this.close(); };

        // --- META GRID ---
        const metaGrid = contentEl.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;" }});
        const addInput = (parent: HTMLElement, label: string, key: string, placeholder = "") => {
            const wrap = parent.createDiv(); wrap.createEl("div", { text: label, cls: "color-text-muted", attr: { style: "font-size:12px; margin-bottom:3px;"} });
            const inp = wrap.createEl("input", { type: "text", value: this.data[key] || "", attr: { style: "width:100%;", placeholder } });
            inp.onchange = (e: any) => this.data[key] = e.target.value;
        };
        addInput(metaGrid, "Reaction Code", "code"); addInput(metaGrid, "Solvent", "solvent");
        addInput(metaGrid, "Temperature", "temperature"); addInput(metaGrid, "Duration", "duration");

        contentEl.createEl("div", { text: "Procedure", cls: "color-text-muted", attr: { style: "font-size:12px; margin-bottom:3px;"} });
        // Fixed margins to prevent clipping
        const procArea = contentEl.createEl("textarea", { attr: { style: "width:100%; min-height: 80px; margin-bottom:24px; font-family: var(--font-interface); resize: vertical;" } });
        procArea.value = this.data.procedure || ""; procArea.onchange = (e: any) => this.data.procedure = e.target.value;

        // --- ROW RENDERER (Fully stacked with tiny labels) ---
        const renderChemRow = (item: any, type: 'reactants'|'products', idx: number) => {
            const row = contentEl.createDiv({ attr: { style: "background: var(--background-secondary-alt); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 10px;" }});
            
            // Name Input
            const nameInp = row.createEl("input", { type: "text", value: item.name || "", attr: { placeholder: "Chemical Name", style: "width: 100%; font-weight: bold;" }});
            nameInp.onchange = (e: any) => item.name = e.target.value;
            
            // Action Buttons Row
            const actionRow = row.createDiv({ attr: { style: "display: flex; gap: 8px; justify-content: flex-start;" }});
            const fetchBtn = actionRow.createEl("button", { text: "🔍 Auto-Name" });
            fetchBtn.onclick = async () => {
                if (!item.smiles) { new Notice("Draw a structure first."); return; }
                fetchBtn.innerText = "⏳...";
                const fetched = await this.fetchNameFromSmiles(item.smiles);
                if (fetched) { item.name = fetched; nameInp.value = fetched; }
                else { new Notice("Name not found."); }
                fetchBtn.innerText = "🔍 Auto-Name";
            };
            const delBtn = actionRow.createEl("button", { text: "🗑️ Remove", attr: { style: "color: var(--text-error);" }});
            delBtn.onclick = () => { this.data[type].splice(idx, 1); this.render(); };

            // Numbers Grid (With tiny labels instead of placeholders)
            const botRow = row.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;" }});
            const makeNumInp = (key: string, label: string) => {
                const wrap = botRow.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
                wrap.createEl("span", { text: label, attr: { style: "font-size: 10px; color: var(--text-muted); margin-bottom: 2px;" }});
                const inp = wrap.createEl("input", { type: "number", value: item[key] || "", attr: { style: "width: 100%;" }});
                inp.onchange = (e: any) => item[key] = parseFloat(e.target.value) || undefined;
            };
            
            if (type === 'reactants') { makeNumInp('eq', 'Eq'); makeNumInp('mass', 'Mass (mg)'); makeNumInp('density', 'Density'); } 
            else { makeNumInp('eq', 'Eq'); makeNumInp('mass_isolated', 'Yield (mg)'); }
        };

        const rHeader = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;" }});
        rHeader.createEl("h3", { text: "Reactants", attr: { style: "margin: 0; font-size: 1.1em;" } });
        const addRBtn = rHeader.createEl("button", { text: "+ Add Reactant" });
        addRBtn.onclick = () => { this.data.reactants.push({ name: "", smiles: "", eq: 1 }); this.render(); };
        this.data.reactants.forEach((r: any, idx: number) => renderChemRow(r, 'reactants', idx));

        const pHeader = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; margin-top: 20px;" }});
        pHeader.createEl("h3", { text: "Products", attr: { style: "margin: 0; font-size: 1.1em;" } });
        const addPBtn = pHeader.createEl("button", { text: "+ Add Product" });
        addPBtn.onclick = () => { this.data.products.push({ name: "", smiles: "", eq: 1 }); this.render(); };
        this.data.products.forEach((p: any, idx: number) => renderChemRow(p, 'products', idx));
        
        contentEl.createDiv({ attr: { style: "height: 50px;" } }); // padding for scrolling
    }
    onClose() { this.contentEl.empty(); }
}
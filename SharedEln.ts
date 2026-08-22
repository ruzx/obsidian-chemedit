// SharedEln.ts
import { App, Modal, Notice, requestUrl, MarkdownView, TFile, Menu } from 'obsidian';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';

export class SharedElnRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderElnBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        wrapper.style.position = "relative"; 
        wrapper.style.border = "1px solid var(--background-modifier-border)";
        wrapper.style.padding = "45px 15px 15px 15px"; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Calculating...</h3>`;

        try {
            const data = parseYaml(source);
            if (!data.reactants) data.reactants = [];
            if (!data.products) data.products = [];

            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const currentFile = view ? view.file : null;
            const expCode = data.code || (currentFile ? currentFile.basename : "EXP");
            const filePrefix = expCode ? `${expCode}_` : "";

            wrapper.innerHTML = '';

            // --- ACTION BAR ---
            const actionBar = wrapper.createDiv();
            actionBar.style.position = "absolute"; actionBar.style.top = "8px"; actionBar.style.right = "10px";
            actionBar.style.display = "flex"; actionBar.style.gap = "5px"; actionBar.style.zIndex = "10";
            actionBar.style.flexWrap = "wrap"; actionBar.style.justifyContent = "flex-end";

            const createBtn = (text: string, title: string, onClick: (e?: MouseEvent) => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.title = title; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 8px";
                btn.style.backgroundColor = "var(--background-secondary)"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-normal)"; btn.style.borderRadius = "4px";
                btn.onmouseover = () => btn.style.backgroundColor = "var(--background-modifier-hover)";
                btn.onmouseout = () => btn.style.backgroundColor = "var(--background-secondary)";
                btn.onclick = onClick; return btn;
            };

            const appendSmart = (text: string, keyword: string) => {
                if (!view) return;
                const editor = view.editor;
                const content = editor.getValue();
                const lines = content.split('\n');
                
                let targetLine = lines.findIndex((line: string) => line.includes(`- **${keyword}:**`));
                if (targetLine === -1 && keyword === "Procedure") targetLine = lines.findIndex((line: string) => line.includes(`## 📝 Procedure`));
                if (targetLine === -1) targetLine = lines.findIndex((line: string) => line.includes(`Analytical Data`));
                
                if (targetLine !== -1) {
                    editor.replaceRange(`\n${text}\n`, { line: targetLine, ch: editor.getLine(targetLine).length });
                } else {
                    const info = ctx.getSectionInfo(el);
                    if (info) editor.replaceRange(`\n${text}\n`, { line: info.lineEnd + 1, ch: 0 });
                }
            };

            // 1. MACROS MENU
            createBtn("⚡ Macros", "Insert useful text snippets", (e?: MouseEvent) => {
                if (!e) return;
                const menu = new Menu();
                menu.addItem((item) => item.setTitle("🕒 Insert Current Time").setIcon("clock").onClick(() => {
                    const time = window.moment().format("HH:mm");
                    appendSmart(`**[${time}]:** `, "Procedure");
                }));
                menu.addItem((item) => item.setTitle("🧪 Aqueous Workup (EtOAc)").setIcon("beaker").onClick(() => {
                    appendSmart(`The reaction mixture was quenched with saturated aqueous NaHCO3 and extracted with EtOAc (3x). The combined organic layers were washed with brine, dried over anhydrous Na2SO4, filtered, and concentrated in vacuo.`, "Procedure");
                }));
                menu.addItem((item) => item.setTitle("⚗️ Column Chromatography").setIcon("filter").onClick(() => {
                    appendSmart(`The crude residue was purified by flash column chromatography on silica gel (Hexanes/EtOAc) to afford the desired product.`, "Procedure");
                }));
                menu.showAtMouseEvent(e);
            });

            createBtn("📷 Photo", "Add Photo", () => {
                takeStandardPhoto(async (buffer, ext) => {
                    const filename = `${filePrefix}Photo_${window.moment().format("HHmmss")}.${ext}`;
                    const link = await saveMediaFile(this.plugin.app, buffer, this.plugin.settings.mediaSavePath, filename);
                    appendSmart(`![[${link}]]`, "Photo"); new Notice(`Added ${filename}`);
                });
            });

            createBtn("🧪 TLC", "Add Digital TLC", () => {
                new TlcModal(this.plugin.app, async (pngData, rfData) => {
                    const filename = `${filePrefix}TLC_${window.moment().format("HHmmss")}.png`;
                    const link = await saveMediaFile(this.plugin.app, pngData, this.plugin.settings.mediaSavePath, filename);
                    let md = `![[${link}]]\n\n| Spot | $R_f$ |\n|---|---|\n`;
                    rfData.forEach((s, i) => md += `| ${i+1} | **${s.rf.toFixed(2)}** |\n`);
                    appendSmart(md, "TLC"); new Notice(`Added ${filename}`);
                }).open();
            });

            createBtn("📋 Copy", "Copy Stoichiometry Table to Clipboard (Excel Ready)", () => {
                let tsv = "Type\tName\tSMILES\tEq\tMW\tm [mg]\tn [mmol]\tV [mL]\tYield [%]\n";
                data.reactants.forEach((r: any) => tsv += `Reactant\t${r.name||''}\t${r.smiles||''}\t${r.eq||'-'}\t${r.mw?.toFixed(2)||'-'}\t${r.mass?.toFixed(1)||'-'}\t${r.mmol?.toFixed(2)||'-'}\t${r.volume?.toFixed(3)||'-'}\t-\n`);
                data.products.forEach((p: any) => tsv += `Product\t${p.name||''}\t${p.smiles||''}\t${p.eq||'-'}\t${p.mw?.toFixed(2)||'-'}\t${p.mass_isolated?.toFixed(1)||'-'}\t${p.mmol_isolated?.toFixed(2)||'-'}\t-\t${p.yield||'-'}\n`);
                navigator.clipboard.writeText(tsv); new Notice("Table copied to clipboard! Paste into Excel.");
            });

            createBtn("🗐 Clone", "Duplicate this experiment into a new file", () => {
                new CloneExperimentModal(this.plugin.app, expCode, currentFile, data).open();
            });

            createBtn("📝 Edit", "Edit Metadata & Conditions", () => {
                if (!view) return;
                const info = ctx.getSectionInfo(el);
                if (info) {
                    new ElnMetaEditorModal(this.plugin, data, async (updatedYamlObj, shouldRename) => {
                        const newYaml = stringifyYaml(updatedYamlObj);
                        view.editor.replaceRange(`\`\`\`eln\n${newYaml}\`\`\``, {line: info.lineStart, ch: 0}, {line: info.lineEnd, ch: view.editor.getLine(info.lineEnd).length});
                        
                        if (shouldRename && currentFile && updatedYamlObj.code) {
                            const newName = updatedYamlObj.code.trim();
                            const folderPath = currentFile.parent?.path;
                            const newPath = (!folderPath || folderPath === "/") ? `${newName}.md` : `${folderPath}/${newName}.md`;
                            try {
                                await this.plugin.app.fileManager.renameFile(currentFile, newPath);
                                new Notice(`File renamed to ${newName}.md`);
                            } catch (e: any) { new Notice(`Note updated, but could not rename file.`); }
                        }
                    }).open();
                }
            });

            // --- CALCULATIONS ---
            const fetchChemProps = async (smiles: string) => {
                try {
                    const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/MolecularWeight,MolecularFormula/JSON`);
                    const props = res.json.PropertyTable.Properties[0];
                    return { mw: parseFloat(props.MolecularWeight), formula: props.MolecularFormula };
                } catch { return { mw: 0, formula: "Unknown" }; }
            };

            for (const r of data.reactants) { if (r.smiles && (!r.mw || !r.formula)) { const p = await fetchChemProps(r.smiles); r.mw = r.mw || p.mw; r.formula = r.formula || p.formula; } }
            for (const p of data.products) { if (p.smiles && (!p.mw || !p.formula)) { const p2 = await fetchChemProps(p.smiles); p.mw = p.mw || p2.mw; p.formula = p.formula || p2.formula; } }

            let limitingR = data.reactants.find((r: any) => r.is_limiting);
            if (!limitingR && data.reactants.length > 0) {
                limitingR = data.reactants.find((r: any) => r.eq === 1) || data.reactants[0];
                limitingR.is_limiting = true;
            }

            let refMmol = 0;
            if (limitingR) {
                if (limitingR.mmol) {
                    refMmol = limitingR.mmol / (limitingR.eq || 1);
                } else if (limitingR.mass && limitingR.mw) {
                    let pureMass = limitingR.mass * ((limitingR.purity || 100) / 100);
                    refMmol = (pureMass / limitingR.mw) / (limitingR.eq || 1);
                } else if (limitingR.volume && limitingR.molarity) {
                    refMmol = (limitingR.volume * limitingR.molarity) / (limitingR.eq || 1);
                }
            }

            data.reactants.forEach((r: any) => {
                r.eq = r.eq || 1;
                r.mmol = refMmol * r.eq;
                
                if (r.molarity) {
                    r.volume = r.mmol / r.molarity; 
                    r.mass = r.mmol * (r.mw || 0); 
                } else if (r.mw) {
                    let neededPureMass = r.mmol * r.mw;
                    r.mass = neededPureMass / ((r.purity || 100) / 100);
                    if (r.density) r.volume = (r.mass / 1000) / r.density;
                }
            });

            data.products.forEach((p: any) => {
                p.eq = p.eq || 1; p.theory_mmol = refMmol * p.eq; p.theory_mass = p.theory_mmol * p.mw;
                if (p.mass_isolated) { p.yield = ((p.mass_isolated / p.theory_mass) * 100).toFixed(1); p.mmol_isolated = p.mass_isolated / p.mw; }
            });

            const thColor = "var(--background-secondary-alt)"; 
            const bdColor = "var(--background-modifier-border-hover)";
            const textColor = "var(--text-normal)";

            let statusColor = "var(--text-muted)";
            if (data.status === "Completed") statusColor = "var(--text-success)";
            else if (data.status === "Running") statusColor = "var(--text-warning)";
            else if (data.status === "Failed") statusColor = "var(--text-error)";
            else if (data.status === "Planned") statusColor = "var(--text-accent)";
            
            const statusBadge = data.status && data.status !== "None" 
                ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 12px; background: var(--background-primary); border: 1px solid ${statusColor}; color: ${statusColor}; vertical-align: middle; margin-left: 10px; font-weight: 500;">${data.status}</span>` 
                : '';

            let html = `<div style="font-size: 14px; color: ${textColor}; margin-top:5px;">`;
            html += `<div style="border-bottom: 2px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center;">${expCode} ${statusBadge}</h2>
                     </div>`;

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
                        <th style="padding: 10px; text-align:center;">Type</th><th style="padding: 10px;">Eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">Purity/Conc.</th><th style="padding: 10px;">m [mg]</th><th style="padding: 10px;">V [ml]</th>
                    </tr>`;
            data.reactants.forEach((r: any, i: number) => {
                let concStr = "-";
                if (r.molarity) concStr = `${r.molarity} M`;
                else if (r.purity && r.purity !== 100) concStr = `${r.purity}%`;
                else if (r.purity === 100) concStr = `Pure`;

                const ghsStr = r.ghs && r.ghs.length > 0 ? `<span title="GHS Hazards">${r.ghs.join(' ')}</span>` : '';
                const lrIcon = r.is_limiting ? `<span style="background: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">LIMITING</span>` : "";

                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    <td style="padding: 10px; text-align:center;">${lrIcon}</td>
                    <td style="padding: 10px; font-weight:500;">${r.eq || '-'}</td>
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="reactants" data-index="${i}" data-smiles="${r.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    <td style="padding: 10px;"><b>${r.name || '-'}</b> &nbsp; ${ghsStr}</td>
                    <td style="padding: 10px; color:var(--text-muted);">${r.mw ? r.mw.toFixed(2) : '-'}</td>
                    <td style="padding: 10px;">${r.mmol ? r.mmol.toFixed(2) : '-'}</td>
                    <td style="padding: 10px; color:var(--text-muted);">${concStr}</td>
                    <td style="padding: 10px;">${r.mass ? r.mass.toFixed(1) : '-'}</td>
                    <td style="padding: 10px;">${r.volume ? r.volume.toFixed(3) : '-'}</td>
                </tr>`;
            });
            
            html += `</table></div><h4 style="margin-bottom: 10px;">Products</h4>
                <div style="width: 100%; overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 600px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">m [mg]</th><th style="padding: 10px;">Yield [%]</th>
                    </tr>`;
            data.products.forEach((p: any, i: number) => {
                const ghsStr = p.ghs && p.ghs.length > 0 ? `<span title="GHS Hazards">${p.ghs.join(' ')}</span>` : '';
                
                let yieldColor = "var(--text-normal)";
                if (p.yield) {
                    const yVal = parseFloat(p.yield);
                    if (yVal >= 90) yieldColor = "var(--text-success)";
                    else if (yVal <= 30) yieldColor = "var(--text-error)";
                    else yieldColor = "var(--text-warning)";
                }

                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    <td style="padding: 10px; font-weight:500;">${p.eq || '-'}</td>
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="products" data-index="${i}" data-smiles="${p.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    <td style="padding: 10px;"><b>${p.name || '-'}</b> &nbsp; ${ghsStr}</td>
                    <td style="padding: 10px; color:var(--text-muted);">${p.mw ? p.mw.toFixed(2) : '-'}</td>
                    <td style="padding: 10px;">${p.mmol_isolated ? p.mmol_isolated.toFixed(2) : (p.theory_mmol ? p.theory_mmol.toFixed(2) : '-')}</td>
                    <td style="padding: 10px;">${p.mass_isolated ? p.mass_isolated.toFixed(1) : '-'}</td>
                    <td style="padding: 10px; font-size: 14px; color: ${yieldColor};"><b>${p.yield ? p.yield + '%' : '-'}</b></td>
                </tr>`;
            });
            html += `</table></div>`;
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
// ELN GALLERY RENDERER
// ------------------------------------------------------------------
export class ElnGalleryRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }
    
    async renderGalleryBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml } = require('obsidian');
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";
        
        if (!folderPath) { el.createEl("div", { text: "⚠️ Please specify a folder path (e.g., path: Experiments/)", cls: "color-text-error" }); return; }
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { el.createEl("div", { text: `⚠️ Folder not found: ${folderPath}`, cls: "color-text-error" }); return; }

        const files = folder.children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        
        const header = el.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;" } });
        const countLabel = header.createDiv({ text: `Loading...`, attr: { style: "font-size: 13px; color: var(--text-muted); font-weight: 500;" } });
        const searchInput = header.createEl("input", { type: "search", placeholder: "Search experiments...", attr: { style: "width: 250px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary);" } });

        const container = el.createDiv({ cls: "chem-gallery-container" });
        container.style.display = "grid"; container.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))"; container.style.gap = "15px"; container.style.padding = "5px 0";

        const cards: { el: HTMLElement, text: string }[] = [];
        let renderCount = 0;

        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const blockMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
            if (!blockMatch) continue;
            
            try {
                const yamlObj = parseYaml(blockMatch[1]);
                let dataToRender = "";
                
                if (yamlObj.products && yamlObj.products.length > 0 && yamlObj.products[0].smiles) {
                    dataToRender = yamlObj.products[0].smiles;
                } else if (yamlObj.reactants && yamlObj.reactants.length > 0 && yamlObj.reactants[0].smiles) {
                    dataToRender = yamlObj.reactants[0].smiles;
                } else { continue; }
                
                const searchableText = `${file.name.toLowerCase()} ${yamlObj.code?.toLowerCase() || ''}`;
                renderCount++;

                const card = container.createDiv({ cls: "chem-gallery-card" });
                card.style.border = "1px solid var(--background-modifier-border)"; card.style.borderRadius = "8px"; card.style.padding = "10px";
                card.style.display = "flex"; card.style.flexDirection = "column"; card.style.alignItems = "center";
                card.style.backgroundColor = "var(--background-primary)"; card.style.cursor = "pointer"; card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.05)";
                card.onmouseover = () => card.style.borderColor = "var(--interactive-accent)";
                card.onmouseout = () => card.style.borderColor = "var(--background-modifier-border)";

                const previewWrapper = card.createDiv();
                previewWrapper.style.width = "100%"; previewWrapper.style.height = "100px"; previewWrapper.style.display = "flex"; previewWrapper.style.justifyContent = "center"; previewWrapper.style.alignItems = "center";
                previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳</span>`;

                const label = card.createDiv();
                label.textContent = yamlObj.code || file.basename;
                label.style.fontSize = "12px"; label.style.marginTop = "10px"; label.style.textAlign = "center"; label.style.wordBreak = "break-word"; label.style.color = "var(--text-normal)"; label.style.fontWeight = "500";

                cards.push({ el: card, text: searchableText });
                card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                requestAnimationFrame(async () => {
                    const originalW = this.plugin.settings.width; const originalH = this.plugin.settings.height;
                    this.plugin.settings.width = 120; this.plugin.settings.height = 100;
                    try {
                        const previewEl = await this.plugin.renderMoleculeToPreview(dataToRender, 'smiles', false);
                        previewWrapper.empty();
                        if (previewEl) { previewEl.style.maxWidth = '100%'; previewEl.style.maxHeight = '100%'; previewWrapper.appendChild(previewEl); } 
                        else { previewWrapper.innerHTML = `❌ Error`; }
                    } catch(e) { previewWrapper.innerHTML = `❌ Error`; } 
                    finally { this.plugin.settings.width = originalW; this.plugin.settings.height = originalH; }
                });
            } catch(e) {}
        }
        
        countLabel.textContent = `${renderCount} experiments`;
        searchInput.addEventListener("input", (e: any) => {
            const query = e.target.value.toLowerCase(); let visibleCount = 0;
            cards.forEach(c => { if (c.text.includes(query)) { c.el.style.display = "flex"; visibleCount++; } else { c.el.style.display = "none"; } });
            countLabel.textContent = `${visibleCount} / ${renderCount} experiments`;
        });
    }
}

// ------------------------------------------------------------------
// CREATE BLANK EXPERIMENT HELPER
// ------------------------------------------------------------------
export async function createNewElnExperiment(app: App, code: string, folderPath: string = "", sectionsString: string = "TLC, LCMS, NMR") {
    const { stringifyYaml } = require('obsidian');
    const defaultData = {
        code: code,
        status: "Planned",
        solvent: "",
        temperature: "rt",
        duration: "12 h",
        reactants: [],
        products: []
    };
    
    const yaml = stringifyYaml(defaultData);
    const dateStr = window.moment().format("YYYY-MM-DD");
    
    const sections = sectionsString.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    let analyticalDataStr = "";
    sections.forEach((sec: string) => analyticalDataStr += `- **${sec}:**\n`);

    const template = `---
tags: [experiment]
date: ${dateStr}
---

\`\`\`eln
${yaml}
\`\`\`

## 📝 Procedure & Observations
1. Add reactant A to the flask...
2. Stir at room temperature...
3. 

## 🔬 Analytical Data
${analyticalDataStr}`;
    
    let path = folderPath && folderPath !== "/" ? `${folderPath}/${code}.md` : `${code}.md`;
    try {
        const newFile = await app.vault.create(path, template);
        app.workspace.getLeaf(false).openFile(newFile);
        new Notice(`Created new experiment: ${code}`);
    } catch(e: any) {
        new Notice(`Error creating experiment: ${e.message}`);
    }
}

// ------------------------------------------------------------------
// MODALS
// ------------------------------------------------------------------

export class CreateExperimentModal extends Modal {
    plugin: any; onSubmit: (code: string) => void;
    code: string;

    constructor(plugin: any, defaultPrefix: string, onSubmit: (code: string) => void) {
        super(plugin.app); this.plugin = plugin; this.onSubmit = onSubmit;
        this.code = `${defaultPrefix}-001`;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Create New Experiment" });

        const wrap = contentEl.createDiv({ attr: {style: "margin-bottom: 20px;"}});
        wrap.createEl("div", { text: "Experiment Code (e.g. JH-001)", cls: "color-text-muted", attr: {style: "font-size:12px; margin-bottom:5px;"}});
        
        const input = wrap.createEl("input", { type: "text", value: this.code, attr: {style: "width:100%;"} });
        input.onchange = (e: any) => this.code = e.target.value;
        input.addEventListener("keypress", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                if (!this.code.trim()) { new Notice("Please enter a code"); return; }
                this.onSubmit(this.code.trim()); this.close();
            }
        });

        const btnRow = contentEl.createDiv({ attr: {style: "display:flex; justify-content:flex-end; gap: 10px;"}});
        const cancel = btnRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        
        const create = btnRow.createEl("button", { text: "Create Template", cls: "mod-cta" });
        create.onclick = () => {
            if (!this.code.trim()) { new Notice("Please enter a code"); return; }
            this.onSubmit(this.code.trim()); this.close();
        };

        setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class CloneExperimentModal extends Modal {
    app: App; currentCode: string; currentFile: TFile | null; sourceData: any; newCode: string;

    constructor(app: App, currentCode: string, currentFile: TFile | null, sourceData: any) {
        super(app); this.app = app; this.currentCode = currentCode; this.currentFile = currentFile; this.sourceData = sourceData;
        this.newCode = currentCode + "-copy";
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Clone Experiment" });
        contentEl.createEl("p", { text: "This will create a new file, copy the reaction scheme, and wipe the product yields for a fresh run.", cls: "color-text-muted", attr: {style:"font-size:13px; margin-top:0;"}});

        const wrap = contentEl.createDiv({ attr: {style: "margin-bottom: 20px;"}});
        wrap.createEl("div", { text: "New Experiment Code", cls: "color-text-muted", attr: {style: "font-size:12px; margin-bottom:5px;"}});
        const input = wrap.createEl("input", { type: "text", value: this.newCode, attr: {style: "width:100%;"} });
        input.onchange = (e: any) => this.newCode = e.target.value;

        const btnRow = contentEl.createDiv({ attr: {style: "display:flex; justify-content:flex-end; gap: 10px;"}});
        const cancel = btnRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        const cloneBtn = btnRow.createEl("button", { text: "Clone File", cls: "mod-cta" });
        
        const doClone = async () => {
            if (!this.newCode.trim()) return; const code = this.newCode.trim();
            const cloneData = JSON.parse(JSON.stringify(this.sourceData));
            cloneData.code = code; cloneData.status = "Planned";
            if (cloneData.products) { cloneData.products.forEach((p: any) => { delete p.mass_isolated; delete p.yield; delete p.mmol_isolated; }); }
            
            const { stringifyYaml } = require('obsidian'); const newYaml = stringifyYaml(cloneData);
            
            let currentSections = "## 📝 Procedure & Observations\n- \n\n## 🔬 Analytical Data\n- **TLC:**\n- **LCMS:**\n- **NMR:**";
            if (this.currentFile) {
                const content = await this.app.vault.cachedRead(this.currentFile);
                const procMatch = content.indexOf("## 📝 Procedure");
                if (procMatch !== -1) currentSections = content.substring(procMatch);
            }

            const template = `---
tags: [experiment]
date: ${window.moment().format("YYYY-MM-DD")}
---

\`\`\`eln\n${newYaml}\`\`\`\n\n${currentSections}`;

            const folderPath = this.currentFile?.parent?.path || "";
            const newPath = folderPath && folderPath !== "/" ? `${folderPath}/${code}.md` : `${code}.md`;

            try {
                const newFile = await this.app.vault.create(newPath, template);
                this.app.workspace.getLeaf(false).openFile(newFile);
                new Notice(`Experiment cloned to ${code}.md`);
            } catch(e: any) { new Notice(`Error cloning: ${e.message}`); }
            this.close();
        };

        cloneBtn.onclick = () => doClone();
        input.addEventListener("keypress", (e: KeyboardEvent) => {
            if (e.key === "Enter") doClone();
        });

        setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class ElnMetaEditorModal extends Modal {
    plugin: any; data: any; originalCode: string; onSave: (updated: any, shouldRename: boolean) => void;
    
    constructor(plugin: any, yamlObj: any, onSave: (updated: any, shouldRename: boolean) => void) {
        super(plugin.app); this.plugin = plugin; this.data = JSON.parse(JSON.stringify(yamlObj));
        this.originalCode = this.data.code || "";
        if (!this.data.reactants) this.data.reactants = [];
        if (!this.data.products) this.data.products = [];
        this.onSave = onSave;
    }

    // CASCADE API 1: Name to SMILES (OPSIN -> Cactus -> PubChem)
    async fetchSmilesFromName(name: string): Promise<string> {
        try {
            const opsin = await requestUrl(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(name)}.smi`);
            if (opsin.status === 200) return opsin.text.trim();
        } catch (e) {}
        try {
            const cactus = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(name)}/smiles`);
            if (cactus.status === 200) return cactus.text.trim();
        } catch (e) {}
        try {
            const pubchem = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/IsomericSMILES/JSON`);
            if (pubchem.status === 200) return pubchem.json.PropertyTable.Properties[0].IsomericSMILES;
        } catch (e) {}
        return "";
    }

    // CASCADE API 2: Smiles to Data
    async fetchChemDataFromSmiles(smiles: string): Promise<any> {
        let resObj = { name: "", mw: 0, formula: "", ghs: [] as string[] };
        
        try {
            const cactusName = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/iupac_name`);
            if (cactusName.status === 200) resObj.name = cactusName.text.trim().split('\n')[0];
        } catch(e) {}

        try {
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/Title,MolecularWeight,MolecularFormula/JSON`);
            if (res.status === 200) {
                const props = res.json.PropertyTable.Properties[0];
                if (!resObj.name) resObj.name = props.Title; 
                resObj.mw = parseFloat(props.MolecularWeight); 
                resObj.formula = props.MolecularFormula;
            }
        } catch(e) {}
        
        try {
            const cidRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`);
            if (cidRes.status === 200) {
                const cid = cidRes.json.IdentifierList.CID[0];
                const ghsRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`);
                const str = JSON.stringify(ghsRes.json);
                const emojis = [];
                if (str.includes("GHS01")) emojis.push("💣");
                if (str.includes("GHS02")) emojis.push("🔥");
                if (str.includes("GHS03") || str.includes("GHS04") || str.includes("GHS05")) emojis.push("🧪");
                if (str.includes("GHS06")) emojis.push("☠️");
                if (str.includes("GHS07")) emojis.push("⚠️");
                if (str.includes("GHS08")) emojis.push("⚕️");
                if (str.includes("GHS09")) emojis.push("🌳");
                resObj.ghs = [...new Set(emojis)];
            }
        } catch(e) {}
        
        return resObj;
    }
    
    onOpen() { this.render(); }
    
    render() {
        const { contentEl } = this; contentEl.empty();
        
        const header = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;" }});
        header.createEl("h2", { text: "Edit ELN Meta", attr: { style: "margin: 0; font-size: 1.2em;" } });
        const saveBtn = header.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { 
            const shouldRename = this.originalCode !== "" && this.data.code && this.originalCode !== this.data.code;
            this.onSave(this.data, shouldRename); 
            this.close(); 
        };

        const metaGrid = contentEl.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;" }});
        
        const addInput = (parent: HTMLElement, label: string, key: string, placeholder = "") => {
            const wrap = parent.createDiv(); wrap.createEl("div", { text: label, cls: "color-text-muted", attr: { style: "font-size:12px; margin-bottom:3px;"} });
            const inp = wrap.createEl("input", { type: "text", value: this.data[key] || "", attr: { style: "width:100%;", placeholder } });
            inp.onchange = (e: any) => this.data[key] = e.target.value;
        };
        
        addInput(metaGrid, "Reaction Code (Renames File)", "code"); 
        
        const statusWrap = metaGrid.createDiv(); 
        statusWrap.createEl("div", { text: "Status", cls: "color-text-muted", attr: { style: "font-size:12px; margin-bottom:3px;"} });
        const statusSelect = statusWrap.createEl("select", { attr: { style: "width:100%; padding: 4px; border-radius: 4px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); color: var(--text-normal);" }});
        ["None", "Planned", "Running", "Completed", "Failed"].forEach(opt => {
            const o = statusSelect.createEl("option", { text: opt, value: opt === "None" ? "" : opt });
            if (this.data.status === opt || (opt === "None" && !this.data.status)) o.selected = true;
        });
        statusSelect.onchange = (e: any) => this.data.status = e.target.value;

        addInput(metaGrid, "Solvent", "solvent");
        addInput(metaGrid, "Temperature", "temperature"); 
        addInput(metaGrid, "Duration", "duration");

        const renderChemRow = (item: any, type: 'reactants'|'products', idx: number) => {
            const row = contentEl.createDiv({ attr: { style: "background: var(--background-secondary-alt); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 10px;" }});
            
            const topWrap = row.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center;" }});
            const nameInp = topWrap.createEl("input", { type: "text", value: item.name || "", attr: { placeholder: "Chemical Name", style: "width: 100%; font-weight: bold;" }});
            nameInp.onchange = (e: any) => item.name = e.target.value;
            
            if (type === 'reactants') {
                const lrWrap = topWrap.createDiv({ attr: {style: "display: flex; align-items:center; gap: 4px; white-space:nowrap;"}});
                const lrRadio = lrWrap.createEl("input", { type: "radio", name: "limiting_reagent", value: idx.toString() });
                if (item.is_limiting) lrRadio.checked = true;
                lrRadio.onchange = () => { this.data.reactants.forEach((r:any) => r.is_limiting = false); item.is_limiting = true; };
                lrWrap.createEl("span", { text: "LIMITING", attr: {style: "background: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;"}});
            }

            const actionRow = row.createDiv({ attr: { style: "display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;" }});
            
            // 1. DRAW BUTTON (Fixed)
            const drawBtn = actionRow.createEl("button", { text: "✏️ Draw", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            drawBtn.onclick = () => {
                this.plugin.openKetcherModal(item.smiles || "", "smiles", (newSmiles: string) => {
                    item.smiles = newSmiles;
                    this.render();
                });
            };

            // 2. FETCH SMILES FROM NAME
            const fetchSmilesBtn = actionRow.createEl("button", { text: "🧪 Name \u2192 Structure", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            fetchSmilesBtn.onclick = async () => {
                if (!item.name) { new Notice("Enter a name first."); return; }
                fetchSmilesBtn.innerText = "⏳...";
                const smiles = await this.fetchSmilesFromName(item.name);
                if (smiles) { item.smiles = smiles; new Notice(`Structure found for ${item.name}`); this.render(); } 
                else { new Notice("Structure not found."); fetchSmilesBtn.innerText = "🧪 Name \u2192 Structure"; }
            };

            // 3. FETCH DATA FROM SMILES
            const fetchDataBtn = actionRow.createEl("button", { text: "🔍 Structure \u2192 Data", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            fetchDataBtn.onclick = async () => {
                if (!item.smiles) { new Notice("Draw a structure first."); return; }
                fetchDataBtn.innerText = "⏳...";
                try {
                    const d = await this.fetchChemDataFromSmiles(item.smiles);
                    if (d.name) item.name = d.name; if (d.mw) item.mw = d.mw; if (d.formula) item.formula = d.formula; if (d.ghs) item.ghs = d.ghs;
                    nameInp.value = item.name || ""; new Notice(`Found data for ${item.name}`);
                } catch(e) { new Notice("Could not fetch data."); }
                fetchDataBtn.innerText = "🔍 Structure \u2192 Data";
                this.render();
            };

            const delBtn = actionRow.createEl("button", { text: "🗑️ Remove", attr: { style: "color: var(--text-error); font-size:11px; padding: 4px 8px; margin-left:auto;" }});
            delBtn.onclick = () => { this.data[type].splice(idx, 1); this.render(); };

            const botRow = row.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 5px;" }});
            const makeNumInp = (key: string, label: string) => {
                const wrap = botRow.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
                wrap.createEl("span", { text: label, attr: { style: "font-size: 10px; color: var(--text-muted); margin-bottom: 2px;" }});
                const inp = wrap.createEl("input", { type: "number", value: item[key] || "", attr: { style: "width: 100%;" }});
                inp.onchange = (e: any) => item[key] = parseFloat(e.target.value) || undefined;
            };
            
            if (type === 'reactants') { 
                makeNumInp('eq', 'Eq'); makeNumInp('mass', 'Mass (mg)'); makeNumInp('volume', 'Vol (mL)');
                makeNumInp('purity', 'Purity (%)'); makeNumInp('molarity', 'Conc. (M)'); makeNumInp('density', 'Density'); 
            } else { 
                makeNumInp('eq', 'Eq'); makeNumInp('mass_isolated', 'Yield (mg)'); 
            }
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
        
        contentEl.createDiv({ attr: { style: "height: 50px;" } }); 
    }
    onClose() { this.contentEl.empty(); }
}
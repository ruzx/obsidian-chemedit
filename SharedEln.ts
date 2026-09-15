// SharedEln.ts
import { App, Modal, Notice, requestUrl, MarkdownView, TFile, Menu, FuzzySuggestModal } from 'obsidian';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';
import { ChemDataEngine } from './ChemDataEngine';

// ------------------------------------------------------------------
// OFFLINE MOLECULAR WEIGHT CALCULATOR (OpenChemLib + Web Fallback)
// ------------------------------------------------------------------
export async function calculateMwOffline(smiles: string, plugin?: any): Promise<{ mw: number, formula: string }> {
    try {
        let cleanSmiles = smiles.split(' |')[0].trim();
        
        // 1. Primary Offline Engine (OpenChemLib)
        let props = ChemDataEngine.getPropertiesFromSmiles(cleanSmiles);

        // 2. Headless Ketcher Normalizer (Solves bugs with complex aromatics offline)
        if (!props && plugin && plugin.headlessKetcher) {
            try {
                await plugin.headlessKetcher.setMolecule(cleanSmiles);
                const molBlock = await plugin.headlessKetcher.getMolfile();
                if ((ChemDataEngine as any).getPropertiesFromMolblock) {
                    props = (ChemDataEngine as any).getPropertiesFromMolblock(molBlock);
                }
            } catch(e) {}
        }

        if (props && props.mw > 0) {
            return { mw: props.mw, formula: props.formula };
        }

        // 3. Web Fallback 1: NCI Cactus (Excellent for tautomers and metal complexes)
        try {
            const mwRes = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(cleanSmiles)}/mw`);
            const formulaRes = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(cleanSmiles)}/formula`);
            if (mwRes.status === 200 && formulaRes.status === 200) {
                return { mw: parseFloat(mwRes.text), formula: formulaRes.text.trim() };
            }
        } catch (e) {}

        // 4. Web Fallback 2: PubChem
        try {
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(cleanSmiles)}/property/MolecularWeight,MolecularFormula/JSON`);
            if (res.status === 200) {
                const p = res.json.PropertyTable.Properties[0];
                return { mw: parseFloat(p.MolecularWeight), formula: p.MolecularFormula };
            }
        } catch(e) {}

    } catch(e) {}
    
    // 5. Absolute text-based fallback
    return fallbackMW(smiles);
}

function fallbackMW(smiles: string) {
    let mw = 0;
    // Explicitly grab standard elements including metals to prevent regex grouping errors
    const els = smiles.match(/(Cl|Br|Na|Mg|Ca|Fe|Pd|Si|Se|Te|Zn|Cu|Ni|Co|Mn|Cr|V|Ti|Sc|K|Li|B|C|N|O|F|P|S|I|c|n|o|p|s)/g);
    if (els) {
         const masses: Record<string, number> = {
            'C':12.011, 'c':12.011, 'N':14.007, 'n':14.007, 'O':15.999, 'o':15.999, 
            'S':32.065, 's':32.065, 'P':30.974, 'p':30.974, 'F':18.998, 
            'Cl':35.45, 'Br':79.904, 'I':126.90, 'B':10.81,
            'Pd':106.42, 'Fe':55.845, 'K':39.098, 'Na':22.99, 'Mg':24.305, 'Ca':40.078
         };
         els.forEach(e => {
             if (masses[e]) mw += masses[e];
             else if (masses[e.toUpperCase()]) mw += masses[e.toUpperCase()];
         });
         mw += els.length * 1.008; // Rough fallback estimate of 1H per heavy atom
         return { mw, formula: "Est." };
    }
    return { mw: 0, formula: "Unknown" };
}

// ------------------------------------------------------------------
// COMPOUND LIBRARY SYSTEM
// ------------------------------------------------------------------
export const DEFAULT_LIBRARY = [
    { name: "DCM (Dichloromethane)", smiles: "ClCCl" },
    { name: "THF (Tetrahydrofuran)", smiles: "C1CCOC1" },
    { name: "EtOAc (Ethyl Acetate)", smiles: "CCOC(C)=O" },
    { name: "DMF (Dimethylformamide)", smiles: "CN(C)C=O" },
    { name: "DMSO (Dimethyl Sulfoxide)", smiles: "CS(C)=O" },
    { name: "MeOH (Methanol)", smiles: "CO" },
    { name: "EtOH (Ethanol)", smiles: "CCO" },
    { name: "DIPEA (Hünig's Base)", smiles: "CCN(C(C)C)C(C)C" },
    { name: "TEA (Triethylamine)", smiles: "CCN(CC)CC" },
    { name: "DMAP", smiles: "CN(C)c1ccncc1" },
    { name: "HATU", smiles: "CN(C)C(=[N+](C)C)N1N=NC2=CC=CC=C21.F[P-](F)(F)(F)(F)F" },
    { name: "NaOH (Sodium Hydroxide)", smiles: "[OH-].[Na+]" },
    { name: "NaHCO3 (Sodium Bicarbonate)", smiles: "OC([O-])=O.[Na+]" },
    { name: "Na2SO4 (Sodium Sulfate)", smiles: "[Na+].[Na+].[O-]S(=O)(=O)[O-]" },
    { name: "MgSO4 (Magnesium Sulfate)", smiles: "[Mg+2].[O-]S(=O)(=O)[O-]" }
];

export async function getCompoundLibrary(plugin: any): Promise<{name: string, smiles: string}[]> {
    const path = plugin.settings?.libraryFilePath;
    if (!path) return DEFAULT_LIBRARY;

    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        try {
            const content = await plugin.app.vault.read(file);
            const results: {name: string, smiles: string}[] = [];
            
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('|')) {
                    const parts = line.split('|').map(p => p.trim());
                    if (parts.length >= 3) {
                        const name = parts[1];
                        const smiles = parts[2];
                        if (name && smiles && !name.includes('---') && name.toLowerCase() !== 'name') {
                            results.push({name, smiles});
                        }
                    }
                }
                const listMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
                if (listMatch) {
                    results.push({name: listMatch[1].trim(), smiles: listMatch[2].trim()});
                }
            }
            if (results.length > 0) return results;
        } catch (e) {
            console.error("ChemEdit: Failed to read custom library file", e);
        }
    }
    return DEFAULT_LIBRARY;
}

export async function addCompoundToLibrary(plugin: any, name: string, smiles: string) {
    const path = plugin.settings?.libraryFilePath;
    if (path) {
        let file = plugin.app.vault.getAbstractFileByPath(path);
        if (!file) {
            const header = `# Compound Library\n\n| Name | SMILES |\n|---|---|\n`;
            file = await plugin.app.vault.create(path, header);
        }
        if (file instanceof TFile) {
            const content = await plugin.app.vault.read(file);
            const newEntry = `| ${name} | ${smiles} |`;
            await plugin.app.vault.modify(file, content + (content.endsWith('\n') ? '' : '\n') + newEntry + '\n');
            new Notice(`${name} added to library file!`);
            return;
        }
    }
    
    if (!plugin.settings.compoundLibrary) plugin.settings.compoundLibrary = [];
    plugin.settings.compoundLibrary.push({ name, smiles });
    await plugin.saveSettings();
    new Notice(`${name} added to internal library!`);
}

export class CompoundSuggestModal extends FuzzySuggestModal<{name: string, smiles: string}> {
    library: {name: string, smiles: string}[];
    onChoose: (result: {name: string, smiles: string}) => void;

    constructor(app: App, library: {name: string, smiles: string}[], onChoose: (result: {name: string, smiles: string}) => void) {
        super(app);
        this.library = library;
        this.onChoose = onChoose;
        this.setPlaceholder("Search compound library...");
    }

    getItems() { return this.library; }
    getItemText(item: {name: string, smiles: string}) { return item.name; }
    onChooseItem(item: {name: string, smiles: string}, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(item);
    }
}

export class AddToLibraryModal extends Modal {
    name: string = "";
    smiles: string;
    onSubmit: (name: string, smiles: string) => void;

    constructor(app: App, smiles: string, onSubmit: (name: string, smiles: string) => void) {
        super(app);
        this.smiles = smiles;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Add to Compound Library" });
        
        contentEl.createEl("p", { text: `SMILES: ${this.smiles.substring(0, 50)}${this.smiles.length > 50 ? '...' : ''}`, cls: "color-text-muted", attr: {style: "font-family: monospace; font-size: 11px; word-break: break-all;"} });

        const input = contentEl.createEl("input", { type: "text", placeholder: "Compound Name (e.g. THF)" });
        input.style.width = "100%";
        input.style.marginBottom = "15px";
        input.onchange = (e: any) => this.name = e.target.value;

        const btnRow = contentEl.createDiv({ attr: {style: "display:flex; justify-content:flex-end; gap: 10px;"}});
        const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();
        
        const btn = btnRow.createEl("button", { text: "Add to Library", cls: "mod-cta" });
        btn.onclick = () => {
            if (!this.name.trim()) { new Notice("Please enter a name."); return; }
            this.onSubmit(this.name.trim(), this.smiles);
            this.close();
        };

        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") btn.click();
        });

        setTimeout(() => input.focus(), 50);
    }

    onClose() { this.contentEl.empty(); }
}

// ------------------------------------------------------------------
// STOICHIOMETRY ENGINE
// ------------------------------------------------------------------
class ElnCalculator {
    static calculate(data: any) {
        if (!data.reactants) data.reactants = [];
        if (!data.products) data.products = [];

        let limitingR = data.reactants.find((r: any) => r.is_limiting);
        if (!limitingR && data.reactants.length > 0) {
            limitingR = data.reactants.find((r: any) => r.eq === 1) || data.reactants[0];
            limitingR.is_limiting = true;
        }

        let refMmol = 0;
        if (limitingR) {
            const eq = limitingR.eq || 1;
            if (limitingR.mmol !== undefined && limitingR.mmol !== null && limitingR.mmol !== 0) {
                refMmol = limitingR.mmol / eq;
            } else if (limitingR.mass !== undefined && limitingR.mass !== null && limitingR.mass !== 0 && limitingR.mw) {
                let pureMass = limitingR.mass * ((limitingR.purity || 100) / 100);
                refMmol = (pureMass / limitingR.mw) / eq;
            } else if (limitingR.volume !== undefined && limitingR.volume !== null && limitingR.volume !== 0 && limitingR.molarity) {
                refMmol = (limitingR.volume * limitingR.molarity) / eq;
            }
        }

        data.reactants.forEach((r: any) => {
            r.eq = r.eq !== undefined ? r.eq : 1;
            r.mmol = refMmol * r.eq;
            
            if (r.molarity && r.molarity > 0) {
                r.volume = r.mmol / r.molarity; 
                if (r.mw && r.mass === undefined) r.mass = r.mmol * r.mw; 
            } else if (r.mw) {
                let neededPureMass = r.mmol * r.mw;
                r.mass = neededPureMass / ((r.purity || 100) / 100);
                if (r.density && r.density > 0) r.volume = (r.mass / 1000) / r.density;
            }
        });

        data.products.forEach((p: any) => {
            p.eq = p.eq !== undefined ? p.eq : 1; 
            p.theory_mmol = refMmol * p.eq; 
            if (p.mw) p.theory_mass = p.theory_mmol * p.mw;

            if (p.mmol_isolated !== undefined && p.mw && p.mass_isolated === undefined) {
                p.mass_isolated = p.mmol_isolated * p.mw;
            } else if (p.mass_isolated !== undefined && p.mw && p.mmol_isolated === undefined) {
                p.mmol_isolated = p.mass_isolated / p.mw;
            }

            if (p.mmol_isolated !== undefined && p.theory_mmol) { 
                p.yield = ((p.mmol_isolated / p.theory_mmol) * 100).toFixed(1); 
            } else if (p.mass_isolated !== undefined && p.theory_mass) {
                p.yield = ((p.mass_isolated / p.theory_mass) * 100).toFixed(1);
            }
        });

        return data;
    }
}

// ------------------------------------------------------------------
// MAIN ELN RENDERER
// ------------------------------------------------------------------
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
        wrapper.style.width = "100%";
        wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Calculating...</h3>`;

        try {
            const safeSource = source.replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                let s = p1.trim();
                if (!s) return match;
                
                let comment = "";
                const commentMatch = s.match(/(\s+#.*)$/);
                if (commentMatch) {
                    comment = commentMatch[1];
                    s = s.substring(0, s.length - comment.length).trim();
                }
                
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                    s = s.substring(1, s.length - 1);
                }
                
                s = s.replace(/\\"/g, '"');
                s = s.replace(/'/g, "''"); // escape single quotes for YAML
                return `smiles: '${s}'${comment}`;
            });
            
            let data = parseYaml(safeSource);
            if (!data) throw new Error("Empty YAML Data.");
            if (!data.reactants) data.reactants = [];
            if (!data.products) data.products = [];

            // Auto-heal missing MW (Silent, Fast)
            for (const r of data.reactants) { 
                const mwNum = Number(r.mw);
                if (r.smiles && (isNaN(mwNum) || mwNum <= 0 || r.formula === 'Est.')) { 
                    const p = await calculateMwOffline(r.smiles, this.plugin); 
                    if (p && p.mw > 0) { r.mw = p.mw; r.formula = p.formula; } 
                } 
            }
            for (const p of data.products) { 
                const mwNum = Number(p.mw);
                if (p.smiles && (isNaN(mwNum) || mwNum <= 0 || p.formula === 'Est.')) { 
                    const p2 = await calculateMwOffline(p.smiles, this.plugin); 
                    if (p2 && p2.mw > 0) { p.mw = p2.mw; p.formula = p2.formula; } 
                } 
            }

            data = ElnCalculator.calculate(data);

            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const currentFile = view ? view.file : null;
            const expCode = data.code || (currentFile ? currentFile.basename : "EXP");
            const filePrefix = expCode ? `${expCode}_` : "";

            wrapper.innerHTML = '';

            // --- INLINE EDITING LISTENER (WITH SCROLL PRESERVATION) ---
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                
                while (target && target !== wrapper && !target.classList.contains('eln-editable')) {
                    target = target.parentElement as HTMLElement;
                }

                if (target && target.classList.contains('eln-editable') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const type = target.getAttribute('data-type');
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const key = target.getAttribute('data-key');
                    const inputType = target.getAttribute('data-input-type') || 'number';
                    if (!key) return;

                    const originalHTML = target.innerHTML;
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.innerHTML = '';
                    target.style.padding = "4px"; 
                    
                    const input = document.createElement('input');
                    input.type = inputType === 'text' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    input.style.width = "100%";
                    input.style.boxSizing = "border-box";
                    input.style.padding = "4px 6px";
                    input.style.border = "1px solid var(--interactive-accent)";
                    input.style.borderRadius = "4px";
                    input.style.background = "var(--background-primary)";
                    
                    target.appendChild(input);
                    input.focus();

                    const finishEdit = () => {
                        const newValStr = input.value.trim().replace(/,/g, '.'); // Handle European commas
                        const info = ctx.getSectionInfo(el.parentElement || el);
                        
                        if (view && info) {
                            const scrollInfo = view.editor.getScrollInfo();
                            const cursor = view.editor.getCursor();
                            
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                let yamlObj = parseYaml(blockText);
                                
                                let valToSave: any = newValStr;
                                if (inputType === 'number') {
                                    const num = parseFloat(newValStr);
                                    valToSave = isNaN(num) ? undefined : num;
                                } else {
                                    valToSave = newValStr === '' ? undefined : newValStr;
                                }

                                if (type === 'root') {
                                    if (valToSave === undefined) delete yamlObj[key];
                                    else yamlObj[key] = valToSave;
                                } else {
                                    if (!yamlObj[type!]) yamlObj[type!] = [];
                                    if (!yamlObj[type!][idx]) yamlObj[type!][idx] = {};
                                    
                                    if (valToSave === undefined) {
                                        delete yamlObj[type!][idx][key];
                                    } else {
                                        yamlObj[type!][idx][key] = valToSave;
                                        if (key === 'mmol') { delete yamlObj[type!][idx].mass; delete yamlObj[type!][idx].volume; }
                                        else if (key === 'mass') { delete yamlObj[type!][idx].mmol; delete yamlObj[type!][idx].volume; }
                                        else if (key === 'volume') { delete yamlObj[type!][idx].mmol; delete yamlObj[type!][idx].mass; }
                                        else if (key === 'mmol_isolated') { delete yamlObj[type!][idx].mass_isolated; }
                                        else if (key === 'mass_isolated') { delete yamlObj[type!][idx].mmol_isolated; }
                                    }
                                }
                                
                                yamlObj = ElnCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                
                                setTimeout(() => {
                                    view.editor.scrollTo(scrollInfo.left, scrollInfo.top);
                                    view.editor.setCursor(cursor);
                                }, 15);
                                
                            } catch (err) { target.innerHTML = originalHTML; target.style.padding = "10px"; }
                        } else { target.innerHTML = originalHTML; target.style.padding = "10px"; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { 
                        if (ev.key === 'Enter') input.blur(); 
                        else if (ev.key === 'Escape') { target.innerHTML = originalHTML; target.style.padding = "10px"; }
                    };
                }
            });

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
                const lines = editor.getValue().split('\n');
                
                let targetLine = lines.findIndex((line: string) => line.includes(`## 📝 Procedure`));
                if (targetLine === -1 && keyword === "Analytical Data") {
                    targetLine = lines.findIndex((line: string) => line.includes(`## 🔬 Analytical Data`));
                }
                
                if (targetLine !== -1) {
                    let insertLine = targetLine + 1;
                    while (insertLine < lines.length && !lines[insertLine].startsWith('##')) {
                        insertLine++;
                    }
                    while (insertLine > targetLine + 1 && lines[insertLine - 1].trim() === '') {
                        insertLine--;
                    }
                    editor.replaceRange(`\n${text}\n`, { line: insertLine, ch: 0 });
                } else {
                    const info = ctx.getSectionInfo(el.parentElement || el);
                    if (info) editor.replaceRange(`\n${text}\n`, { line: info.lineEnd + 1, ch: 0 });
                }
            };

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
                    appendSmart(md, "Analytical Data"); new Notice(`Added ${filename}`);
                });
            });

            createBtn("📋 Copy", "Copy Stoichiometry Table to Clipboard", () => {
                let tsv = "Type\tName\tSMILES\tEq\tMW\tm [mg]\tn [mmol]\tV [mL]\tYield [%]\n";
                data.reactants.forEach((r: any) => tsv += `Reactant\t${r.name||''}\t${r.smiles||''}\t${r.eq||'-'}\t${r.mw?.toFixed(2)||'-'}\t${r.mass?.toFixed(1)||'-'}\t${r.mmol?.toFixed(2)||'-'}\t${r.volume?.toFixed(3)||'-'}\t-\n`);
                data.products.forEach((p: any) => tsv += `Product\t${p.name||''}\t${p.smiles||''}\t${p.eq||'-'}\t${p.mw?.toFixed(2)||'-'}\t${p.mass_isolated?.toFixed(1)||'-'}\t${p.mmol_isolated?.toFixed(2)||'-'}\t-\t${p.yield||'-'}\n`);
                navigator.clipboard.writeText(tsv); new Notice("Table copied to clipboard! Paste into Excel.");
            });

            createBtn("🗐 Clone", "Duplicate this experiment into a new file", () => {
                new CloneExperimentModal(this.plugin.app, this.plugin, expCode, currentFile, data).open();
            });

            createBtn("📝 Edit", "Edit Metadata & Conditions", () => {
                if (!view) return;
                const info = ctx.getSectionInfo(el.parentElement || el);
                if (info) {
                    new ElnMetaEditorModal(this.plugin.app, this.plugin, data, async (updatedYamlObj, shouldRename) => {
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

            // --- HTML RENDERING ---
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

            // INLINE EDITABLE ROOT PROPERTIES
            const makeEditableRoot = (key: string, val: any) => {
                const displayVal = val || '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="eln-editable" data-type="root" data-key="${key}" data-input-type="text" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 1px dashed transparent; display: inline-block;">${displayVal}</span>`;
            };

            html += `<div style="display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 15px; background: var(--background-secondary-alt); padding: 10px 15px; border-radius: 6px; margin-bottom: 25px; font-size: 13px;">
                <div style="flex: 1 1 100px; display: flex; align-items:center; gap: 5px;"><b style="color:var(--text-muted);">Duration:</b> ${makeEditableRoot('duration', data.duration)}</div>
                <div style="flex: 1 1 100px; display: flex; align-items:center; gap: 5px;"><b style="color:var(--text-muted);">Solvent:</b> ${makeEditableRoot('solvent', data.solvent)}</div>
                <div style="flex: 1 1 100px; display: flex; align-items:center; gap: 5px;"><b style="color:var(--text-muted);">Temp:</b> ${makeEditableRoot('temperature', data.temperature)}</div>
            </div>`;
            
            // CLEAN INLINE EDITABLE TABLE CELLS
            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number' | 'text' = 'number', customHtml?: string, extraStyles: string = "") => {
                let innerHTML = customHtml !== undefined ? customHtml : '-';
                let colorStyle = ""; 
                
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";

                if (customHtml === undefined) {
                    if (inputType === 'text') {
                        innerHTML = val ? val : '-';
                    } else {
                        const numVal = Number(val);
                        if (!isNaN(numVal) && numVal > 0) {
                            innerHTML = numVal.toFixed(2);
                        } else {
                            innerHTML = '-';
                            if (key === 'mw') colorStyle = "color: var(--text-error); font-weight: bold;";
                        }
                    }
                }
                
                return `<td class="eln-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 10px; cursor: text; transition: background 0.2s; ${colorStyle} ${extraStyles}">${innerHTML}</td>`;
            };

            html += `<h4 style="margin-bottom: 10px; margin-top: 0;">Reactants</h4>
                <div style="width: 100%; overflow-x: auto; margin-bottom: 30px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 650px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Type</th><th style="padding: 10px;">Eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">Purity/Conc.</th><th style="padding: 10px;">m [mg]</th><th style="padding: 10px;">V [ml]</th>
                    </tr>`;
            data.reactants.forEach((r: any, i: number) => {
                let concStr = "-";
                let concKey = "purity";
                let concVal = r.purity || 100;
                if (r.molarity) { concStr = `${r.molarity} M`; concKey = "molarity"; concVal = r.molarity; }
                else if (r.purity && r.purity !== 100) { concStr = `${r.purity}%`; }
                else if (r.purity === 100) { concStr = `Pure`; }

                const ghsStr = r.ghs && r.ghs.length > 0 ? `<span title="GHS Hazards">${r.ghs.join(' ')}</span>` : '';
                const lrIcon = r.is_limiting ? `<span style="background: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">LIMITING</span>` : "";

                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    <td style="padding: 10px;">${lrIcon}</td>
                    ${makeEditableTd('reactants', i, 'eq', r.eq, 'number', undefined, "font-weight:500;")}
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="reactants" data-index="${i}" data-smiles="${r.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    ${makeEditableTd('reactants', i, 'name', r.name, 'text', r.name ? `<b>${r.name}</b> ${ghsStr}` : `- ${ghsStr}`)}
                    ${makeEditableTd('reactants', i, 'mw', r.mw, 'number', undefined, "color:var(--text-muted);")}
                    ${makeEditableTd('reactants', i, 'mmol', r.mmol, 'number')}
                    ${makeEditableTd('reactants', i, concKey, concVal, 'number', concStr, "color:var(--text-muted);")}
                    ${makeEditableTd('reactants', i, 'mass', r.mass, 'number')}
                    ${makeEditableTd('reactants', i, 'volume', r.volume, 'number')}
                </tr>`;
            });
            
            html += `</table></div><h4 style="margin-bottom: 10px;">Products</h4>
                <div style="width: 100%; overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; min-width: 600px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Eq</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">Isol. [mg]</th><th style="padding: 10px;">Yield [%]</th>
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

                const prodMmolDisplay = p.mmol_isolated !== undefined ? p.mmol_isolated.toFixed(2) : (p.theory_mmol ? `<span style="opacity:0.6">(${p.theory_mmol.toFixed(2)})</span>` : '-');

                html += `<tr style="border-bottom: 1px solid ${bdColor};">
                    ${makeEditableTd('products', i, 'eq', p.eq, 'number', undefined, "font-weight:500;")}
                    <td style="padding: 10px;"><div class="eln-structure table-size" data-type="products" data-index="${i}" data-smiles="${p.smiles || ''}" style="width:90px; height:90px; cursor:pointer;" title="Double-click to edit"></div></td>
                    ${makeEditableTd('products', i, 'name', p.name, 'text', p.name ? `<b>${p.name}</b> ${ghsStr}` : `- ${ghsStr}`)}
                    ${makeEditableTd('products', i, 'mw', p.mw, 'number', undefined, "color:var(--text-muted);")}
                    ${makeEditableTd('products', i, 'mmol_isolated', p.mmol_isolated, 'number', prodMmolDisplay)}
                    ${makeEditableTd('products', i, 'mass_isolated', p.mass_isolated, 'number')}
                    <td style="padding: 10px; font-size: 14px; font-weight:bold; color: ${yieldColor};">${p.yield ? p.yield + '%' : '-'}</td>
                </tr>`;
            });
            html += `</table></div>`;
            
            // Inject styling for editable cells hover effect
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.eln-editable:hover { background-color: var(--background-modifier-hover); }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

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
                // Apply strict YAML quoting fix to gallery previews as well!
                const safeSource = blockMatch[1].replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                    let s = p1.trim();
                    if (!s) return match;
                    let comment = "";
                    const commentMatch = s.match(/(\s+#.*)$/);
                    if (commentMatch) {
                        comment = commentMatch[1];
                        s = s.substring(0, s.length - comment.length).trim();
                    }
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
                        s = s.substring(1, s.length - 1);
                    }
                    s = s.replace(/\\"/g, '"');
                    s = s.replace(/'/g, "''");
                    return `smiles: '${s}'${comment}`;
                });
                
                const yamlObj = parseYaml(safeSource);
                let dataToRender = "";
                
                if (yamlObj.products && yamlObj.products.length > 0 && typeof yamlObj.products[0].smiles === 'string' && yamlObj.products[0].smiles.trim()) {
                    dataToRender = yamlObj.products[0].smiles.trim();
                } else if (yamlObj.reactants && yamlObj.reactants.length > 0 && typeof yamlObj.reactants[0].smiles === 'string' && yamlObj.reactants[0].smiles.trim()) {
                    dataToRender = yamlObj.reactants[0].smiles.trim();
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
                
                const label = card.createDiv();
                label.textContent = yamlObj.code || file.basename;
                label.style.fontSize = "12px"; label.style.marginTop = "10px"; label.style.textAlign = "center"; label.style.wordBreak = "break-word"; label.style.color = "var(--text-normal)"; label.style.fontWeight = "500";

                cards.push({ el: card, text: searchableText });
                card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

                if (!dataToRender) {
                    previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">No Structure</span>`;
                    continue;
                }

                previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳</span>`;

                requestAnimationFrame(async () => {
                    try {
                        const previewEl = await this.plugin.api.renderStructure(dataToRender, 120, 100);
                        previewWrapper.empty();
                        if (previewEl) { previewEl.style.maxWidth = '100%'; previewEl.style.maxHeight = '100%'; previewWrapper.appendChild(previewEl); } 
                        else { previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">Invalid</span>`; }
                    } catch(e) { previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">Invalid</span>`; } 
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

    async renderChemGallery(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml } = require('obsidian');
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";
        if (!folderPath) { el.createEl("div", { text: "⚠️ Please specify a folder path", cls: "color-text-error" }); return; }
        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { el.createEl("div", { text: `⚠️ Folder not found`, cls: "color-text-error" }); return; }

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        const container = el.createDiv({ cls: "chem-gallery-container" });
        container.style.display = "grid"; container.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))"; container.style.gap = "15px"; container.style.padding = "5px 0";

        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const blockMatch = content.match(/```(smiles|mol)\s*\n([\s\S]*?)\n```/);
            if (!blockMatch) continue;
            
            const format = blockMatch[1];
            const dataToRender = blockMatch[2].trim();

            if (!dataToRender) continue;

            const card = container.createDiv({ cls: "chem-gallery-card" });
            card.style.border = "1px solid var(--background-modifier-border)"; card.style.borderRadius = "8px"; card.style.padding = "10px";
            card.style.display = "flex"; card.style.flexDirection = "column"; card.style.alignItems = "center";
            card.style.backgroundColor = "var(--background-primary)"; card.style.cursor = "pointer"; card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.05)";
            
            const previewWrapper = card.createDiv();
            previewWrapper.style.width = "100%"; previewWrapper.style.height = "100px"; previewWrapper.style.display = "flex"; previewWrapper.style.justifyContent = "center"; previewWrapper.style.alignItems = "center";
            previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳</span>`;
            
            const label = card.createDiv();
            label.textContent = file.basename;
            label.style.fontSize = "12px"; label.style.marginTop = "10px"; label.style.textAlign = "center"; label.style.wordBreak = "break-word"; label.style.color = "var(--text-normal)"; label.style.fontWeight = "500";

            card.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

            requestAnimationFrame(async () => {
                try {
                    const previewEl = await this.plugin.api.renderStructure(dataToRender, 120, 100);
                    previewWrapper.empty();
                    if (previewEl) { previewEl.style.maxWidth = '100%'; previewEl.style.maxHeight = '100%'; previewWrapper.appendChild(previewEl); } 
                    else { previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">Invalid</span>`; }
                } catch(e) { previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">Invalid</span>`; } 
            });
        }
    }
}

// ------------------------------------------------------------------
// CREATE BLANK EXPERIMENT HELPER
// ------------------------------------------------------------------
export async function createNewElnExperiment(app: App, code: string, folderPath: string = "", sectionsString: string = "TLC, LCMS, NMR") {
    const { stringifyYaml } = require('obsidian');
    
    const baseCode = code.trim() || "Experiment";
    
    const defaultData = {
        code: baseCode,
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
    
    let safeCode = baseCode.replace(/[/\\?%*:|"<>]/g, '-');
    let path = folderPath && folderPath !== "/" ? `${folderPath}/${safeCode}.md` : `${safeCode}.md`;

    let finalPath = path;
    let counter = 1;
    while (app.vault.getAbstractFileByPath(finalPath)) {
        finalPath = folderPath && folderPath !== "/" ? `${folderPath}/${safeCode}-${counter}.md` : `${safeCode}-${counter}.md`;
        counter++;
    }

    try {
        const newFile = await app.vault.create(finalPath, template);
        app.workspace.getLeaf(false).openFile(newFile);
        new Notice(`Created new experiment: ${newFile.basename}`);
    } catch(e: any) {
        new Notice(`Error creating experiment: ${e.message}`);
    }
}

// ------------------------------------------------------------------
// MODALS
// ------------------------------------------------------------------

export class CreateExperimentModal extends Modal {
    plugin: any; onSubmit: (code: string) => void;
    code: string; folderPath: string;

    constructor(app: App, plugin: any, defaultPrefix: string, folderPath: string, onSubmit: (code: string) => void) {
        super(app); 
        this.plugin = plugin; 
        this.onSubmit = onSubmit; 
        this.folderPath = folderPath;
        
        let nextNum = 1;
        const folder = app.vault.getAbstractFileByPath(folderPath || "/");
        if (folder && (folder as any).children) {
            (folder as any).children.forEach((f: any) => {
                if (f.name.endsWith('.md')) {
                    const match = f.basename.match(new RegExp(`^${defaultPrefix}-(\\d+)$`));
                    if (match) {
                        const num = parseInt(match[1], 10);
                        if (num >= nextNum) nextNum = num + 1;
                    }
                }
            });
        }
        const paddedNum = nextNum.toString().padStart(3, '0');
        this.code = `${defaultPrefix}-${paddedNum}`;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Create New Experiment" });

        const wrap = contentEl.createDiv({ attr: {style: "margin-bottom: 20px;"}});
        wrap.createEl("div", { text: "Experiment Code (e.g. EXP-001)", cls: "color-text-muted", attr: {style: "font-size:12px; margin-bottom:5px;"}});
        
        const input = wrap.createEl("input", { type: "text", value: this.code, attr: {style: "width:100%;"} });
        input.onchange = (e: any) => this.code = e.target.value;

        const attemptSubmit = () => {
            if (!this.code.trim()) { new Notice("Please enter a code"); return; }
            this.onSubmit(this.code.trim()); 
            this.close();
        };

        input.addEventListener("keypress", (e: KeyboardEvent) => { if (e.key === "Enter") attemptSubmit(); });

        const btnRow = contentEl.createDiv({ attr: {style: "display:flex; justify-content:flex-end; gap: 10px;"}});
        const cancel = btnRow.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
        const create = btnRow.createEl("button", { text: "Create Template", cls: "mod-cta" });
        create.onclick = attemptSubmit;

        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class CloneExperimentModal extends Modal {
    plugin: any; currentCode: string; currentFile: TFile | null; sourceData: any; newCode: string;

    constructor(app: App, plugin: any, currentCode: string, currentFile: TFile | null, sourceData: any) {
        super(app); this.plugin = plugin; this.currentCode = currentCode; this.currentFile = currentFile; this.sourceData = sourceData;
        
        let base = currentCode;
        let suffixNum = 1;
        const match = currentCode.match(/^(.*?)-copy(?:-(\d+))?$/);
        if (match) {
            base = match[1];
            suffixNum = match[2] ? parseInt(match[2], 10) + 1 : 2;
            this.newCode = `${base}-copy-${suffixNum}`;
        } else {
            this.newCode = `${currentCode}-copy`;
        }
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
            const folderPath = this.currentFile?.parent?.path || "";
            let newPath = folderPath && folderPath !== "/" ? `${folderPath}/${code}.md` : `${code}.md`;

            // Auto-increment if file exists
            let counter = 1;
            while (this.plugin.app.vault.getAbstractFileByPath(newPath)) {
                newPath = folderPath && folderPath !== "/" ? `${folderPath}/${code}-${counter}.md` : `${code}-${counter}.md`;
                counter++;
            }

            const cloneData = JSON.parse(JSON.stringify(this.sourceData));
            cloneData.code = code; cloneData.status = "Planned";
            if (cloneData.products) { cloneData.products.forEach((p: any) => { delete p.mass_isolated; delete p.yield; delete p.mmol_isolated; }); }
            
            const { stringifyYaml } = require('obsidian'); const newYaml = stringifyYaml(cloneData);
            
            let currentSections = "## 📝 Procedure & Observations\n- \n\n## 🔬 Analytical Data\n- **TLC:**\n- **LCMS:**\n- **NMR:**";
            if (this.currentFile) {
                const content = await this.plugin.app.vault.cachedRead(this.currentFile);
                const procMatch = content.indexOf("## 📝 Procedure");
                if (procMatch !== -1) currentSections = content.substring(procMatch);
            }

            const template = `---
tags: [experiment]
date: ${window.moment().format("YYYY-MM-DD")}
---

\`\`\`eln\n${newYaml}\`\`\`\n\n${currentSections}`;

            try {
                const newFile = await this.plugin.app.vault.create(newPath, template);
                this.plugin.app.workspace.getLeaf(false).openFile(newFile);
                new Notice(`Experiment cloned to ${newFile.basename}`);
            } catch(e: any) { new Notice(`Error cloning: ${e.message}`); }
            this.close();
        };

        input.addEventListener("keypress", (e: KeyboardEvent) => { if (e.key === "Enter") doClone(); });
        cloneBtn.onclick = () => doClone();

        setTimeout(() => input.focus(), 50);
    }
    onClose() { this.contentEl.empty(); }
}

export class ElnMetaEditorModal extends Modal {
    plugin: any; data: any; originalCode: string; onSave: (updated: any, shouldRename: boolean) => void;
    advancedMode = false;
    
    constructor(app: App, plugin: any, yamlObj: any, onSave: (updated: any, shouldRename: boolean) => void) {
        super(app); this.plugin = plugin; this.data = JSON.parse(JSON.stringify(yamlObj));
        this.originalCode = this.data.code || "";
        if (!this.data.reactants) this.data.reactants = [];
        if (!this.data.products) this.data.products = [];
        this.onSave = onSave;
    }

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
    
    onOpen() { this.render(); }
    
    async processReactionSmiles(rxnSmiles: string) {
        if (!rxnSmiles.includes('>')) return;
        
        const parts = rxnSmiles.split('>');
        const reactSmilesList = parts[0].split('.').filter((s: string)=>s);
        const prodSmilesList = parts[parts.length-1].split('.').filter((s: string)=>s);

        const newReactants = [];
        for (const s of reactSmilesList) {
            const existing = this.data.reactants.find((r:any) => r.smiles === s);
            if (existing) newReactants.push(existing);
            else {
                const props = await calculateMwOffline(s, this.plugin);
                newReactants.push({ name: "Compound", smiles: s, eq: 1, mw: props?.mw||0, formula: props?.formula||"" });
            }
        }

        const newProducts = [];
        for (const s of prodSmilesList) {
            const existing = this.data.products.find((p:any) => p.smiles === s);
            if (existing) newProducts.push(existing);
            else {
                const props = await calculateMwOffline(s, this.plugin);
                newProducts.push({ name: "Product", smiles: s, eq: 1, mw: props?.mw||0, formula: props?.formula||"" });
            }
        }

        this.data.reactants = newReactants;
        this.data.products = newProducts;
        this.render();
        new Notice("Reaction successfully parsed and calculated!");
    }

    render() {
        const { contentEl } = this; contentEl.empty();
        
        const header = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;" }});
        header.createEl("h2", { text: "Edit ELN Meta", attr: { style: "margin: 0; font-size: 1.2em;" } });
        
        const hActions = header.createDiv({ attr: {style: "display: flex; gap: 10px;"}});
        
        const rxnBtn = hActions.createEl("button", { text: "✏️ Draw Reaction" });
        rxnBtn.onclick = () => {
            const currentR = this.data.reactants.map((r:any)=>r.smiles).join('.');
            const currentP = this.data.products.map((p:any)=>p.smiles).join('.');
            const rxnStr = currentR && currentP ? `${currentR}>>${currentP}` : "";
            
            this.plugin.openKetcherModal(rxnStr, "smiles", (smi: string) => {
                if (smi.includes('>')) this.processReactionSmiles(smi);
                else new Notice("Please draw a reaction arrow to split reactants and products.");
            });
        };

        const saveBtn = hActions.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { 
            const shouldRename = this.originalCode !== "" && this.data.code && this.originalCode !== this.data.code;
            this.onSave(ElnCalculator.calculate(this.data), shouldRename); 
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

        const advToggle = contentEl.createEl("button", { text: this.advancedMode ? "Hide Advanced Fields" : "⚙️ Show Advanced Fields (Purity, Molarity...)", attr: {style: "width: 100%; margin-bottom: 15px; font-size: 11px;"}});
        advToggle.onclick = () => { this.advancedMode = !this.advancedMode; this.render(); };

        const renderChemRow = (item: any, type: 'reactants'|'products', idx: number) => {
            const row = contentEl.createDiv({ attr: { style: "background: var(--background-secondary-alt); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 10px;" }});
            
            const topWrap = row.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center;" }});
            const nameInp = topWrap.createEl("input", { type: "text", value: item.name || "", attr: { placeholder: "Chemical Name", style: "width: 100%; font-weight: bold;" }});
            nameInp.onchange = (e: any) => item.name = e.target.value;
            
            if (type === 'reactants') {
                const lrWrap = topWrap.createDiv({ attr: {style: "display: flex; align-items:center; gap: 4px; white-space:nowrap;"}});
                const lrRadio = lrWrap.createEl("input", { type: "radio", name: "limiting_reagent", value: idx.toString() });
                if (item.is_limiting) lrRadio.checked = true;
                lrRadio.onchange = () => { this.data.reactants.forEach((r:any) => r.is_limiting = false); item.is_limiting = true; this.render(); };
                lrWrap.createEl("span", { text: "LIMITING", attr: {style: "background: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;"}});
            }

            const actionRow = row.createDiv({ attr: { style: "display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;" }});
            
            const drawBtn = actionRow.createEl("button", { text: "✏️ Draw", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            drawBtn.onclick = () => {
                this.plugin.openKetcherModal(item.smiles || "", "smiles", (newSmiles: string) => {
                    item.smiles = newSmiles;
                    this.render();
                });
            };

            const libBtn = actionRow.createEl("button", { text: "📚 Lib", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            libBtn.onclick = async () => {
                const lib = await getCompoundLibrary(this.plugin);
                new CompoundSuggestModal(this.plugin.app, lib, (selected) => {
                    item.name = selected.name;
                    item.smiles = selected.smiles;
                    this.render();
                }).open();
            };

            const fetchSmilesBtn = actionRow.createEl("button", { text: "🧪 N \u2192 S (Web)", attr: {style: "font-size:11px; padding: 4px 8px;", title: "Name to Structure (Requires Internet)"} });
            fetchSmilesBtn.onclick = async () => {
                if (!item.name) { new Notice("Enter a name first."); return; }
                fetchSmilesBtn.innerText = "⏳...";
                const smiles = await this.fetchSmilesFromName(item.name);
                if (smiles) { item.smiles = smiles; new Notice(`Structure found for ${item.name}`); this.render(); } 
                else { new Notice("Structure not found."); fetchSmilesBtn.innerText = "🧪 N \u2192 S (Web)"; }
            };

            const fetchDataBtn = actionRow.createEl("button", { text: "🔍 S \u2192 D", attr: {style: "font-size:11px; padding: 4px 8px;", title: "Calculate Data from Structure (Offline)"} });
            fetchDataBtn.onclick = async () => {
                if (!item.smiles) { new Notice("Draw a structure first."); return; }
                fetchDataBtn.innerText = "⏳...";
                const d = await calculateMwOffline(item.smiles, this.plugin);
                if (d.mw) item.mw = d.mw; if (d.formula) item.formula = d.formula;
                
                // Fetch standard name and extra GHS props safely from Web as bonus
                if (!item.name) {
                    try {
                        const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(item.smiles)}/property/Title/JSON`);
                        if (res.status === 200) item.name = res.json.PropertyTable.Properties[0].Title;
                    } catch(e) {}
                }
                try {
                    const cidRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(item.smiles)}/cids/JSON`);
                    if (cidRes.status === 200) {
                        const cid = cidRes.json.IdentifierList.CID[0];
                        const ghsRes = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`);
                        const str = JSON.stringify(ghsRes.json);
                        const emojis = [];
                        if (str.includes("GHS01")) emojis.push("💣"); if (str.includes("GHS02")) emojis.push("🔥");
                        if (str.includes("GHS03") || str.includes("GHS04") || str.includes("GHS05")) emojis.push("🧪");
                        if (str.includes("GHS06")) emojis.push("☠️"); if (str.includes("GHS07")) emojis.push("⚠️");
                        if (str.includes("GHS08")) emojis.push("⚕️"); if (str.includes("GHS09")) emojis.push("🌳");
                        item.ghs = [...new Set(emojis)];
                    }
                } catch(e) {}

                nameInp.value = item.name || ""; 
                new Notice(`Calculated offline MW for ${item.name || 'Structure'}`);
                
                fetchDataBtn.innerText = "🔍 S \u2192 D";
                this.render();
            };

            const delBtn = actionRow.createEl("button", { text: "🗑️ Remove", attr: { style: "color: var(--text-error); font-size:11px; padding: 4px 8px; margin-left:auto;" }});
            delBtn.onclick = () => { this.data[type].splice(idx, 1); this.render(); };

            const botRow = row.createDiv({ attr: { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(75px, 1fr)); gap: 8px; margin-top: 5px;" }});
            
            const makeNumInp = (key: string, label: string, onUpdate?: (val: number) => void) => {
                const wrap = botRow.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
                wrap.createEl("span", { text: label, attr: { style: "font-size: 10px; color: var(--text-muted); margin-bottom: 2px; white-space: nowrap;" }});
                const inp = wrap.createEl("input", { type: "number", value: item[key] !== undefined ? item[key] : "", attr: { style: "width: 100%; padding: 4px; box-sizing: border-box;" }});
                inp.onchange = (e: any) => {
                    const val = parseFloat(e.target.value.replace(/,/g, '.'));
                    if (isNaN(val)) delete item[key];
                    else item[key] = val;
                    if (onUpdate && !isNaN(val)) onUpdate(val);
                    this.data = ElnCalculator.calculate(this.data);
                    this.render();
                };
            };
            
            if (type === 'reactants') { 
                makeNumInp('eq', 'Eq'); 
                if (this.advancedMode) {
                    makeNumInp('mmol', 'n(mmol)', () => { delete item.mass; delete item.volume; }); 
                }
                makeNumInp('mass', 'm(mg)', () => { delete item.mmol; delete item.volume; }); 
                
                if (this.advancedMode) {
                    makeNumInp('volume', 'V(mL)', () => { delete item.mmol; delete item.mass; });
                    makeNumInp('purity', 'Purity(%)'); 
                    makeNumInp('molarity', 'Conc(M)'); 
                    makeNumInp('density', 'Density'); 
                }
            } else { 
                makeNumInp('eq', 'Eq'); 
                if (this.advancedMode) {
                    makeNumInp('mmol_isolated', 'Isol(mmol)', () => { delete item.mass_isolated; });
                }
                makeNumInp('mass_isolated', 'Isol(mg)', () => { delete item.mmol_isolated; }); 
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
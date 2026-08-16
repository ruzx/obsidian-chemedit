import { App, Modal, Plugin, MarkdownView, PluginSettingTab, Setting, Editor, Notice, requestUrl, TextFileView, WorkspaceLeaf, TFile } from 'obsidian';
import React from 'react';
import ReactDOM from 'react-dom';
import SmiDrawer from 'smiles-drawer';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import KetcherReact from './KetcherReact';

// Safely handle React 18 root rendering
let createRoot: any = null;
try {
    const ReactDomClient = require('react-dom/client');
    if (ReactDomClient && ReactDomClient.createRoot) {
        createRoot = ReactDomClient.createRoot;
    }
} catch (e) {
    createRoot = null;
}

let standaloneProvider: StandaloneStructServiceProvider | null = null;

interface ChemEditSettings {
    width: number;
    height: number;
    inlineWidth: number;
    inlineHeight: number;
    lightTheme: string;
    darkTheme: string;
    inlineSmilesPrefix: string;
    inlineMolPrefix: string;
    smartPasteSmiles: boolean;
    smartPasteMol: boolean;
    useSvgSmiles: boolean;
}

const DEFAULT_SETTINGS: ChemEditSettings = {
    width: 300,
    height: 300,
    inlineWidth: 150,
    inlineHeight: 150,
    lightTheme: 'light',
    darkTheme: 'dark',
    inlineSmilesPrefix: '$smiles=',
    inlineMolPrefix: '$mol=',
    smartPasteSmiles: false,
    smartPasteMol: false,
    useSvgSmiles: false
};

export default class ChemEditPlugin extends Plugin {
    settings: ChemEditSettings;
    
    hiddenKetcherContainer: HTMLDivElement;
    headlessKetcher: any = null;
    headlessRoot: any = null; 
    isProcessingHeadless = false;
    headlessQueue: { data: string, isInline: boolean, resolve: (el: HTMLElement | null) => void }[] = [];

    public api = {
        openEditor: (initialData: string, format: string, onSave: (data: string) => void) => {
            new KetcherModal(this, initialData, format, onSave).open();
        },
        renderStructure: async (data: string, width: number, height: number): Promise<HTMLElement | null> => {
            const originalW = this.settings.width;
            const originalH = this.settings.height;
            this.settings.width = width;
            this.settings.height = height;
            
            const el = await this.renderMoleculeToPreview(data, 'smiles', false);
            
            this.settings.width = originalW;
            this.settings.height = originalH;
            return el;
        }
    };

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChemEditSettingTab(this.app, this));

        this.hiddenKetcherContainer = document.createElement('div');
        this.hiddenKetcherContainer.className = 'chemedit-headless-ketcher';
        Object.assign(this.hiddenKetcherContainer.style, {
            position: 'absolute', top: '-10000px', left: '-10000px', 
            width: '800px', height: '600px', opacity: '0',
            pointerEvents: 'none', zIndex: '-1'
        });
        document.body.appendChild(this.hiddenKetcherContainer);

        this.app.workspace.onLayoutReady(() => {
            this.bootHeadlessKetcher();
        });

        this.registerView("chem-file-view", (leaf) => new ChemFileView(leaf, this));
        this.registerExtensions(["mol", "cdxml", "ket", "sdf", "rxn", "inchi", "smarts"], "chem-file-view");

        this.addRibbonIcon('hexagon', 'Draw New Molecule', () => {
            this.openNewDrawingModal();
        });

        this.addCommand({
            id: 'insert-new-molecule',
            name: 'Draw new SMILES molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    this.insertSmilesAtCursor(editor, newData, newFormat || "smiles");
                }).open();
            }
        });

        this.addCommand({
            id: 'insert-inline-molecule',
            name: 'Draw new inline molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    if (newFormat === "ket") {
                        new Notice("Cannot save inline reaction. Inserting as code block instead.");
                        this.insertSmilesAtCursor(editor, newData, "ket");
                        return;
                    }
                    const cursor = editor.getCursor();
                    const textToInsert = `${this.settings.inlineSmilesPrefix}${newData} `;
                    editor.replaceRange(textToInsert, cursor);
                    editor.setCursor({ line: cursor.line, ch: cursor.ch + textToInsert.length });
                }).open();
            }
        });

        this.registerMarkdownPostProcessor(async (el, ctx) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            const nodes: Text[] = [];
            let node;
            while (node = walker.nextNode()) nodes.push(node as Text);

            for (const n of nodes) {
                const text = n.nodeValue || "";
                if (this.settings.inlineSmilesPrefix && text.includes(this.settings.inlineSmilesPrefix)) {
                    this.processInlineString(n, text, this.settings.inlineSmilesPrefix, 'smiles', ctx.sourcePath);
                }
                else if (this.settings.inlineMolPrefix && text.includes(this.settings.inlineMolPrefix)) {
                    this.processInlineString(n, text, this.settings.inlineMolPrefix, 'file', ctx.sourcePath);
                }
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor) => {
                const text = evt.clipboardData?.getData('text/plain');
                if (!text) return;

                const cleanText = text.trim();
                if (this.settings.smartPasteMol && (cleanText.includes('V2000') || cleanText.includes('V3000'))) {
                    evt.preventDefault();
                    const cursor = editor.getCursor();
                    editor.replaceRange(`\`\`\`mol\n${cleanText}\n\`\`\`\n`, cursor);
                    return;
                }
                
                const smilesRegex = /^([BCNOPSFIcbcnops@+\-\[\]\(\)\\\/=#%0-9]{4,})$/;
                if (this.settings.smartPasteSmiles && smilesRegex.test(cleanText) && /[CNOcno]/.test(cleanText)) {
                    evt.preventDefault();
                    const cursor = editor.getCursor();
                    editor.replaceRange(`\`\`\`smiles\n${cleanText}\n\`\`\`\n`, cursor);
                }
            })
        );

        this.addCommand({
            id: 'edit-inline-molecule-at-cursor',
            name: 'Edit inline molecule under cursor',
            editorCallback: (editor: Editor) => {
                const cursor = editor.getCursor();
                const lineText = editor.getLine(cursor.line);
                const prefix = this.settings.inlineSmilesPrefix;
                
                const startIndex = lineText.lastIndexOf(prefix, cursor.ch);
                if (startIndex !== -1) {
                    const searchArea = lineText.substring(startIndex + prefix.length);
                    const match = searchArea.match(/[\s`'"]/);
                    const endIndex = match ? startIndex + prefix.length + match.index : lineText.length;
                    
                    if (cursor.ch >= startIndex && cursor.ch <= endIndex) {
                        const rawData = lineText.substring(startIndex + prefix.length, endIndex).trim();
                        new KetcherModal(this, rawData, "smiles", (newData, isFile, newFormat) => {
                            if (newFormat === "ket") {
                                new Notice("Inline reactions not supported. Replaced with codeblock.");
                                editor.replaceRange(`\n\`\`\`ket\n${newData}\n\`\`\`\n`, 
                                    {line: cursor.line, ch: startIndex}, 
                                    {line: cursor.line, ch: endIndex}
                                );
                                return;
                            }
                            editor.replaceRange(newData, 
                                {line: cursor.line, ch: startIndex + prefix.length}, 
                                {line: cursor.line, ch: endIndex}
                            );
                        }).open();
                        return;
                    }
                }
                new Notice("Place your cursor inside an inline $smiles= string first!");
            }
        });

        this.registerMarkdownCodeBlockProcessor("eln", async (source, el, ctx) => {
            const { parseYaml } = require('obsidian'); 
            
            const wrapper = el.createDiv();
            wrapper.style.border = "1px solid var(--background-modifier-border)";
            wrapper.style.padding = "25px";
            wrapper.style.borderRadius = "12px";
            wrapper.style.backgroundColor = "var(--background-primary)";
            wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
            wrapper.style.fontFamily = "var(--font-interface)";
            wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Calculating Stoichiometry...</h3>`;

            try {
                const data = parseYaml(source);
                if (!data.reactants || !data.products) throw new Error("ELN block must contain 'reactants' and 'products'.");

                const fetchChemProps = async (smiles: string) => {
                    try {
                        const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/MolecularWeight,MolecularFormula/JSON`);
                        const props = res.json.PropertyTable.Properties[0];
                        return { mw: parseFloat(props.MolecularWeight), formula: props.MolecularFormula };
                    } catch { return { mw: 0, formula: "Unknown" }; }
                };

                for (const r of data.reactants) {
                    if (r.smiles && (!r.mw || !r.formula)) {
                        const props = await fetchChemProps(r.smiles);
                        r.mw = r.mw || props.mw; r.formula = r.formula || props.formula;
                    }
                }
                for (const p of data.products) {
                    if (p.smiles && (!p.mw || !p.formula)) {
                        const props = await fetchChemProps(p.smiles);
                        p.mw = p.mw || props.mw; p.formula = p.formula || props.formula;
                    }
                }

                let refMmol = data.reference_amount || 0;
                if (refMmol === 0) {
                    const baseR = data.reactants.find((r: any) => r.eq === 1 && r.mass);
                    if (baseR && baseR.mw) refMmol = baseR.mass / baseR.mw;
                }

                data.reactants.forEach((r: any) => {
                    r.eq = r.eq || 1;
                    r.mmol = r.mmol || (refMmol * r.eq);
                    if (!r.mass && r.mw) r.mass = r.mmol * r.mw;
                    if (r.mass && r.density) r.volume = (r.mass / 1000) / r.density;
                });

                data.products.forEach((p: any) => {
                    p.eq = p.eq || 1;
                    p.theory_mmol = refMmol * p.eq;
                    p.theory_mass = p.theory_mmol * p.mw;
                    if (p.mass_isolated) {
                        p.yield = ((p.mass_isolated / p.theory_mass) * 100).toFixed(1);
                        p.mmol_isolated = p.mass_isolated / p.mw;
                    }
                });

                const isDark = document.body.hasClass("theme-dark");
                const theme = isDark ? this.settings.darkTheme : this.settings.lightTheme;
                const thColor = "var(--background-secondary-alt)"; 
                const bdColor = "var(--background-modifier-border-hover)";
                const textColor = "var(--text-normal)";

                let html = `<div style="font-size: 14px; color: ${textColor};">`;

                html += `
                <div style="display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);">${data.code || data.id || 'Reaction Scheme'}</h2>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        ${data.date ? `<b>Created:</b> ${data.date} &nbsp;|&nbsp; ` : ''}
                        ${data.author ? `<b>Author:</b> ${data.author}` : ''}
                    </div>
                </div>`;

                html += `<div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; padding: 15px; margin-bottom: 20px; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--background-modifier-border);">`;
                
                data.reactants.forEach((r: any, i: number) => {
                    if(i > 0) html += `<div style="font-size: 20px; font-weight: bold; color: var(--text-muted); margin: 0 10px;">+</div>`;
                    html += `<div style="display: flex; flex-direction: column; align-items: center; margin: 0 5px;">
                        <div id="scheme_r_${i}" style="width: 110px; height: 110px;"></div>
                        <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">${r.eq || 1} eq</div>
                    </div>`;
                });

                html += `<div style="display: flex; flex-direction: column; align-items: center; margin: 0 20px;">
                    <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.temperature || ''}</div>
                    <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.duration || ''}</div>
                    <div style="font-size: 28px; font-weight: bold; line-height: 0.8; color: var(--text-normal); margin: 4px 0;">⟶</div>
                    <div style="font-size: 11px; color: var(--text-muted); text-align: center; font-weight: 500;">${data.solvent || ''}</div>
                </div>`;

                data.products.forEach((p: any, i: number) => {
                    if(i > 0) html += `<div style="font-size: 20px; font-weight: bold; color: var(--text-muted); margin: 0 10px;">+</div>`;
                    html += `<div style="display: flex; flex-direction: column; align-items: center; margin: 0 5px;">
                        <div id="scheme_p_${i}" style="width: 110px; height: 110px;"></div>
                        <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">${p.eq || 1} eq</div>
                    </div>`;
                });
                
                html += `</div>`;

                html += `
                <div style="display: flex; justify-content: flex-start; gap: 30px; background: var(--background-secondary-alt); padding: 10px 15px; border-radius: 6px; margin-bottom: 25px; font-size: 13px;">
                    <div><b style="color:var(--text-muted);">Duration:</b> ${data.duration || '-'}</div>
                    <div><b style="color:var(--text-muted);">Solvent:</b> ${data.solvent || '-'}</div>
                    <div><b style="color:var(--text-muted);">Temperature:</b> ${data.temperature || '-'}</div>
                    ${data.atmosphere ? `<div><b style="color:var(--text-muted);">Atmosphere:</b> ${data.atmosphere}</div>` : ''}
                </div>`;
                
                html += `
                    <h4 style="margin-bottom: 10px; margin-top: 0; color: var(--text-normal);">Reactants</h4>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px; text-align: left; font-size: 13px;">
                        <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                            <th style="padding: 10px;">eq</th>
                            <th style="padding: 10px;">Structure</th>
                            <th style="padding: 10px;">Name</th>
                            <th style="padding: 10px;">Formula</th>
                            <th style="padding: 10px;">MW</th>
                            <th style="padding: 10px;">n [mmol]</th>
                            <th style="padding: 10px;">m [mg]</th>
                            <th style="padding: 10px;">V [ml]</th>
                        </tr>`;
                
                data.reactants.forEach((r: any, i: number) => {
                    html += `<tr style="border-bottom: 1px solid ${bdColor};">
                        <td style="padding: 10px; font-weight:500;">${r.eq}</td>
                        <td style="padding: 10px;"><div id="table_r_${i}" style="width: 90px; height: 90px;"></div></td>
                        <td style="padding: 10px;"><b>${r.name || '-'}</b></td>
                        <td style="padding: 10px; color:var(--text-muted);">${r.formula || '-'}</td>
                        <td style="padding: 10px; color:var(--text-muted);">${r.mw ? r.mw.toFixed(2) : '-'}</td>
                        <td style="padding: 10px;">${r.mmol ? r.mmol.toFixed(2) : '-'}</td>
                        <td style="padding: 10px;">${r.mass ? r.mass.toFixed(1) : '-'}</td>
                        <td style="padding: 10px;">${r.volume ? r.volume.toFixed(3) : '-'}</td>
                    </tr>`;
                });

                html += `</table><h4 style="margin-bottom: 10px; color: var(--text-normal);">Products</h4>
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; margin-bottom: 20px;">
                        <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                            <th style="padding: 10px;">eq</th>
                            <th style="padding: 10px;">Structure</th>
                            <th style="padding: 10px;">Name</th>
                            <th style="padding: 10px;">MW</th>
                            <th style="padding: 10px;">n [mmol]</th>
                            <th style="padding: 10px;">m [mg]</th>
                            <th style="padding: 10px;">Yield [%]</th>
                        </tr>`;

                data.products.forEach((p: any, i: number) => {
                    html += `<tr style="border-bottom: 1px solid ${bdColor};">
                        <td style="padding: 10px; font-weight:500;">${p.eq}</td>
                        <td style="padding: 10px;"><div id="table_p_${i}" style="width: 90px; height: 90px;"></div></td>
                        <td style="padding: 10px;"><b>${p.name || '-'}</b></td>
                        <td style="padding: 10px; color:var(--text-muted);">${p.mw ? p.mw.toFixed(2) : '-'}</td>
                        <td style="padding: 10px;">${p.mmol_isolated ? p.mmol_isolated.toFixed(2) : p.theory_mmol.toFixed(2)}</td>
                        <td style="padding: 10px;">${p.mass_isolated ? p.mass_isolated.toFixed(1) : '-'}</td>
                        <td style="padding: 10px; font-size: 14px; color: var(--text-success);"><b>${p.yield ? p.yield + '%' : '-'}</b></td>
                    </tr>`;
                });

                html += `</table>`;

                if (data.procedure || data.notes) {
                    html += `
                    <div style="margin-top: 20px; padding: 15px; background: var(--background-secondary); border-radius: 8px; border-left: 4px solid var(--interactive-accent);">
                        <b style="color: var(--text-normal); display: block; margin-bottom: 5px;">Procedure / Notes:</b>
                        <div style="color: var(--text-muted); white-space: pre-wrap; font-size: 13px;">${data.procedure || data.notes}</div>
                    </div>`;
                }

                html += `</div>`;
                wrapper.innerHTML = html;

                // @ts-ignore
                const Smi = SmiDrawer;
                
                const draw = (id: string, smiles: string, cssSize: number, type: 'reactants'|'products', idx: number) => {
                    if (!smiles) return;
                    requestAnimationFrame(() => {
                        const container = wrapper.querySelector(id) as HTMLElement;
                        if(container) {
                            try {
                                if (this.settings.useSvgSmiles) {
                                    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                                    const opts = { width: cssSize, height: cssSize, compactDrawing: false };
                                    svg.style.width = `${cssSize}px`;
                                    svg.style.height = `${cssSize}px`;
                                    container.appendChild(svg);
                                    Smi.parse(smiles, (tree: any) => new Smi.SvgDrawer(opts).draw(tree, svg, theme));
                                } else {
                                    const canvas = document.createElement("canvas");
                                    const opts = { width: cssSize * 2, height: cssSize * 2, compactDrawing: false };
                                    canvas.style.width = `${cssSize}px`;
                                    canvas.style.height = `${cssSize}px`;
                                    container.appendChild(canvas);
                                    Smi.parse(smiles, (tree: any) => new Smi.Drawer(opts).draw(tree, canvas, theme));
                                }

                                container.style.cursor = "pointer";
                                container.title = "Double-click to edit structure";
                                container.addEventListener("dblclick", async (e) => {
                                    e.stopPropagation();
                                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                                    if (!view) return;
                                    const info = ctx.getSectionInfo(el);
                                    
                                    new KetcherModal(this, smiles, "smiles", (newData, isFile, newFormat) => {
                                        if (newFormat === "ket") {
                                            new Notice("ELN tables only support SMILES. Arrow discarded.");
                                            return;
                                        }
                                        const editor = view.editor;
                                        if (info) {
                                            const { parseYaml, stringifyYaml } = require('obsidian');
                                            const blockText = editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                            try {
                                                const yamlObj = parseYaml(blockText);
                                                yamlObj[type][index].smiles = newData;
                                                delete yamlObj[type][index].mw;
                                                delete yamlObj[type][index].formula;
                                                const newYaml = stringifyYaml(yamlObj);
                                                editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                                            } catch (e) {
                                                new Notice("Error updating ELN YAML block.");
                                            }
                                        }
                                    }).open();
                                });
                            } catch(e) {}
                        }
                    });
                };

                data.reactants.forEach((r: any, i: number) => {
                    draw(`#scheme_r_${i}`, r.smiles, 110, 'reactants', i);
                    draw(`#table_r_${i}`, r.smiles, 90, 'reactants', i);
                });
                
                data.products.forEach((p: any, i: number) => {
                    draw(`#scheme_p_${i}`, p.smiles, 110, 'products', i);
                    draw(`#table_p_${i}`, p.smiles, 90, 'products', i);
                });

            } catch (err: any) {
                wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>ELN Formatting Error:</b><br>${err.message}</div>`;
            }
        });

        const fileCodeblockProcessor = async (source: string, el: HTMLElement, ctx: any, defaultFormat: string) => {
            const wrapper = this.createBaseWrapper(`Loading preview...`);
            el.appendChild(wrapper);

            const rawData = source.trim();
            const bracketMatch = rawData.match(/\[\[(.*?)\]\]/);
            let filenameToSearch = "";
            
            if (bracketMatch && bracketMatch[1]) {
                filenameToSearch = bracketMatch[1];
            } else if (rawData.endsWith('.mol') || rawData.endsWith('.cdxml') || rawData.endsWith('.sdf')) {
                filenameToSearch = rawData;
            }

            if (filenameToSearch) {
                const cleanLink = decodeURIComponent(filenameToSearch).split('#')[0].split('?')[0].trim();
                const file = this.app.metadataCache.getFirstLinkpathDest(cleanLink, ctx.sourcePath);
                
                if (file && file instanceof TFile) {
                    const format = file.extension.toLowerCase();
                    wrapper.title = `Double-click to edit ${file.name}`;
                    
                    const data = await this.app.vault.read(file);
                    const previewEl = await this.renderMoleculeToPreview(data, format, false);
                    
                    if (!wrapper.isConnected) return;
                    wrapper.empty();

                    if (previewEl) wrapper.appendChild(previewEl);
                    else wrapper.appendChild(this.createErrorCard(`Invalid format in ${file.name}`));

                    wrapper.addEventListener("dblclick", async (e) => {
                        e.stopPropagation();
                        const freshData = await this.app.vault.read(file);
                        new KetcherModal(this, freshData, format, async (newData, isFile, newFormat) => {
                            if (newFormat && newFormat !== format) {
                                new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`);
                            }
                            await this.app.vault.modify(file, newData);
                            wrapper.innerHTML = `<span class="color-text-muted">Updating...</span>`;
                            const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false);
                            if (updatedEl && wrapper.isConnected) {
                                wrapper.empty(); wrapper.appendChild(updatedEl);
                            }
                        }).open();
                    });
                    return;
                }
                
                if (bracketMatch) {
                    wrapper.innerHTML = `<span class="color-red">File not found: ${cleanLink}</span>`;
                    return;
                }
            }

            if (!source.trim()) { wrapper.innerHTML = `Empty block.`; return; }

            wrapper.title = `Double-click to edit structure`;
            
            requestAnimationFrame(async () => {
                const previewEl = await this.renderMoleculeToPreview(source, defaultFormat, false);
                if (!wrapper.isConnected) return;
                wrapper.empty();
                if (previewEl) wrapper.appendChild(previewEl);
                else wrapper.appendChild(this.createErrorCard("Invalid chemical format"));
            });

            wrapper.addEventListener("dblclick", async (e) => {
                e.stopPropagation();
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const info = ctx.getSectionInfo(el);
                
                new KetcherModal(this, source, defaultFormat, (newData, isFile, newFormat) => {
                    const editor = view.editor;
                    if (info) {
                        const finalFormat = newFormat || defaultFormat;
                        editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, 
                            { line: info.lineStart, ch: 0 }, 
                            { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                    }
                }).open();
            });
        };

        ["mol", "cdxml", "ket", "sdf", "rxn", "inchi", "smarts"].forEach(fmt => {
            this.registerMarkdownCodeBlockProcessor(fmt, (s, e, c) => fileCodeblockProcessor(s, e, c, fmt));
        });

        this.registerMarkdownCodeBlockProcessor("smiles", (source, el, ctx) => {
            const cleanSmiles = source.trim();
            const wrapper = document.createElement("div");
            wrapper.style.cursor = "pointer";
            wrapper.title = "Double-click to edit structure";
            wrapper.style.display = "inline-block";
            el.appendChild(wrapper);

            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
            
            const cssW = this.settings.width;
            const cssH = this.settings.height;
            const drawerOptions = { width: cssW * 2, height: cssH * 2 };

            requestAnimationFrame(() => {
                try {
                    // @ts-ignore
                    const Smi: any = SmiDrawer; 

                    if (cleanSmiles.includes('>')) {
                        const rxnContainer = document.createElement("span");
                        rxnContainer.style.display = "inline-flex";
                        rxnContainer.style.alignItems = "center";
                        wrapper.appendChild(rxnContainer);
                        
                        Smi.parseReaction(cleanSmiles, (tree: any) => {
                            if (this.settings.useSvgSmiles) {
                                const rxnDrawer = new Smi.ReactionDrawer({width: cssW, height: cssH}, {width: cssW, height: cssH});
                                rxnDrawer.draw(tree, rxnContainer, theme);
                            } else {
                                const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                                rxnDrawer.draw(tree, rxnContainer, theme);
                                const canvases = rxnContainer.querySelectorAll('canvas');
                                canvases.forEach(c => {
                                    c.style.width = `${c.width / 2}px`;
                                    c.style.height = `${c.height / 2}px`;
                                });
                            }
                        }, (err: any) => wrapper.innerHTML = `<span class="color-red">Reaction Error: ${err}</span>`);
                    } else {
                        if (this.settings.useSvgSmiles) {
                            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                            svg.style.width = `${cssW}px`;
                            svg.style.height = `${cssH}px`;
                            wrapper.appendChild(svg);
                            Smi.parse(cleanSmiles, (tree: any) => {
                                const drawer = new Smi.SvgDrawer({width: cssW, height: cssH});
                                drawer.draw(tree, svg, theme);
                            }, (err: any) => wrapper.innerHTML = `<span class="color-red">Molecule Error: ${err}</span>`);
                        } else {
                            const canvas = document.createElement("canvas");
                            canvas.style.width = `${cssW}px`;
                            canvas.style.height = `${cssH}px`;
                            wrapper.appendChild(canvas);
                            Smi.parse(cleanSmiles, (tree: any) => {
                                const drawer = new Smi.Drawer(drawerOptions);
                                drawer.draw(tree, canvas, theme);
                            }, (err: any) => wrapper.innerHTML = `<span class="color-red">Molecule Error: ${err}</span>`);
                        }
                    }
                } catch (err: any) {
                    wrapper.innerHTML = `<span class="color-red">Drawer Error: ${err.message}</span>`;
                }
            });

            wrapper.addEventListener("dblclick", () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const info = ctx.getSectionInfo(el);
                new KetcherModal(this, cleanSmiles, "smiles", (newData, isFile, newFormat) => {
                    const editor = view.editor;
                    if (info) {
                        const finalFormat = newFormat || "smiles";
                        editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, 
                            { line: info.lineStart, ch: 0 }, 
                            { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                    }
                }).open();
            });
        });
    }

    createBaseWrapper(titleText: string): HTMLDivElement {
        const wrapper = document.createElement("div");
        wrapper.style.cursor = "pointer";
        wrapper.style.border = "1px solid var(--background-modifier-border)";
        wrapper.style.borderRadius = "8px";
        wrapper.style.padding = "10px";
        wrapper.style.textAlign = "center";
        wrapper.style.display = "block";
        wrapper.style.margin = "10px 0";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.title = titleText;
        wrapper.innerHTML = `<span class="color-text-muted">Loading preview...</span>`;
        return wrapper;
    }

    destroyHeadlessKetcher() {
        this.isProcessingHeadless = false;
        if (this.hiddenKetcherContainer) {
            if (this.headlessRoot) {
                this.headlessRoot.unmount();
                this.headlessRoot = null;
            } else {
                ReactDOM.unmountComponentAtNode(this.hiddenKetcherContainer);
            }
            this.headlessKetcher = null;
        }
    }

    bootHeadlessKetcher() {
        if (this.headlessKetcher || this.headlessRoot) return;

        const element = React.createElement(KetcherReact, {
            data: "C", 
            onInit: (ketcher: any) => {
                this.headlessKetcher = ketcher;
                setTimeout(() => this.processHeadlessQueue(), 500);
            },
            onChange: () => {}
        });

        if (createRoot) {
            this.headlessRoot = createRoot(this.hiddenKetcherContainer);
            this.headlessRoot.render(element);
        } else {
            ReactDOM.render(element, this.hiddenKetcherContainer);
        }
    }

    rebootHeadlessKetcher() {
        this.destroyHeadlessKetcher();
        setTimeout(() => this.bootHeadlessKetcher(), 100);
    }

    createErrorCard(msg: string): HTMLElement {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.border = '1px dashed var(--text-error)';
        div.style.color = 'var(--text-error)';
        div.style.borderRadius = '5px';
        div.style.textAlign = 'center';
        div.style.display = 'inline-block';
        div.innerHTML = `🧪 <b>${msg}</b><br><span class="color-text-muted" style="font-size: 0.8em">Double-click to open editor</span>`;
        return div;
    }

    async processInlineString(textNode: Text, fullText: string, prefix: string, type: 'smiles'|'file', sourcePath: string) {
        const startIndex = fullText.indexOf(prefix);
        let endIndex = fullText.indexOf(' ', startIndex);
        if (endIndex === -1) endIndex = fullText.length;

        const rawData = fullText.substring(startIndex + prefix.length, endIndex).trim();
        if (!rawData) return;

        const beforeText = fullText.substring(0, startIndex);
        const afterText = fullText.substring(endIndex);

        const parent = textNode.parentNode;
        if (!parent) return;

        const wrapper = document.createElement("span");
        wrapper.className = "chem-inline-wrapper";
        wrapper.style.display = "inline-block";
        wrapper.style.verticalAlign = "middle";
        wrapper.style.cursor = "pointer";
        wrapper.style.margin = "0 4px";
        wrapper.title = "Double-click to edit";
        wrapper.innerHTML = `<small class="color-text-muted">⏳</small>`;

        parent.insertBefore(document.createTextNode(beforeText), textNode);
        parent.insertBefore(wrapper, textNode);
        parent.insertBefore(document.createTextNode(afterText), textNode);
        parent.removeChild(textNode);

        const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
        const cssW = this.settings.inlineWidth;
        const cssH = this.settings.inlineHeight;
        const drawerOptions = { width: cssW * 2, height: cssH * 2 };

        if (type === 'smiles') {
            requestAnimationFrame(() => {
                try {
                    // @ts-ignore
                    const Smi: any = SmiDrawer; 
                    wrapper.innerHTML = '';
                    
                    if (rawData.includes('>')) {
                        const rxnContainer = document.createElement("span");
                        rxnContainer.style.display = "inline-flex";
                        rxnContainer.style.alignItems = "center";
                        wrapper.appendChild(rxnContainer);
                        
                        Smi.parseReaction(rawData, (tree: any) => {
                            if (this.settings.useSvgSmiles) {
                                const rxnDrawer = new Smi.ReactionDrawer({width: cssW, height: cssH}, {width: cssW, height: cssH});
                                rxnDrawer.draw(tree, rxnContainer, theme);
                            } else {
                                const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                                rxnDrawer.draw(tree, rxnContainer, theme);
                                const canvases = rxnContainer.querySelectorAll('canvas');
                                canvases.forEach(c => {
                                    c.style.width = `${c.width / 2}px`;
                                    c.style.height = `${c.height / 2}px`;
                                });
                            }
                        });
                    } else {
                        if (this.settings.useSvgSmiles) {
                            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                            svg.style.width = `${cssW}px`;
                            svg.style.height = `${cssH}px`;
                            wrapper.appendChild(svg);
                            Smi.parse(rawData, (tree: any) => {
                                const drawer = new Smi.SvgDrawer({width: cssW, height: cssH});
                                drawer.draw(tree, svg, theme);
                            });
                        } else {
                            const canvas = document.createElement("canvas");
                            canvas.style.width = `${cssW}px`;
                            canvas.style.height = `${cssH}px`;
                            wrapper.appendChild(canvas);
                            Smi.parse(rawData, (tree: any) => {
                                const drawer = new Smi.Drawer(drawerOptions);
                                drawer.draw(tree, canvas, theme);
                            });
                        }
                    }
                } catch(e) { wrapper.innerHTML = '❌'; }
            });

            wrapper.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                new KetcherModal(this, rawData, "smiles", (newData, isFile, newFormat) => {
                    if (newFormat === "ket") {
                        new Notice("Inline reactions not supported. Inserted as block.");
                        const content = editor.getValue();
                        const updatedContent = content.replace(prefix + rawData, `\n\`\`\`ket\n${newData}\n\`\`\`\n`);
                        editor.setValue(updatedContent);
                        return;
                    }
                    const editor = view.editor;
                    const content = editor.getValue();
                    const updatedContent = content.replace(prefix + rawData, prefix + newData);
                    editor.setValue(updatedContent);
                }).open();
            });

        } else if (type === 'file') {
            const cleanFileName = rawData.replace('[[', '').replace(']]', '');
            const file = this.app.metadataCache.getFirstLinkpathDest(cleanFileName, sourcePath);
            
            if (file && file instanceof TFile) {
                const format = file.extension.toLowerCase();
                const fileData = await this.app.vault.read(file);
                
                requestAnimationFrame(async () => {
                    const previewEl = await this.renderMoleculeToPreview(fileData, format, true);
                    if (previewEl && wrapper.isConnected) {
                        wrapper.innerHTML = '';
                        wrapper.appendChild(previewEl);
                    } else {
                        wrapper.innerHTML = `❌`;
                    }
                });

                wrapper.addEventListener("dblclick", async (e) => {
                    e.stopPropagation();
                    const freshData = await this.app.vault.read(file);
                    new KetcherModal(this, freshData, format, async (newData, isFile, newFormat) => {
                        if (newFormat && newFormat !== format) {
                            new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`);
                        }
                        await this.app.vault.modify(file, newData);
                        wrapper.innerHTML = `⏳`;
                        const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, true);
                        if (updatedEl && wrapper.isConnected) {
                            wrapper.innerHTML = '';
                            wrapper.appendChild(updatedEl);
                        }
                    }).open();
                });
            } else {
                wrapper.innerHTML = `❌`;
            }
        }
    }

    onunload() {
        this.destroyHeadlessKetcher();
        if (this.hiddenKetcherContainer) {
            this.hiddenKetcherContainer.remove();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    openNewDrawingModal() {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice("Please open a Markdown file first to insert a drawing.");
            return;
        }
        new KetcherModal(this, "", "smiles", (newSmiles, isFile, newFormat) => {
            this.insertSmilesAtCursor(view.editor, newSmiles, newFormat || "smiles");
        }).open();
    }

    insertSmilesAtCursor(editor: Editor, data: string, format: string) {
        const cursor = editor.getCursor();
        const textToInsert = `\`\`\`${format}\n${data}\n\`\`\`\n`;
        editor.replaceRange(textToInsert, cursor);
        editor.setCursor({ line: cursor.line + 3, ch: 0 });
    }

    async renderMoleculeToPreview(data: string, format: string, isInline: boolean = false): Promise<HTMLElement | null> {
        if (!data) return null;
        
        const normalizedFormat = format ? format.toLowerCase() : 'smiles';
        const cleanData = normalizedFormat === 'smiles' || normalizedFormat === 'eln' ? data.trim() : data; 

        const w = isInline ? this.settings.inlineWidth : this.settings.width;
        const h = isInline ? this.settings.inlineHeight : this.settings.height;
        const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
        
        const drawerOptions = { width: w * 2, height: h * 2 };

        try {
            if (normalizedFormat === 'smiles' || normalizedFormat === 'eln') {
                // @ts-ignore
                const Smi: any = SmiDrawer;

                if (cleanData.includes('>')) {
                    const rxnContainer = document.createElement("div");
                    rxnContainer.style.display = "flex";
                    rxnContainer.style.alignItems = "center";
                    rxnContainer.style.justifyContent = "center";
                    
                    Smi.parseReaction(cleanData, (tree: any) => {
                        if (this.settings.useSvgSmiles) {
                            const rxnDrawer = new Smi.ReactionDrawer({width: w, height: h}, {width: w, height: h});
                            rxnDrawer.draw(tree, rxnContainer, theme);
                        } else {
                            const rxnDrawer = new Smi.ReactionDrawer(drawerOptions, drawerOptions);
                            rxnDrawer.draw(tree, rxnContainer, theme);
                            const canvases = rxnContainer.querySelectorAll('canvas');
                            canvases.forEach(c => {
                                c.style.width = `${c.width / 2}px`;
                                c.style.height = `${c.height / 2}px`;
                            });
                        }
                    });
                    return rxnContainer;
                } else {
                    if (this.settings.useSvgSmiles) {
                        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                        svg.style.width = `${w}px`;
                        svg.style.height = `${h}px`;
                        Smi.parse(cleanData, (tree: any) => {
                            const drawer = new Smi.SvgDrawer({width: w, height: h});
                            drawer.draw(tree, svg, theme);
                        });
                        return svg;
                    } else {
                        const canvas = document.createElement("canvas");
                        canvas.style.width = `${w}px`;
                        canvas.style.height = `${h}px`;
                        Smi.parse(cleanData, (tree: any) => {
                            const drawer = new Smi.Drawer(drawerOptions);
                            drawer.draw(tree, canvas, theme);
                        });
                        return canvas;
                    }
                }
            } else if (['mol', 'cdxml', 'sdf', 'rxn', 'rdf', 'cml', 'ket', 'inchi', 'smarts'].includes(normalizedFormat)) {
                return new Promise((resolve) => {
                    this.headlessQueue.push({ data: cleanData, isInline, resolve });
                    this.processHeadlessQueue();
                });
            }
            return null;
        } catch (e) {
            console.error("Preview render failed:", e);
            return null;
        }
    }

    async processHeadlessQueue() {
        if (this.isProcessingHeadless || !this.headlessKetcher || this.headlessQueue.length === 0) return;
        
        this.isProcessingHeadless = true;
        const task = this.headlessQueue.shift();
        
        if (!task) {
            this.isProcessingHeadless = false;
            return;
        }

        let isResolved = false;
        
        const timeoutId = window.setTimeout(() => {
            if (isResolved) return;
            isResolved = true;
            task.resolve(this.createErrorCard("Preview timed out"));
            this.rebootHeadlessKetcher(); 
        }, 12000); 

        try {
            // STRICT SVG EXPORT (No fallbacks!)
            let img;
            try {
                img = await this.headlessKetcher.generateImage(task.data, { outputFormat: 'svg' });
            } catch (err) {
                // If direct rendering fails, load it into the editor and extract the KET representation
                await this.headlessKetcher.setMolecule(task.data);
                const ket = await this.headlessKetcher.getKet();
                img = await this.headlessKetcher.generateImage(ket, { outputFormat: 'svg' });
            }
            
            let svgText = "";
            if (typeof img === 'string') {
                if (img.startsWith('data:image/svg+xml;base64,')) {
                    svgText = atob(img.split(',')[1]);
                } else if (img.startsWith('data:image/svg+xml;utf8,')) {
                    svgText = decodeURIComponent(img.split(',')[1]);
                } else {
                    svgText = img;
                }
            } else if (img instanceof Blob) {
                svgText = await img.text();
            } else if (img && img.data) {
                svgText = img.data;
            }

            if (svgText && svgText.includes('<svg')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(svgText, 'image/svg+xml');
                const svgEl = doc.documentElement;
                
                // SVG FIX: Calculate proper viewBox to prevent stretching and text distortion
                const wAttr = svgEl.getAttribute('width');
                const hAttr = svgEl.getAttribute('height');
                if (wAttr && hAttr && !svgEl.hasAttribute('viewBox')) {
                    const parsedW = parseFloat(wAttr.replace(/px/g, ''));
                    const parsedH = parseFloat(hAttr.replace(/px/g, ''));
                    if (!isNaN(parsedW) && !isNaN(parsedH)) {
                        svgEl.setAttribute('viewBox', `0 0 ${parsedW} ${parsedH}`);
                    }
                }

                svgEl.removeAttribute('width');
                svgEl.removeAttribute('height');
                svgEl.style.width = '100%';
                svgEl.style.height = '100%';
                
                const w = task.isInline ? this.settings.inlineWidth : this.settings.width;
                const h = task.isInline ? this.settings.inlineHeight : this.settings.height;

                const container = document.createElement('div');
                container.className = 'chemedit-svg-preview';
                container.style.width = `${w}px`;
                container.style.height = `${h}px`;
                container.style.display = 'flex';
                container.style.justifyContent = 'center';
                container.style.alignItems = 'center';
                
                // CSS RESET: Protects Ketcher's text rendering from Obsidian's global CSS
                container.style.lineHeight = 'normal';
                container.style.fontFamily = 'Arial, Helvetica, sans-serif';
                container.style.letterSpacing = 'normal';
                container.style.textAlign = 'left';

                container.appendChild(svgEl);

                isResolved = true;
                window.clearTimeout(timeoutId);
                task.resolve(container);
                this.finishHeadlessTask();
                return;
            }

            throw new Error("Empty image returned");
        } catch (e) {
            if (!isResolved) {
                isResolved = true;
                window.clearTimeout(timeoutId);
                task.resolve(this.createErrorCard("Invalid chemical format"));
                this.finishHeadlessTask();
            }
        }
    }

    finishHeadlessTask() {
        this.isProcessingHeadless = false;
        window.setTimeout(() => this.processHeadlessQueue(), 25); 
    }
}

class ChemFileView extends TextFileView {
    plugin: ChemEditPlugin;
    
    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return "chem-file-view"; }
    getDisplayText() { return this.file ? this.file.name : "Molecule View"; }
    getIcon() { return "hexagon"; }
    getViewData() { return this.data; }

    async setViewData(data: string, clear: boolean) {
        this.data = data;
        const container = this.contentEl;
        container.empty();

        const wrapper = container.createDiv();
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.justifyContent = "center";
        wrapper.style.width = "100%";
        wrapper.style.height = "100%";
        wrapper.style.cursor = "pointer";
        wrapper.title = "Double-click to edit";
        wrapper.innerHTML = `<div class="color-text-muted">Loading preview...</div>`;

        const format = this.file?.extension === 'cdxml' ? 'cdxml' : 'mol';
        
        requestAnimationFrame(async () => {
            const previewEl = await this.plugin.renderMoleculeToPreview(data, format);
            wrapper.empty();
            if (previewEl) {
                wrapper.appendChild(previewEl);
            } else {
                wrapper.appendChild(this.plugin.createErrorCard("Failed to load view"));
            }
        });

        wrapper.ondblclick = () => {
            new KetcherModal(this.plugin, this.data, format, async (newData, isFile, newFormat) => {
                if (newFormat && newFormat !== format) {
                    new Notice(`Format was upgraded to ${newFormat}. Please rename the file extension!`);
                }
                this.data = newData;
                this.requestSave(); 
                this.setViewData(newData, false); 
            }).open();
        };
    }

    clear() {
        this.data = "";
        this.contentEl.empty();
    }
}

class KetcherModal extends Modal {
    plugin: ChemEditPlugin;
    initialData: string;
    format: string;
    onSave: (data: string, isFile: boolean, format?: string) => void;
    ketcherInstance: any = null;
    reactRoot: any = null; 
    isSavingAsFile: string | null = null;

    constructor(plugin: ChemEditPlugin, initialData: string, format: string, onSave: (data: string, isFile: boolean, format?: string) => void) {
        super(plugin.app);
        this.plugin = plugin;
        this.initialData = initialData;
        this.format = format;
        this.onSave = onSave;
    }

    onOpen() {
        this.plugin.destroyHeadlessKetcher();

        const { contentEl } = this;
        contentEl.empty();
        
        this.modalEl.style.width = "85vw";
        this.modalEl.style.height = "85vh";
        contentEl.style.height = "100%";
        contentEl.style.display = "flex";
        contentEl.style.flexDirection = "column";

        const reactContainer = contentEl.createDiv();
        reactContainer.style.flex = "1 1 auto";
        reactContainer.style.width = "100%";
        reactContainer.style.minHeight = "400px"; 
        reactContainer.style.position = "relative";

        const element = React.createElement(KetcherReact, {
            data: this.initialData,
            onInit: (ketcher: any) => {
                this.ketcherInstance = ketcher;
            },
            onChange: () => {}
        });

        if (createRoot) {
            this.reactRoot = createRoot(reactContainer);
            this.reactRoot.render(element);
        } else {
            ReactDOM.render(element, reactContainer);
        }

        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.marginTop = "10px";
        btnContainer.style.paddingTop = "10px";
        btnContainer.style.gap = "10px";

        const saveBtn = btnContainer.createEl("button", { text: "Save", cls: "mod-cta" });
        const saveFileBtn = btnContainer.createEl("button", { text: "Save as .mol File" });
        const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });

        const doSave = async (formatToGet: string) => {
            if (!this.ketcherInstance || (!this.ketcherInstance.editor && !this.ketcherInstance.server)) {
                new Notice("Ketcher is still initializing...");
                return;
            }
            try {
                let resultData = "";
                let finalFormat = formatToGet.toLowerCase();
                
                try {
                    if (finalFormat === "smiles") {
                        resultData = await this.ketcherInstance.getSmiles();
                    } else if (finalFormat === "ket") {
                        resultData = await this.ketcherInstance.getKet(); 
                    } else if (finalFormat === "inchi") {
                        resultData = await this.ketcherInstance.getInchi();
                    } else if (finalFormat === "smarts") {
                        resultData = await this.ketcherInstance.getSmarts();
                    } else if (finalFormat === "cdxml") {
                        if (typeof this.ketcherInstance.getCDXml === "function") {
                            resultData = await this.ketcherInstance.getCDXml();
                        } else if (typeof this.ketcherInstance.getCdxml === "function") {
                            resultData = await this.ketcherInstance.getCdxml();
                        } else {
                            resultData = await this.ketcherInstance.getMolfile();
                        }
                    } else {
                        resultData = await this.ketcherInstance.getMolfile();
                    }
                } catch (err: any) {
                    if (err.message && err.message.toLowerCase().includes('reaction')) {
                        resultData = await this.ketcherInstance.getKet();
                        finalFormat = "ket";
                        new Notice("Reactions cannot be saved in this format. Automatically upgraded to .KET format.");
                        
                        if (this.isSavingAsFile) {
                            this.isSavingAsFile = this.isSavingAsFile.replace(/\.mol$/i, '.ket');
                        }
                    } else {
                        throw err;
                    }
                }

                if (this.isSavingAsFile) {
                    const fileName = this.isSavingAsFile;
                    await this.plugin.app.vault.create(fileName, resultData);
                    this.onSave(`[[${fileName}]]`, true, finalFormat);
                } else {
                    this.onSave(resultData, false, finalFormat);
                }
                this.close();
            } catch (e: any) {
                new Notice("Error saving from Ketcher: " + (e.message || e));
            }
        };

        saveBtn.onclick = () => doSave(this.format);

        saveFileBtn.onclick = () => {
            new FilenamePromptModal(this.plugin.app, (filename) => {
                let safeName = filename.trim();
                if (!safeName.endsWith('.mol')) safeName += '.mol';
                this.isSavingAsFile = safeName;
                doSave('mol');
            }).open();
        };

        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        try {
            const editor = this.ketcherInstance?.editor;
            if (editor) {
                if (editor.events) {
                    editor.events = { on: () => {}, off: () => {}, emit: () => {} };
                }
                if (editor.shortcuts && typeof editor.shortcuts.disable === 'function') {
                    editor.shortcuts.disable();
                }
            }
        } catch (e) { }

        const container = this.contentEl.querySelector("div");
        if (container) {
            if (this.reactRoot) {
                this.reactRoot.unmount();
                this.reactRoot = null;
            } else {
                ReactDOM.unmountComponentAtNode(container);
            }
        }
        this.contentEl.empty();
        
        this.plugin.bootHeadlessKetcher();
    }
}

class FilenamePromptModal extends Modal {
    onSubmit: (filename: string) => void;

    constructor(app: App, onSubmit: (filename: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Enter a filename:" });
        
        const input = contentEl.createEl("input", { type: "text", placeholder: "molecule.mol" });
        input.style.width = "100%";
        input.style.marginBottom = "10px";
        
        input.addEventListener("keypress", (e) => {
            if (e.key === "Enter" && input.value) {
                this.onSubmit(input.value);
                this.close();
            }
        });

        const btn = contentEl.createEl("button", { text: "Save", cls: "mod-cta" });
        btn.onclick = () => {
            if(input.value) { this.onSubmit(input.value); this.close(); }
        };
        
        setTimeout(() => input.focus(), 50);
    }

    onClose() { this.contentEl.empty(); }
}

class ChemEditSettingTab extends PluginSettingTab {
    plugin: ChemEditPlugin;

    constructor(app: App, plugin: ChemEditPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'ChemEdit Settings'});

        containerEl.createEl('h3', { text: 'Ketcher Status' });
        const statusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        statusEl.innerHTML = `<span style="color:var(--text-success); font-size:1.2em">✅ <b>Bundled Ketcher Active</b></span><br>Ketcher is running directly inside Obsidian. Completely offline and fast!`;

        containerEl.createEl('h3', { text: 'Smart Paste Behavior' });

        new Setting(containerEl)
            .setName('Auto-format pasted SMILES')
            .setDesc('Automatically wrap pasted SMILES strings in a codeblock so they render as images instantly.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.smartPasteSmiles)
                .onChange(async (value) => {
                    this.plugin.settings.smartPasteSmiles = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-format pasted MOL text')
            .setDesc('Automatically wrap pasted MOL files (from ChemDraw/Marvin) in a codeblock.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.smartPasteMol)
                .onChange(async (value) => {
                    this.plugin.settings.smartPasteMol = value;
                    await this.plugin.saveSettings();
                }));
				
        containerEl.createEl('br');
        containerEl.createEl('h3', { text: 'Block Embeds' });

        new Setting(containerEl)
            .setName('Image Width')
            .setDesc('Width of the rendered structure blocks (pixels)')
            .addText(text => text.setPlaceholder('300').setValue(this.plugin.settings.width.toString())
                .onChange(async (v) => { this.plugin.settings.width = parseInt(v) || 300; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Image Height')
            .setDesc('Height of the rendered structure blocks (pixels)')
            .addText(text => text.setPlaceholder('300').setValue(this.plugin.settings.height.toString())
                .onChange(async (v) => { this.plugin.settings.height = parseInt(v) || 300; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Render SMILES as SVG (Experimental)')
            .setDesc('Uses SVG instead of High-DPI Canvas for SMILES blocks. Looks crisper at extreme zoom levels, but might mislabel atoms (O to C) due to known bugs in the library.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useSvgSmiles)
                .onChange(async (value) => {
                    this.plugin.settings.useSvgSmiles = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Inline Embeds (Tables & Sentences)' });

        new Setting(containerEl)
            .setName('Inline Image Width')
            .setDesc('Max width for structures rendered inline (e.g. $smiles=...)')
            .addText(text => text.setPlaceholder('150').setValue(this.plugin.settings.inlineWidth.toString())
                .onChange(async (v) => { this.plugin.settings.inlineWidth = parseInt(v) || 150; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Inline Image Height')
            .setDesc('Max height for structures rendered inline')
            .addText(text => text.setPlaceholder('150').setValue(this.plugin.settings.inlineHeight.toString())
                .onChange(async (v) => { this.plugin.settings.inlineHeight = parseInt(v) || 150; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Inline SMILES Prefix')
            .setDesc('Text prefix used to trigger inline SMILES rendering')
            .addText(text => text.setValue(this.plugin.settings.inlineSmilesPrefix)
                .onChange(async (v) => { this.plugin.settings.inlineSmilesPrefix = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Inline File Prefix')
            .setDesc('Text prefix used to trigger inline .mol and .cdxml rendering')
            .addText(text => text.setValue(this.plugin.settings.inlineMolPrefix)
                .onChange(async (v) => { this.plugin.settings.inlineMolPrefix = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h3', { text: 'Theming' });

        const themeOptions = {
            'light': 'Light', 'dark': 'Dark', 'oldschool': 'Oldschool (B&W)',
            'solarized': 'Solarized Light', 'solarized-dark': 'Solarized Dark',
            'matrix': 'Matrix', 'cyberpunk': 'Cyberpunk'
        };

        new Setting(containerEl)
            .setName('Light Theme')
            .addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.lightTheme)
                .onChange(async (value) => { this.plugin.settings.lightTheme = value; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Dark Theme')
            .addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.darkTheme)
                .onChange(async (value) => { this.plugin.settings.darkTheme = value; await this.plugin.saveSettings(); }));
    }
}
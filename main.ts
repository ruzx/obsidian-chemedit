import { App, Modal, Plugin, MarkdownView, PluginSettingTab, Setting, Editor, Notice, requestUrl, TextFileView, WorkspaceLeaf, TFile, addIcon } from 'obsidian';
import React from 'react';
import ReactDOM from 'react-dom';
import SmiDrawer from 'smiles-drawer';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import KetcherReact from './KetcherReact';
import { RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, WidgetType, Decoration, DecorationSet } from "@codemirror/view";

// Modular Imports
import { SharedElnRenderer, createNewElnExperiment, CreateExperimentModal, ElnGalleryRenderer } from './SharedEln';
import { takeStandardPhoto, saveMediaFile, TlcModal } from './SharedMedia';
import { SharedGalleryRenderer } from './SharedGallery';

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
    mediaSavePath: string;
    showMediaRibbonIcons: boolean; 
    showElnRibbonIcon: boolean;
    elnDirectory: string;
    elnPrefix: string;
    elnSections: string;
    supportedEmbedExtensions: string;
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
    useSvgSmiles: true, // Now defaults to true
    mediaSavePath: "Assets/",
    showMediaRibbonIcons: false, 
    showElnRibbonIcon: true,
    elnDirectory: "",
    elnPrefix: "EXP",
    elnSections: "TLC, LCMS, NMR",
    supportedEmbedExtensions: "mol, cdxml, ket, sdf, rxn, inchi, smarts"
};

export default class ChemEditPlugin extends Plugin {
    settings: ChemEditSettings;
    
    hiddenKetcherContainer: HTMLDivElement;
    headlessKetcher: any = null;
    headlessRoot: any = null; 
    isProcessingHeadless = false;
    headlessQueue: { data: string, isInline: boolean, resolve: (el: HTMLElement | null) => void }[] = [];

    // Ribbon Icon References
    cameraRibbonEl: HTMLElement | null = null;
    tlcRibbonEl: HTMLElement | null = null;
    elnRibbonEl: HTMLElement | null = null;

    // Helper to get extensions as clean array
    getSupportedExts(): string[] {
        return this.settings.supportedEmbedExtensions.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
    }

    refreshRibbonIcons() {
        // 1. Handle Media Icons
        if (this.settings.showMediaRibbonIcons) {
            if (!this.cameraRibbonEl) {
                this.cameraRibbonEl = this.addRibbonIcon('camera', 'Take Lab Photo', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view) { new Notice("Place cursor in a Markdown file first."); return; }
                    takeStandardPhoto(async (buffer, ext) => {
                        const link = await saveMediaFile(this.app, buffer, this.settings.mediaSavePath, `Photo_${window.moment().format("YYYYMMDD_HHmmss")}.${ext}`);
                        view.editor.replaceSelection(`\n![[${link}]]\n`);
                    });
                });
            } else { this.cameraRibbonEl.style.display = ''; }
            
            if (!this.tlcRibbonEl) {
                this.tlcRibbonEl = this.addRibbonIcon('image-file', 'Add TLC Plate', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view) { new Notice("Place cursor in a Markdown file first."); return; }
                    new TlcModal(this.app, async (pngData, rfData) => {
                        const link = await saveMediaFile(this.app, pngData, this.settings.mediaSavePath, `TLC_${window.moment().format("YYYYMMDD_HHmmss")}.png`);
                        let md = `\n![[${link}]]\n\n| Spot | $R_f$ |\n|---|---|\n`;
                        rfData.forEach((s, i) => md += `| ${i+1} | **${s.rf.toFixed(2)}** |\n`);
                        view.editor.replaceSelection(md);
                    }).open();
                });
            } else { this.tlcRibbonEl.style.display = ''; }
        } else {
            if (this.cameraRibbonEl) this.cameraRibbonEl.style.display = 'none';
            if (this.tlcRibbonEl) this.tlcRibbonEl.style.display = 'none';
        }

        // 2. Handle the Blank ELN Icon
        if (this.settings.showElnRibbonIcon) {
            if (!this.elnRibbonEl) {
                this.elnRibbonEl = this.addRibbonIcon('flask-round', 'Create Blank ELN Experiment', () => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    const currentFolder = this.settings.elnDirectory ? this.settings.elnDirectory : (view?.file?.parent?.path || "");
                    
                    new CreateExperimentModal(this, this.settings.elnPrefix, async (expCode) => {
                        await createNewElnExperiment(this.app, expCode, currentFolder, this.settings.elnSections);
                    }).open();
                });
            } else {
                this.elnRibbonEl.style.display = '';
            }
        } else {
            if (this.elnRibbonEl) this.elnRibbonEl.style.display = 'none';
        }
    }

    async onload() {
        // Register custom Round Bottom Flask icon
        addIcon('flask-round', `<polygon fill="none" stroke="currentColor" stroke-width="6" points="50,5 89,27.5 89,72.5 50,95 11,72.5 11,27.5" stroke-linejoin="round"/><path fill="none" stroke="currentColor" stroke-width="5" d="M 42 35 L 42 55 A 18 18 0 1 0 58 55 L 58 35 Z" stroke-linejoin="round"/><line x1="36" y1="35" x2="64" y2="35" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="32" y1="65" x2="68" y2="65" stroke="currentColor" stroke-width="4" stroke-dasharray="4 4"/>`);
        
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

        const exts = this.getSupportedExts();
        this.registerView("chem-file-view", (leaf) => new ChemFileView(leaf, this));
        this.registerExtensions(exts, "chem-file-view");
        this.registerEditorExtension(this.buildLivePreviewPlugin());
		
		// --- ELN GALLERY PROCESSOR ---
        this.registerMarkdownCodeBlockProcessor("eln-gallery", async (source, el, ctx) => {
            const galleryRenderer = new ElnGalleryRenderer(this); 
            await galleryRenderer.renderGalleryBlock(source, el, ctx);
        });
		
        // Main Drawing Icon (Always visible)
        this.addRibbonIcon('hexagon', 'Draw New Molecule', () => {
            this.openNewDrawingModal();
        });

        // Toggleable Media Icons
        this.refreshRibbonIcons();

        // --- COMMANDS ---
        this.addCommand({
            id: 'insert-new-molecule',
            name: 'Draw new SMILES molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    if (isFile) {
                        const cursor = editor.getCursor();
                        editor.replaceRange(`!${newData}\n`, cursor);
                        editor.setCursor({ line: cursor.line + 1, ch: 0 });
                    } else {
                        this.insertSmilesAtCursor(editor, newData, newFormat || "smiles");
                    }
                }).open();
            }
        });

        this.addCommand({
            id: 'insert-inline-molecule',
            name: 'Draw new inline molecule',
            editorCallback: (editor: Editor) => {
                new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
                    const cursor = editor.getCursor();
                    if (isFile) {
                        editor.replaceRange(`!${newData} `, cursor);
                        editor.setCursor({ line: cursor.line, ch: cursor.ch + newData.length + 2 });
                    } else {
                        if (newFormat === "ket") {
                            new Notice("Cannot save inline reaction. Inserting as code block instead.");
                            this.insertSmilesAtCursor(editor, newData, "ket");
                            return;
                        }
                        const textToInsert = `${this.settings.inlineSmilesPrefix}${newData} `;
                        editor.replaceRange(textToInsert, cursor);
                        editor.setCursor({ line: cursor.line, ch: cursor.ch + textToInsert.length });
                    }
                }).open();
            }
        });

        // --- POST PROCESSORS ---
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

            const embeds = Array.from(el.querySelectorAll('.internal-embed'));
            if (el.classList?.contains('internal-embed')) embeds.push(el);

            const activeExts = this.getSupportedExts();

            for (const embed of embeds) {
                const src = embed.getAttribute('src');
                if (!src) continue;
                
                const lowerSrc = src.toLowerCase();
                const hasExt = activeExts.some(ext => lowerSrc.endsWith(`.${ext}`));
                
                if (hasExt) {
                    if (embed.hasAttribute('data-chem-preview-done')) continue;
                    embed.setAttribute('data-chem-preview-done', 'true');
                    this.injectNativeEmbed(embed as HTMLElement, src, ctx.sourcePath);
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
                            if (isFile) {
                                editor.replaceRange(`!${newData}`, {line: cursor.line, ch: startIndex}, {line: cursor.line, ch: endIndex});
                                return;
                            }
                            if (newFormat === "ket") {
                                new Notice("Inline reactions not supported. Replaced with codeblock.");
                                editor.replaceRange(`\n\`\`\`ket\n${newData}\n\`\`\`\n`, {line: cursor.line, ch: startIndex}, {line: cursor.line, ch: endIndex});
                                return;
                            }
                            editor.replaceRange(newData, {line: cursor.line, ch: startIndex + prefix.length}, {line: cursor.line, ch: endIndex});
                        }).open();
                        return;
                    }
                }
                new Notice("Place your cursor inside an inline $smiles= string first!");
            }
        });

        // --- MODULAR ELN BLOCK PROCESSOR ---
        this.registerMarkdownCodeBlockProcessor("eln", async (source, el, ctx) => {
            const elnRenderer = new SharedElnRenderer(this); 
            const wrapper = await elnRenderer.renderElnBlock(source, el, ctx);
            
            // @ts-ignore
            const Smi = SmiDrawer;
            const theme = document.body.hasClass("theme-dark") ? this.settings.darkTheme : this.settings.lightTheme;
        
            wrapper.querySelectorAll('.eln-structure').forEach((node: HTMLElement) => {
                const smiles = node.getAttribute('data-smiles');
                const cssSize = node.classList.contains('scheme-size') ? 110 : 90;
                
                if (smiles) {
                    requestAnimationFrame(() => {
                        try {
                            if (this.settings.useSvgSmiles) {
                                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                                svg.style.width = `${cssSize}px`; svg.style.height = `${cssSize}px`;
                                node.appendChild(svg);
                                Smi.parse(smiles, (tree: any) => new Smi.SvgDrawer({ width: cssSize, height: cssSize, compactDrawing: false }).draw(tree, svg, theme));
                            } else {
                                const canvas = document.createElement("canvas");
                                canvas.style.width = `${cssSize}px`; canvas.style.height = `${cssSize}px`;
                                node.appendChild(canvas);
                                Smi.parse(smiles, (tree: any) => new Smi.Drawer({ width: cssSize * 2, height: cssSize * 2, compactDrawing: false }).draw(tree, canvas, theme));
                            }
                        } catch(e) {
                            node.innerHTML = `<span style="color:var(--text-error);">Invalid</span>`;
                        }
                    });
                }
                
                node.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const type = node.getAttribute('data-type');
                    const index = parseInt(node.getAttribute('data-index') || '0', 10);
                    
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    const info = ctx.getSectionInfo(el);
                    
                    new KetcherModal(this, smiles || "", "smiles", (newData, isFile, newFormat) => {
                        if (newFormat === "ket") { new Notice("ELN tables only support SMILES. Arrow discarded."); return; }
                        if (info && view) {
                            const { parseYaml, stringifyYaml } = require('obsidian');
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                const yamlObj = parseYaml(blockText);
                                yamlObj[type!][index].smiles = newData;
                                delete yamlObj[type!][index].mw; delete yamlObj[type!][index].formula;
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { new Notice("Error updating ELN YAML."); }
                        }
                    }).open();
                });
            });
            el.appendChild(wrapper);
        });

        // --- MODULAR GALLERY PROCESSOR ---
        this.registerMarkdownCodeBlockProcessor("chem-gallery", async (source, el, ctx) => {
            const galleryRenderer = new SharedGalleryRenderer(this);
            await galleryRenderer.renderGalleryBlock(source, el, ctx);
        });

        // --- FILE EMBED PROCESSOR ---
        const fileCodeblockProcessor = async (source: string, el: HTMLElement, ctx: any, defaultFormat: string) => {
            const wrapper = this.createBaseWrapper(`Loading preview...`);
            el.appendChild(wrapper);

            const rawData = source.trim();
            const bracketMatch = rawData.match(/\[\[(.*?)\]\]/);
            let filenameToSearch = "";
            
            if (bracketMatch && bracketMatch[1]) {
                filenameToSearch = bracketMatch[1];
            } else {
                const exts = this.getSupportedExts();
                const hasExt = exts.some(ext => rawData.toLowerCase().endsWith(`.${ext}`));
                if (hasExt) filenameToSearch = rawData;
            }

            if (filenameToSearch) {
                const cleanLink = decodeURIComponent(filenameToSearch).split('#')[0].split('?')[0].trim();
                const file = this.app.metadataCache.getFirstLinkpathDest(cleanLink, ctx.sourcePath);
                
                if (file && file instanceof TFile) {
                    const format = file.extension.toLowerCase();
                    wrapper.title = `Double-click to edit ${file.name}`;
                    
                    const data = await this.app.vault.read(file);
                    const previewEl = await this.renderMoleculeToPreview(data, format, false);

                    wrapper.empty(); // Clears "Loading preview..."
                    if (previewEl) wrapper.appendChild(previewEl);
                    else wrapper.appendChild(this.createErrorCard(`Invalid format in ${file.name}`));

                    wrapper.addEventListener("dblclick", async (e) => {
                        e.stopPropagation();
                        const freshData = await this.app.vault.read(file);
                        new KetcherModal(this, freshData, format, async (newData, isFile, newFormat) => {
                            if (isFile) {
                                new Notice(`Saved as new file: ${newData}. Please manually update the link in your document.`);
                                return;
                            }
                            if (newFormat && newFormat !== format) {
                                new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`);
                            }
                            await this.app.vault.modify(file, newData);
                            wrapper.innerHTML = `<span class="color-text-muted">Updating...</span>`;
                            const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false);
                            if (updatedEl) {
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
                wrapper.empty(); // Clears "Loading preview..."
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
                        if (isFile) {
                            editor.replaceRange(`!${newData}\n`, 
                                { line: info.lineStart, ch: 0 }, 
                                { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                        } else {
                            const finalFormat = newFormat || defaultFormat;
                            editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, 
                                { line: info.lineStart, ch: 0 }, 
                                { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                        }
                    }
                }).open();
            });
        };

        this.getSupportedExts().forEach(fmt => {
            this.registerMarkdownCodeBlockProcessor(fmt, (s, e, c) => fileCodeblockProcessor(s, e, c, fmt));
        });

        // --- SMILES CODEBLOCK PROCESSOR ---
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
                        if (isFile) {
                            editor.replaceRange(`!${newData}\n`, 
                                { line: info.lineStart, ch: 0 }, 
                                { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                        } else {
                            const finalFormat = newFormat || "smiles";
                            editor.replaceRange(`\`\`\`${finalFormat}\n${newData}\n\`\`\``, 
                                { line: info.lineStart, ch: 0 }, 
                                { line: info.lineEnd, ch: editor.getLine(info.lineEnd).length });
                        }
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
                    const editor = view.editor;
                    const content = editor.getValue();
                    if (isFile) {
                        const updatedContent = content.replace(prefix + rawData, `!${newData}`);
                        editor.setValue(updatedContent);
                        return;
                    }
                    if (newFormat === "ket") {
                        new Notice("Inline reactions not supported. Inserted as block.");
                        const updatedContent = content.replace(prefix + rawData, `\n\`\`\`ket\n${newData}\n\`\`\`\n`);
                        editor.setValue(updatedContent);
                        return;
                    }
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
                    if (previewEl) {
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
                        if (isFile) {
                            new Notice(`Saved as new file: ${newData}. Please manually update the link in your document.`);
                            return;
                        }
                        if (newFormat && newFormat !== format) {
                            new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`);
                        }
                        await this.app.vault.modify(file, newData);
                        wrapper.innerHTML = `⏳`;
                        const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, true);
                        if (updatedEl) {
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
        new KetcherModal(this, "", "smiles", (newData, isFile, newFormat) => {
            if (isFile) {
                const cursor = view.editor.getCursor();
                view.editor.replaceRange(`!${newData}\n`, cursor);
                view.editor.setCursor({ line: cursor.line + 1, ch: 0 });
            } else {
                this.insertSmilesAtCursor(view.editor, newData, newFormat || "smiles");
            }
        }).open();
    }
	
    // Helper function so SharedEln can open the editor
    openKetcherModal(initialData: string, format: string, onSave: (data: string) => void) {
        new KetcherModal(this, initialData, format, (newData, isFile, newFormat) => {
            onSave(newData);
        }).open();
    }
    
	openKetcherForFile(file: TFile, data: string, format: string, previewWrapper: HTMLElement) {
        new KetcherModal(this, data, format, async (newData, isFile, newFormat) => {
            await this.app.vault.modify(file, newData);
            new Notice(`Saved ${file.name}`);
            
            // Force preview image to refresh on the card!
            previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳</span>`;
            const originalW = this.settings.width; const originalH = this.settings.height;
            this.settings.width = 120; this.settings.height = 100;
            
            const updatedPreview = await this.renderMoleculeToPreview(newData, newFormat || format, false);
            
            this.settings.width = originalW; this.settings.height = originalH;
            
            if (updatedPreview) {
                previewWrapper.empty();
                updatedPreview.style.maxWidth = '100%'; updatedPreview.style.maxHeight = '100%';
                previewWrapper.appendChild(updatedPreview);
            }
        }).open();
    }

    insertSmilesAtCursor(editor: Editor, data: string, format: string) {
        const cursor = editor.getCursor();
        const textToInsert = `\`\`\`${format}\n${data}\n\`\`\`\n`;
        editor.replaceRange(textToInsert, cursor);
        editor.setCursor({ line: cursor.line + 3, ch: 0 });
    }

    async injectNativeEmbed(embed: HTMLElement, src: string, sourcePath: string) {
        const file = this.app.metadataCache.getFirstLinkpathDest(src, sourcePath);
        if (!(file instanceof TFile)) {
            embed.innerHTML = `<div class="chem-native-embed-wrapper color-red">File not found: ${src}</div>`;
            return;
        }

        embed.classList.add('chem-custom-embed');

        const wrapper = document.createElement("div"); 
        wrapper.className = "chem-native-embed-wrapper";
        wrapper.style.cursor = "pointer";
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.margin = "10px 0";
        wrapper.title = `Double-click to edit ${file.name}`;
        
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "color-text-muted";
        loadingDiv.style.padding = "15px";
        loadingDiv.style.border = "1px solid var(--background-modifier-border)";
        loadingDiv.style.borderRadius = "8px";
        loadingDiv.innerHTML = `⏳ Loading ${file.extension.toUpperCase()}...`;
        wrapper.appendChild(loadingDiv);
        
        embed.innerHTML = '';
        embed.appendChild(wrapper);

        const observer = new MutationObserver(() => {
            if (!embed.contains(wrapper)) {
                embed.innerHTML = '';
                embed.appendChild(wrapper);
            }
        });
        observer.observe(embed, { childList: true });

        const format = file.extension.toLowerCase();
        const fileData = await this.app.vault.read(file);

        requestAnimationFrame(async () => {
            const previewEl = await this.renderMoleculeToPreview(fileData, format, false); 
            if (previewEl) {
                wrapper.empty();
                previewEl.style.border = "1px solid var(--background-modifier-border)";
                previewEl.style.borderRadius = "8px";
                previewEl.style.padding = "10px";
                previewEl.style.backgroundColor = "var(--background-primary)";
                wrapper.appendChild(previewEl);
            } else {
                wrapper.empty();
                wrapper.appendChild(this.createErrorCard(`Failed to render ${file.name}`));
            }
        });

        wrapper.addEventListener("dblclick", async (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            const freshData = await this.app.vault.read(file);
            
            new KetcherModal(this, freshData, format, async (newData, isFile, newFormat) => {
                if (isFile) {
                    new Notice(`Saved as new file: ${newData}. Please manually update the link in your document.`);
                    return;
                }
                if (newFormat && newFormat !== format) {
                    new Notice(`Format upgraded to ${newFormat}. Remember to rename your inline file.`);
                }
                await this.app.vault.modify(file, newData);
                
                wrapper.innerHTML = `<div class="color-text-muted" style="padding:15px; border:1px solid var(--background-modifier-border); border-radius:8px;">⏳ Updating...</div>`;
                const updatedEl = await this.renderMoleculeToPreview(newData, newFormat || format, false);
                
                if (updatedEl) { 
                    wrapper.empty();
                    updatedEl.style.border = "1px solid var(--background-modifier-border)";
                    updatedEl.style.borderRadius = "8px";
                    updatedEl.style.padding = "10px";
                    updatedEl.style.backgroundColor = "var(--background-primary)";
                    wrapper.appendChild(updatedEl);
                }
            }).open();
        });
    }

    buildLivePreviewPlugin() {
        const plugin = this;

        // Custom Widget for Inline Rendering in Live Preview
        class ChemInlineWidget extends WidgetType {
            constructor(public data: string, public type: 'smiles'|'file', public plugin: ChemEditPlugin) { super(); }
            
            eq(other: ChemInlineWidget) { return this.data === other.data && this.type === other.type; }
            
            toDOM() {
                const wrapper = document.createElement("span");
                wrapper.className = "chem-inline-widget";
                wrapper.style.display = "inline-block";
                wrapper.style.verticalAlign = "middle";
                wrapper.style.cursor = "pointer";
                wrapper.style.margin = "0 4px";
                wrapper.innerHTML = `⏳`;

                requestAnimationFrame(async () => {
                    if (this.type === 'smiles') {
                        const el = await plugin.renderMoleculeToPreview(this.data, 'smiles', true);
                        wrapper.empty();
                        if (el) wrapper.appendChild(el); else wrapper.innerHTML = '❌';
                    } else {
                        const cleanName = this.data.replace('[[', '').replace(']]', '');
                        const file = plugin.app.metadataCache.getFirstLinkpathDest(cleanName, "");
                        if (file && file instanceof TFile) {
                            const format = file.extension.toLowerCase();
                            const fileData = await plugin.app.vault.read(file);
                            const el = await plugin.renderMoleculeToPreview(fileData, format, true);
                            wrapper.empty();
                            if (el) wrapper.appendChild(el); else wrapper.innerHTML = '❌';
                        } else {
                            wrapper.innerHTML = '❌';
                        }
                    }
                });

                return wrapper;
            }
        }

        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = this.buildDecorations(view);
                this.processEmbeds(view);
            }
            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    this.decorations = this.buildDecorations(update.view);
                    setTimeout(() => this.processEmbeds(update.view), 50);
                }
            }
            buildDecorations(view: EditorView) {
                const builder = new RangeSetBuilder<Decoration>();
                const prefixSmiles = plugin.settings.inlineSmilesPrefix;
                const prefixMol = plugin.settings.inlineMolPrefix;
                
                if (!prefixSmiles && !prefixMol) return builder.finish();

                for (let {from, to} of view.visibleRanges) {
                    const text = view.state.doc.sliceString(from, to);
                    let match;
                    
                    const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                    
                    const regexSrc = [];
                    if (prefixSmiles) regexSrc.push(`(?:${escapeRegex(prefixSmiles)}[^\\s]+)`);
                    if (prefixMol)    regexSrc.push(`(?:${escapeRegex(prefixMol)}[^\\s]+)`);
                    const regex = new RegExp(regexSrc.join('|'), 'g');
                    
                    while ((match = regex.exec(text)) !== null) {
                        const start = from + match.index;
                        const end = start + match[0].length;
                        
                        // Prevent decorating if cursor is touching/inside the match so user can edit text natively
                        const hasCursorInside = view.state.selection.ranges.some(r => r.from >= start && r.to <= end);
                        if (hasCursorInside) continue;

                        const isSmiles = prefixSmiles && match[0].startsWith(prefixSmiles);
                        const prefixLen = isSmiles ? prefixSmiles.length : prefixMol.length;
                        const data = match[0].substring(prefixLen);
                        
                        builder.add(start, end, Decoration.replace({
                            widget: new ChemInlineWidget(data, isSmiles ? 'smiles' : 'file', plugin)
                        }));
                    }
                }
                return builder.finish();
            }
            processEmbeds(view: EditorView) {
                const embeds = view.dom.querySelectorAll('.internal-embed');
                const activeExts = plugin.getSupportedExts();

                embeds.forEach(embed => {
                    const src = embed.getAttribute('src');
                    if (!src) return;
                    
                    const lowerSrc = src.toLowerCase();
                    const hasExt = activeExts.some(ext => lowerSrc.endsWith(`.${ext}`));
                    
                    if (hasExt) {
                        if (embed.hasAttribute('data-chem-preview-done')) return;
                        embed.setAttribute('data-chem-preview-done', 'true');
                        plugin.injectNativeEmbed(embed as HTMLElement, src, "");
                    }
                });
            }
        }, {
            decorations: v => v.decorations
        });
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
            let img;
            try {
                img = await this.headlessKetcher.generateImage(task.data, { outputFormat: 'svg' });
            } catch (err) {
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
                if (isFile) {
                    new Notice(`Saved as new file: ${newData}`);
                    return;
                }
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
        const saveFileBtn = btnContainer.createEl("button", { text: "Save as File..." });
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
                    } else if (finalFormat === "rxn") {
                        if (typeof this.ketcherInstance.getRxn === "function") {
                            resultData = await this.ketcherInstance.getRxn();
                        } else if (typeof this.ketcherInstance.getRxnfile === "function") {
                            resultData = await this.ketcherInstance.getRxnfile();
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
                            this.isSavingAsFile = this.isSavingAsFile.replace(/\.[a-z]+$/i, '.ket');
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
            new SaveFileModal(this.plugin.app, (filename, selectedFormat) => {
                let safeName = filename.trim();
                safeName = safeName.replace(/\.(mol|cdxml|ket|sdf|rxn)$/i, '');
                
                safeName += '.' + selectedFormat;
                this.isSavingAsFile = safeName;
                doSave(selectedFormat);
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

class SaveFileModal extends Modal {
    onSubmit: (filename: string, format: string) => void;
    filename: string = "";
    format: string = "mol";

    constructor(app: App, onSubmit: (filename: string, format: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Save as File..." });

        new Setting(contentEl)
            .setName("Filename")
            .setDesc("Enter a name for the new chemical file.")
            .addText(text => text
                .setPlaceholder("molecule")
                .onChange(value => { this.filename = value; })
                .inputEl.addEventListener("keypress", (e) => {
                    if (e.key === "Enter" && this.filename) {
                        this.submit();
                    }
                }));

        new Setting(contentEl)
            .setName("Format")
            .setDesc("Select the file format to save as.")
            .addDropdown(drop => drop
                .addOption("mol", ".mol (MDL Molfile)")
                .addOption("cdxml", ".cdxml (ChemDraw)")
                .addOption("ket", ".ket (Ketcher Native)")
                .addOption("rxn", ".rxn (MDL Rxnfile)")
                .addOption("sdf", ".sdf (Structure Data)")
                .setValue("mol")
                .onChange(value => { this.format = value; })
            );

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("Save File")
                .setCta()
                .onClick(() => this.submit())
            );
            
        setTimeout(() => {
            const input = contentEl.querySelector('input[type="text"]') as HTMLInputElement;
            if (input) input.focus();
        }, 50);
    }

    submit() {
        if (this.filename.trim()) {
            this.onSubmit(this.filename, this.format);
            this.close();
        } else {
            new Notice("Please enter a filename.");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
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

        containerEl.createEl('h3', { text: 'Fume Hood Utilities' });

        new Setting(containerEl)
            .setName('Show Media Ribbon Icons')
            .setDesc('Turn this on to display the "Take Photo" and "TLC Plate" icons in your left sidebar ribbon.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showMediaRibbonIcons)
                .onChange(async (value) => {
                    this.plugin.settings.showMediaRibbonIcons = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshRibbonIcons();
                }));

        new Setting(containerEl)
            .setName('Media Images Save Path')
            .setDesc('Folder where camera/TLC pictures will be stored (e.g. Assets/)')
            .addText(text => text
                .setPlaceholder('Assets/')
                .setValue(this.plugin.settings.mediaSavePath)
                .onChange(async (v) => {
                    this.plugin.settings.mediaSavePath = v;
                    await this.plugin.saveSettings();
                }));
		
		new Setting(containerEl)
            .setName('Show Blank ELN Icon')
            .setDesc('Display the Flask icon in the sidebar to generate blank experiments.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showElnRibbonIcon)
                .onChange(async (value) => {
                    this.plugin.settings.showElnRibbonIcon = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshRibbonIcons();
                }));

        new Setting(containerEl)
            .setName('Default ELN Directory')
            .setDesc('Folder where new ELN experiments will be saved by default (e.g. Experiments/). Leave blank to save in the current active folder.')
            .addText(text => text
                .setPlaceholder('Experiments/')
                .setValue(this.plugin.settings.elnDirectory)
                .onChange(async (v) => { this.plugin.settings.elnDirectory = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Default Experiment Prefix')
            .setDesc('Prefix for new ELN files (e.g., EXP, JH, CHEM).')
            .addText(text => text
                .setPlaceholder('EXP')
                .setValue(this.plugin.settings.elnPrefix)
                .onChange(async (v) => { this.plugin.settings.elnPrefix = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Analytical Sections')
            .setDesc('Comma-separated list of sections to auto-generate inside new experiments.')
            .addText(text => text
                .setPlaceholder('TLC, LCMS, NMR')
                .setValue(this.plugin.settings.elnSections)
                .onChange(async (v) => { this.plugin.settings.elnSections = v; await this.plugin.saveSettings(); }));


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
            .setName('Supported File Extensions')
            .setDesc('Comma-separated list of extensions that should render chemical views automatically via ![[file.ext]] embeds.')
            .addText(text => text
                .setPlaceholder('mol, cdxml, ket, sdf, rxn, inchi, smarts')
                .setValue(this.plugin.settings.supportedEmbedExtensions)
                .onChange(async (v) => {
                    this.plugin.settings.supportedEmbedExtensions = v;
                    await this.plugin.saveSettings();
                }));

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
            .setName('Render SMILES as SVG')
            .setDesc('Uses SVG instead of High-DPI Canvas for SMILES blocks. Looks crisper at extreme zoom levels.')
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
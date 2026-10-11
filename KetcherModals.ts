// KetcherModals.ts
import { App, Modal, Notice, Setting } from 'obsidian';
import React from 'react';
import ReactDOM from 'react-dom';
import KetcherReact from './KetcherReact';
import type ChemEditPlugin from './main';
import { embedDataInSvg, extractDataFromSvg } from './ChemUtils';

let createRoot: any = null;
try { 
    const ReactDomClient = require('react-dom/client'); 
    if (ReactDomClient && ReactDomClient.createRoot) createRoot = ReactDomClient.createRoot; 
} catch (e) { createRoot = null; }

export class KetcherModal extends Modal {
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
        
        if (this.format === 'svg') { 
            const ex = extractDataFromSvg(this.initialData); 
            if (ex) this.initialData = ex.data; 
        }
        
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
            onInit: async (ketcher: any) => { 
                this.ketcherInstance = ketcher; 
                if (this.plugin.settings.useAcsSettings) { 
                    try { await ketcher.setSettings({ bondThickness: 1.2, bondLength: 20, stereoBondWidth: 3, fontsz: 10, fontszsub: 7, hashSpacing: 1.5 }); } catch (e) {} 
                } 
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
                const isPolyglotSvg = finalFormat === 'svg' || finalFormat === 'ketcher.svg';
                
                try {
                    if (isPolyglotSvg) {
                        const ket = await this.ketcherInstance.getKet(); 
                        let svgText = "";
                        const img = await this.ketcherInstance.generateImage(ket, { outputFormat: 'svg' });
                        if (typeof img === 'string') { 
                            if (img.startsWith('data:image/svg+xml;base64,')) svgText = atob(img.split(',')[1]); 
                            else if (img.startsWith('data:image/svg+xml;utf8,')) svgText = decodeURIComponent(img.split(',')[1]); 
                            else svgText = img; 
                        } else if (img instanceof Blob) { 
                            svgText = await img.text(); 
                        }
                        resultData = embedDataInSvg(svgText, ket, 'ket'); 
                        finalFormat = 'svg'; 
                    } else {
                        const k = this.ketcherInstance;
                        const tryExport = async (primary: () => Promise<string>, fallback: () => Promise<string>) => {
                            try { return await primary(); } catch (e) { return await fallback(); }
                        };

                        switch(finalFormat) {
                            case 'smiles': resultData = await k.getSmiles(); break;
                            case 'ket': resultData = await k.getKet(); break;
                            case 'inchi': resultData = await k.getInchi(); break;
                            case 'smarts': resultData = await k.getSmarts(); break;
                            case 'fasta': resultData = await tryExport(() => k.getFasta(), () => k.getMolfile()); break;
                            case 'sequence': resultData = await tryExport(() => k.getSequence(), () => k.getMolfile()); break;
                            case 'idt': resultData = await tryExport(() => k.getIdt(), () => k.getMolfile()); break;
                            case 'helm': resultData = await tryExport(() => k.getHelm(), () => k.getMolfile()); break;
                            case 'biln': resultData = await tryExport(() => (typeof k.getBiln === 'function' ? k.getBiln() : k.getMolfile()), () => k.getMolfile()); break;
                            case 'cdxml': resultData = await tryExport(() => (typeof k.getCDXml === 'function' ? k.getCDXml() : k.getCdxml()), () => k.getMolfile()); break;
                            case 'rxn': resultData = await tryExport(() => (typeof k.getRxn === 'function' ? k.getRxn() : k.getRxnfile()), () => k.getMolfile()); break;
                            case 'mol':
                            case 'sdf':
                            default: resultData = await k.getMolfile(); break;
                        }
                    }
                } catch (err: any) {
                    if (err.message && err.message.toLowerCase().includes('reaction')) {
                        resultData = await this.ketcherInstance.getKet(); 
                        finalFormat = "ket"; 
                        new Notice("Reactions cannot be saved in this format. Automatically upgraded to .KET format.");
                        if (this.isSavingAsFile) this.isSavingAsFile = this.isSavingAsFile.replace(/\.[a-zA-Z0-9]+$/i, '.ket'); 
                    } else { 
                        resultData = await this.ketcherInstance.getKet();
                        finalFormat = "ket";
                        new Notice(`Export to requested format failed. Saved as .ket instead to prevent data loss.`);
                        if (this.isSavingAsFile) this.isSavingAsFile = this.isSavingAsFile.replace(/\.[a-zA-Z0-9]+$/i, '.ket'); 
                    }
                }

                if (!resultData) {
                    new Notice("Failed to generate structure data. Format may not be supported.");
                    return;
                }

                if (this.isSavingAsFile) { 
                    let fileName = this.isSavingAsFile; 
                    let counter = 1;
                    let finalFileName = fileName;
                    const pathParts = fileName.split('/');
                    const baseFile = pathParts.pop() || fileName;
                    const dir = pathParts.length > 0 ? pathParts.join('/') + '/' : '';
                    
                    while (this.plugin.app.vault.getAbstractFileByPath(finalFileName)) {
                        finalFileName = dir + baseFile.replace(/\.([a-zA-Z0-9]+)$/, `-${counter}.$1`);
                        counter++;
                    }

                    await this.plugin.app.vault.create(finalFileName, resultData); 
                    this.onSave(`[[${finalFileName}]]`, true, finalFormat); 
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
                let safeName = filename.trim().replace(/\.(mol|cdxml|ket|sdf|rxn|svg|fasta|sequence|idt|helm|biln)$/i, '');
                const ext = selectedFormat === 'ketcher.svg' ? 'svg' : selectedFormat; 
                safeName += '.' + ext;
                this.isSavingAsFile = safeName; doSave(selectedFormat);
            }).open();
        };
        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        try { const editor = this.ketcherInstance?.editor; if (editor) { if (editor.events) { editor.events = { on: () => {}, off: () => {}, emit: () => {} }; } if (editor.shortcuts && typeof editor.shortcuts.disable === 'function') { editor.shortcuts.disable(); } } } catch (e) { }
        const container = this.contentEl.querySelector("div");
        if (container) { if (this.reactRoot) { this.reactRoot.unmount(); this.reactRoot = null; } else { ReactDOM.unmountComponentAtNode(container); } }
        this.contentEl.empty(); this.plugin.bootHeadlessKetcher();
    }
}

export class SaveFileModal extends Modal {
    onSubmit: (filename: string, format: string) => void; 
    filename: string = ""; 
    format: string = "mol";
    
    constructor(app: App, onSubmit: (filename: string, format: string) => void) { 
        super(app); this.onSubmit = onSubmit; 
    }
    
    onOpen() {
        const { contentEl } = this; 
        contentEl.createEl("h3", { text: "Save as File..." });
        new Setting(contentEl).setName("Filename").setDesc("Enter a name for the new chemical file.").addText(text => text.setPlaceholder("molecule").onChange(value => { this.filename = value; }).inputEl.addEventListener("keypress", (e) => { if (e.key === "Enter" && this.filename) { this.submit(); } }));
        new Setting(contentEl).setName("Format").setDesc("Select the file format to save as.").addDropdown(drop => drop.addOption("mol", ".mol (MDL Molfile)").addOption("cdxml", ".cdxml (ChemDraw)").addOption("ket", ".ket (Ketcher Native)").addOption("rxn", ".rxn (MDL Rxnfile)").addOption("sdf", ".sdf (Structure Data)").addOption("fasta", ".fasta (FASTA Sequence)").addOption("sequence", ".sequence (Raw Sequence)").addOption("idt", ".idt (IDT Sequence)").addOption("helm", ".helm (HELM Macromolecule)").addOption("biln", ".biln (BILN Macromolecule)").addOption("ketcher.svg", ".svg (Ketcher SVG)").setValue("mol").onChange(value => { this.format = value; }));
        new Setting(contentEl).addButton(btn => btn.setButtonText("Save File").setCta().onClick(() => this.submit()));
        setTimeout(() => { const input = contentEl.querySelector('input[type="text"]') as HTMLInputElement; if (input) input.focus(); }, 50);
    }
    submit() { if (this.filename.trim()) { this.onSubmit(this.filename, this.format); this.close(); } else { new Notice("Please enter a filename."); } }
    onClose() { this.contentEl.empty(); }
}
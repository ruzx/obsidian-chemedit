// ChemFileView.ts
import { TextFileView, WorkspaceLeaf, Notice } from 'obsidian';
import type ChemEditPlugin from './main';
import { KetcherModal } from './KetcherModals';

export const CHEM_FILE_VIEW_TYPE = "chem-file-view";

export class ChemFileView extends TextFileView {
    plugin: ChemEditPlugin; 
    
    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) { 
        super(leaf); 
        this.plugin = plugin; 
    }
    
    getViewType() { return CHEM_FILE_VIEW_TYPE; } 
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
                if (isFile) { new Notice(`Saved as new file: ${newData}`); return; }
                if (newFormat && newFormat !== format) { new Notice(`Format was upgraded to ${newFormat}. Please rename the file extension!`); }
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
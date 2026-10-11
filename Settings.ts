// Settings.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ChemEditPlugin from './main';

export interface ChemEditSettings {
    // Feature Flags (Modules)
    enableEln: boolean;
    enableNavigator: boolean;
    enablePathways: boolean;
    enableContextMenu: boolean;
    enableScripting: boolean;

    // Dashboard Flags
    enableElnDashboard: boolean;
    enableInventoryDashboard: boolean;
    enableOrdersDashboard: boolean;
    enableEquipmentDashboard: boolean;
    enableProtocolsDashboard: boolean;
    enableLibraryDashboard: boolean;
    enableGalleryDashboard: boolean;
    enableCharacterizationDashboard: boolean;

    // General & Rendering
    width: number; height: number; inlineWidth: number; inlineHeight: number;
    useSvgSmiles: boolean; useAcsSettings: boolean;
    lightTheme: string; darkTheme: string;
    
    // Embeds & Smart Paste
    inlineSmilesPrefix: string; inlineMolPrefix: string;
    smartPasteSmiles: boolean; smartPasteMol: boolean;
    supportedEmbedExtensions: string; mediaSavePath: string;
    
    // UI & Icons
    showMediaRibbonIcons: boolean; 
    showElnRibbonIcon: boolean;
    showDashboardRibbonIcon: boolean;
    showNavigatorRibbonIcon: boolean; 
    
    // ELN
    elnDirectory: string; elnPrefix: string; elnSections: string;
    libraryFilePath: string; 
    
    // Context Menu Web Links
    contextUrl1Name: string; contextUrl1: string; contextUrl2Name: string; contextUrl2: string;
    contextUrl3Name: string; contextUrl3: string; contextUrl4Name: string; contextUrl4: string;

    // Navigator Settings
    navigatorDefaultTab: string;
    pathwayColors: string;

    // Scripting Engine
    scriptsFolder: string;
}

export const DEFAULT_SETTINGS: ChemEditSettings = {
    enableEln: true, enableNavigator: true, enablePathways: true, enableContextMenu: true, 
    enableScripting: false, // Defaulted to FALSE to save memory
    
    enableElnDashboard: true, enableInventoryDashboard: true, enableOrdersDashboard: true, enableEquipmentDashboard: true,
    enableProtocolsDashboard: true, enableLibraryDashboard: true, enableGalleryDashboard: true, enableCharacterizationDashboard: true,

    width: 300, height: 300, inlineWidth: 150, inlineHeight: 150, 
    lightTheme: 'light', darkTheme: 'dark',
    inlineSmilesPrefix: '$smiles=', inlineMolPrefix: '$mol=', 
    smartPasteSmiles: false, smartPasteMol: false,
    useSvgSmiles: true, useAcsSettings: false, mediaSavePath: "Assets/", 
    
    showMediaRibbonIcons: false, showElnRibbonIcon: true, showDashboardRibbonIcon: true, showNavigatorRibbonIcon: false, 
    
    elnDirectory: "ELN", elnPrefix: "EXP", elnSections: "TLC, LCMS, NMR",
    supportedEmbedExtensions: "mol, cdxml, ket, sdf, rxn, inchi, smarts, svg, fasta, sequence, idt, helm, biln",
    libraryFilePath: "ChemEdit/compounds.md",
    
    // Context Menu Custom Links Default
    contextUrl1Name: "Search PubChem", contextUrl1: "https://pubchem.ncbi.nlm.nih.gov/#query={{smiles}}",
    contextUrl2Name: "Search MolPort", contextUrl2: "https://www.molport.com/shop/search-results?smiles={{smiles}}",
    contextUrl3Name: "Predict NMR (NMRium)", contextUrl3: "https://app.nmrium.com/predict?smiles={{smiles}}",
    contextUrl4Name: "Search ChemSpider", contextUrl4: "https://www.chemspider.com/Search.aspx?q={{smiles}}",
    
    navigatorDefaultTab: "context",
    pathwayColors: "#4e79a7, #f28e2c, #e15759, #76b7b2, #59a14f, #edc949, #af7aa1, #ff9da7, #9c755f, #bab0ab",
    scriptsFolder: "ChemEdit/Scripts"
};

export class ChemEditSettingTab extends PluginSettingTab {
    plugin: ChemEditPlugin; 
    
    constructor(app: App, plugin: ChemEditPlugin) { 
        super(app, plugin); 
        this.plugin = plugin; 
    }

    // Helper to create beautiful collapsible sections
    private createAccordion(container: HTMLElement, title: string, icon: string, open: boolean = false) {
        const details = container.createEl('details', { attr: { style: 'margin-bottom: 15px; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-primary-alt);' } });
        if (open) details.setAttribute('open', '');
        
        const summary = details.createEl('summary', { attr: { style: 'font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 12px; outline: none; user-select: none;' } });
        summary.innerHTML = `<span style="font-size: 18px;">${icon}</span> <span>${title}</span>`;
        
        const contentDiv = details.createDiv({ attr: { style: 'padding: 0 15px 15px 15px; border-top: 1px solid var(--background-modifier-border);' } });
        return contentDiv;
    }
    
    display(): void {
        const {containerEl} = this; 
        containerEl.empty(); 
        
        containerEl.createEl('h2', {text: '🧪 ChemEdit Settings'});
        
        const howtoEl = containerEl.createDiv({ attr: { style: "margin-bottom: 25px; padding: 15px; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--interactive-accent);" } });
        howtoEl.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 8px; color: var(--interactive-accent);">Quick How-To:</div>
            <ul style="margin: 0; padding-left: 20px; color: var(--text-normal); font-size: 13px;">
                <li><b>Draw:</b> Click the Hexagon icon in the left ribbon to draw a new structure.</li>
                <li><b>Embeds:</b> Type <code>![[molecule.mol]]</code> or <code>![[reaction.rxn]]</code> directly in any note.</li>
                <li><b>Dashboards:</b> Use the Command Palette (<code>Ctrl+P</code>) to open the LIMS Dashboards!</li>
                <li><b>Edit:</b> Double-click any rendered molecule to open Ketcher!</li>
            </ul>
        `;

        // ==========================================================
        // 1. GENERAL & ELN SETTINGS
        // ==========================================================
        const genSec = this.createAccordion(containerEl, "General & File Paths", "📂", true);
        
        new Setting(genSec).setName('Default ELN Directory').setDesc('Folder where new ELN experiments will be saved.').addText(text => text.setPlaceholder('Experiments/').setValue(this.plugin.settings.elnDirectory).onChange(async (v) => { this.plugin.settings.elnDirectory = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Default Experiment Prefix').setDesc('Prefix for new ELN files (e.g., EXP, JH, CHEM).').addText(text => text.setPlaceholder('EXP').setValue(this.plugin.settings.elnPrefix).onChange(async (v) => { this.plugin.settings.elnPrefix = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Analytical Sections').setDesc('Comma-separated list of sections to auto-generate inside new experiments.').addText(text => text.setPlaceholder('TLC, LCMS, NMR').setValue(this.plugin.settings.elnSections).onChange(async (v) => { this.plugin.settings.elnSections = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Compound Library File Path').setDesc('Point to a .md file (e.g. Meta/Compounds.md) that contains markdown tables or lists of your common chemicals. Used for auto-filling.').addText(text => text.setPlaceholder('Meta/Compounds.md').setValue(this.plugin.settings.libraryFilePath).onChange(async (v) => { this.plugin.settings.libraryFilePath = v; await this.plugin.saveSettings(); }));
        new Setting(genSec).setName('Media Images Save Path').setDesc('Folder where camera/TLC pictures will be stored (e.g. Assets/)').addText(text => text.setPlaceholder('Assets/').setValue(this.plugin.settings.mediaSavePath).onChange(async (v) => { this.plugin.settings.mediaSavePath = v; await this.plugin.saveSettings(); }));

        // ==========================================================
        // 2. DASHBOARDS & MODULES
        // ==========================================================
        const modSec = this.createAccordion(containerEl, "Active Modules & Dashboards", "🧩");
        modSec.createEl('p', { text: "Turn off features you don't use to save memory and declutter the command palette. (Restart Obsidian for changes to take effect).", cls: "setting-item-description" });
        
        new Setting(modSec).setName('Enable Core Dashboards & ELN').setDesc('Allows rendering of ```eln and enables the LIMS Dashboards.').addToggle(t => t.setValue(this.plugin.settings.enableEln).onChange(async (v) => { this.plugin.settings.enableEln = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Chem Navigator').setDesc('Enables the interactive side-panel for contextual chemistry analysis.').addToggle(t => t.setValue(this.plugin.settings.enableNavigator).onChange(async (v) => { this.plugin.settings.enableNavigator = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Synthesis Pathways').setDesc('Allows rendering of interactive ```chem-pathway and ```synthesis-plan blocks.').addToggle(t => t.setValue(this.plugin.settings.enablePathways).onChange(async (v) => { this.plugin.settings.enablePathways = v; await this.plugin.saveSettings(); }));
        new Setting(modSec).setName('Enable Chemistry Context Menu').setDesc('Shows properties and copy options when you right-click a SMILES block.').addToggle(t => t.setValue(this.plugin.settings.enableContextMenu).onChange(async (v) => { this.plugin.settings.enableContextMenu = v; await this.plugin.saveSettings(); }));

        modSec.createEl('h4', { text: 'Enable Specific Dashboards', attr: { style: 'margin-top: 20px; margin-bottom: 10px; color: var(--text-normal); border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 5px;' }});
        const makeDbToggle = (name: string, settingKey: keyof ChemEditSettings) => {
            new Setting(modSec).setName(name).addToggle(t => t.setValue(this.plugin.settings[settingKey] as boolean).onChange(async (v) => { (this.plugin.settings as any)[settingKey] = v; await this.plugin.saveSettings(); }));
        };
        makeDbToggle('🧪 ELN Notebook', 'enableElnDashboard');
        makeDbToggle('🛒 Orders & Requests', 'enableOrdersDashboard');
        makeDbToggle('📦 Chemical Inventory', 'enableInventoryDashboard');
        makeDbToggle('🔬 Lab Equipment', 'enableEquipmentDashboard');
        makeDbToggle('📄 SOPs & Protocols', 'enableProtocolsDashboard');
        makeDbToggle('📚 Compounds Library', 'enableLibraryDashboard');
        makeDbToggle('🖼️ Drawings Gallery', 'enableGalleryDashboard');
        makeDbToggle('📊 Characterization Data', 'enableCharacterizationDashboard');

        // ==========================================================
        // 3. RIGHT CLICK / CONTEXT MENU LINKS
        // ==========================================================
        const linkSec = this.createAccordion(containerEl, "Context Menu Web Links", "🌐");
        linkSec.createEl('p', { text: "Customize the web searches available when you right-click a chemical structure. Use {{smiles}} to inject the SMILES string.", cls: "setting-item-description" });
        
        new Setting(linkSec).setName('Custom Link 1 Name').addText(text => text.setValue(this.plugin.settings.contextUrl1Name).onChange(async (v) => { this.plugin.settings.contextUrl1Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 1 URL').addText(text => text.setValue(this.plugin.settings.contextUrl1).onChange(async (v) => { this.plugin.settings.contextUrl1 = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 2 Name').addText(text => text.setValue(this.plugin.settings.contextUrl2Name).onChange(async (v) => { this.plugin.settings.contextUrl2Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 2 URL').addText(text => text.setValue(this.plugin.settings.contextUrl2).onChange(async (v) => { this.plugin.settings.contextUrl2 = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 3 Name').addText(text => text.setValue(this.plugin.settings.contextUrl3Name).onChange(async (v) => { this.plugin.settings.contextUrl3Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 3 URL').addText(text => text.setValue(this.plugin.settings.contextUrl3).onChange(async (v) => { this.plugin.settings.contextUrl3 = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 4 Name').addText(text => text.setValue(this.plugin.settings.contextUrl4Name).onChange(async (v) => { this.plugin.settings.contextUrl4Name = v; await this.plugin.saveSettings(); }));
        new Setting(linkSec).setName('Custom Link 4 URL').addText(text => text.setValue(this.plugin.settings.contextUrl4).onChange(async (v) => { this.plugin.settings.contextUrl4 = v; await this.plugin.saveSettings(); }));

        // ==========================================================
        // 4. SCRIPTING ENGINE
        // ==========================================================
        const scriptSec = this.createAccordion(containerEl, "Scripting Engine", "📜");
        
        new Setting(scriptSec).setName('Enable Script Engine').setDesc('Turn off to save memory if you do not use custom JavaScript macros.').addToggle(t => t.setValue(this.plugin.settings.enableScripting).onChange(async (v) => { this.plugin.settings.enableScripting = v; await this.plugin.saveSettings(); this.display(); }));
        
        if (this.plugin.settings.enableScripting) {
            const storeWrap = scriptSec.createDiv({ attr: { style: "padding: 15px; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 8px; margin: 15px 0; display: flex; justify-content: space-between; align-items: center;" }});
            const storeText = storeWrap.createDiv();
            storeText.createEl("div", { text: "ChemEdit Script Store", attr: { style: "font-weight: 600; color: var(--text-normal);" }});
            storeText.createEl("div", { text: "Browse and install community macros (like MathifyChem).", attr: { style: "font-size: 12px; color: var(--text-muted); margin-top: 4px;" }});
            const openStoreBtn = storeWrap.createEl("button", { text: "Browse Scripts", cls: "mod-cta" });
            openStoreBtn.onclick = () => { const { ScriptStoreModal } = require('./ScriptStore'); new ScriptStoreModal(this.app, this.plugin).open(); };

            new Setting(scriptSec).setName('Scripts Folder').setDesc('Folder containing custom .js scripts.').addText(text => text.setPlaceholder('ChemEdit/Scripts').setValue(this.plugin.settings.scriptsFolder).onChange(async (v) => { this.plugin.settings.scriptsFolder = v; await this.plugin.saveSettings(); }));
        }

        // ==========================================================
        // 5. RENDERING & THEMING
        // ==========================================================
        const renderSec = this.createAccordion(containerEl, "Rendering & Theming", "🎨");
        
        new Setting(renderSec).setName('Image Size (Block Embeds)').setDesc('Width and Height of the rendered structure blocks (pixels)').addText(text => text.setPlaceholder('Width (300)').setValue(this.plugin.settings.width.toString()).onChange(async (v) => { this.plugin.settings.width = parseInt(v) || 300; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Height (300)').setValue(this.plugin.settings.height.toString()).onChange(async (v) => { this.plugin.settings.height = parseInt(v) || 300; await this.plugin.saveSettings(); }));
        new Setting(renderSec).setName('Render SMILES as SVG').setDesc('Uses SVG instead of High-DPI Canvas for SMILES blocks. Looks crisper at extreme zoom levels.').addToggle(toggle => toggle.setValue(this.plugin.settings.useSvgSmiles).onChange(async (value) => { this.plugin.settings.useSvgSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(renderSec).setName('ChemDraw ACS 1996 Style (Ketcher)').setDesc('Applies the classic ACS Document 1996 drawing settings.').addToggle(toggle => toggle.setValue(this.plugin.settings.useAcsSettings).onChange(async (value) => { this.plugin.settings.useAcsSettings = value; await this.plugin.saveSettings(); }));
        
        const themeOptions = { 'light': 'Light', 'dark': 'Dark', 'oldschool': 'Oldschool (B&W)', 'solarized': 'Solarized Light', 'solarized-dark': 'Solarized Dark', 'matrix': 'Matrix', 'cyberpunk': 'Cyberpunk' };
        new Setting(renderSec).setName('Themes').setDesc('Light and Dark mode rendering themes.').addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.lightTheme).onChange(async (value) => { this.plugin.settings.lightTheme = value; await this.plugin.saveSettings(); })).addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.darkTheme).onChange(async (value) => { this.plugin.settings.darkTheme = value; await this.plugin.saveSettings(); }));

        // ==========================================================
        // 6. SMART PASTE & FORMATS
        // ==========================================================
        const pasteSec = this.createAccordion(containerEl, "Smart Paste & Inline Embeds", "📋");
        
        new Setting(pasteSec).setName('Auto-format pasted SMILES').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteSmiles).onChange(async (value) => { this.plugin.settings.smartPasteSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Auto-format pasted MOL text').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteMol).onChange(async (value) => { this.plugin.settings.smartPasteMol = value; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Supported File Extensions').setDesc('Comma-separated list of extensions that render automatically via ![[file.ext]]').addText(text => text.setPlaceholder('mol, cdxml, ket...').setValue(this.plugin.settings.supportedEmbedExtensions).onChange(async (v) => { this.plugin.settings.supportedEmbedExtensions = v; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Inline Image Size').setDesc('Max width/height for inline text structures.').addText(text => text.setPlaceholder('Width (150)').setValue(this.plugin.settings.inlineWidth.toString()).onChange(async (v) => { this.plugin.settings.inlineWidth = parseInt(v) || 150; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Height (150)').setValue(this.plugin.settings.inlineHeight.toString()).onChange(async (v) => { this.plugin.settings.inlineHeight = parseInt(v) || 150; await this.plugin.saveSettings(); }));
        new Setting(pasteSec).setName('Inline Prefixes').setDesc('Text prefixes used to trigger inline rendering.').addText(text => text.setPlaceholder('SMILES ($smiles=)').setValue(this.plugin.settings.inlineSmilesPrefix).onChange(async (v) => { this.plugin.settings.inlineSmilesPrefix = v; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Files ($mol=)').setValue(this.plugin.settings.inlineMolPrefix).onChange(async (v) => { this.plugin.settings.inlineMolPrefix = v; await this.plugin.saveSettings(); }));

        // ==========================================================
        // 7. SIDEBAR ICONS
        // ==========================================================
        const iconSec = this.createAccordion(containerEl, "Sidebar Ribbon Icons", "🗂️");
        new Setting(iconSec).setName('Show LIMS Dashboards Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showDashboardRibbonIcon).onChange(async (value) => { this.plugin.settings.showDashboardRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show "Create Blank ELN" Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showElnRibbonIcon).onChange(async (value) => { this.plugin.settings.showElnRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show "Take Photo/TLC" Icons').addToggle(toggle => toggle.setValue(this.plugin.settings.showMediaRibbonIcons).onChange(async (value) => { this.plugin.settings.showMediaRibbonIcons = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(iconSec).setName('Show Chem Navigator Icon').addToggle(toggle => toggle.setValue(this.plugin.settings.showNavigatorRibbonIcon).onChange(async (value) => { this.plugin.settings.showNavigatorRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));

        // --- RESET BUTTON ---
        const resetWrap = containerEl.createDiv({ attr: { style: "margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;" } });
        resetWrap.createDiv({ text: "Danger Zone", attr: { style: "color: var(--text-error); font-weight: bold;" }});
        const resetBtn = resetWrap.createEl("button", { text: "Reset to Default Settings", attr: { style: "background-color: transparent; border: 1px solid var(--text-error); color: var(--text-error);" }});
        resetBtn.onclick = async () => {
            if (confirm("Are you sure you want to reset all ChemEdit settings to their defaults? This cannot be undone.")) {
                this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                await this.plugin.saveSettings();
                new Notice("ChemEdit settings reset to defaults. Please restart Obsidian.");
                this.display(); // Refresh UI
            }
        };
    }
}
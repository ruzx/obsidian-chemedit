// Settings.ts
import { App, PluginSettingTab, Setting } from 'obsidian';
import type ChemEditPlugin from './main';

export interface ChemEditSettings {
    // Feature Flags (Modules)
    enableEln: boolean;
    enableNavigator: boolean;
    enablePathways: boolean;
    enableContextMenu: boolean;

    // General & Rendering
    width: number; height: number; inlineWidth: number; inlineHeight: number;
    useSvgSmiles: boolean; useAcsSettings: boolean;
    lightTheme: string; darkTheme: string;
    
    // Embeds & Smart Paste
    inlineSmilesPrefix: string; inlineMolPrefix: string;
    smartPasteSmiles: boolean; smartPasteMol: boolean;
    supportedEmbedExtensions: string; mediaSavePath: string;
    
    // UI & ELN
    showMediaRibbonIcons: boolean; showElnRibbonIcon: boolean;
    showNavigatorRibbonIcon: boolean; // NEW: Toggle for Chem Navigator icon
    elnDirectory: string; elnPrefix: string; elnSections: string;
    libraryFilePath: string; 
    
    // Context Menu Web Links
    contextUrl1Name: string; contextUrl1: string; contextUrl2Name: string; contextUrl2: string;
    contextUrl3Name: string; contextUrl3: string; contextUrl4Name: string; contextUrl4: string;

    // Navigator Settings
    navigatorDefaultTab: string;
    pathwayColors: string;
}

export const DEFAULT_SETTINGS: ChemEditSettings = {
    enableEln: true, enableNavigator: true, enablePathways: true, enableContextMenu: true, 
    width: 300, height: 300, inlineWidth: 150, inlineHeight: 150, 
    lightTheme: 'light', darkTheme: 'dark',
    inlineSmilesPrefix: '$smiles=', inlineMolPrefix: '$mol=', 
    smartPasteSmiles: false, smartPasteMol: false,
    useSvgSmiles: true, useAcsSettings: false, mediaSavePath: "Assets/", 
    showMediaRibbonIcons: false, showElnRibbonIcon: true, showNavigatorRibbonIcon: true,
    elnDirectory: "ELN", elnPrefix: "EXP", elnSections: "TLC, LCMS, NMR",
    supportedEmbedExtensions: "mol, cdxml, ket, sdf, rxn, inchi, smarts, svg, fasta, sequence, idt, helm, biln",
    libraryFilePath: "ChemEdit/compounds.md",
    contextUrl1Name: "Search PubChem", contextUrl1: "https://pubchem.ncbi.nlm.nih.gov/#query={{smiles}}",
    contextUrl2Name: "Search MolPort", contextUrl2: "https://www.molport.com/shop/search-results?smiles={{smiles}}",
    contextUrl3Name: "Predict NMR (NMRium)", contextUrl3: "https://app.nmrium.com/predict?smiles={{smiles}}",
    contextUrl4Name: "Search ChemSpider", contextUrl4: "https://www.chemspider.com/Search.aspx?q={{smiles}}",
    navigatorDefaultTab: "context",
    pathwayColors: "#4e79a7, #f28e2c, #e15759, #76b7b2, #59a14f, #edc949, #af7aa1, #ff9da7, #9c755f, #bab0ab"
};

export class ChemEditSettingTab extends PluginSettingTab {
    plugin: ChemEditPlugin; 
    constructor(app: App, plugin: ChemEditPlugin) { super(app, plugin); this.plugin = plugin; }
    
    display(): void {
        const {containerEl} = this; containerEl.empty(); 
        containerEl.createEl('h2', {text: 'ChemEdit Settings'});
        
        const howtoEl = containerEl.createDiv({ attr: { style: "margin-bottom: 20px; font-size: 14px;" } });
        howtoEl.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 5px;">Quick How-To:</div>
            <ul style="margin: 0; padding-left: 20px; color: var(--text-muted); margin-bottom: 15px;">
                <li><b>Draw:</b> Click the Hexagon icon in the left ribbon to draw a new structure.</li>
                <li><b>Navigator:</b> Click the Flask icon to open the Chemical Navigator pane.</li>
                <li><b>Databases:</b> Use the Command Palette to insert Library, Inventory, or ELN databases!</li>
            </ul>
            <hr style="margin-top: 15px; border: 0; border-top: 1px solid var(--background-modifier-border);">
        `;

        // --- BASIC SETTINGS (Restored from GitHub version) ---
        containerEl.createEl('h3', { text: 'Basic Settings' });

        new Setting(containerEl).setName('Default ELN Directory').setDesc('Folder where new ELN experiments will be saved by default (e.g. Experiments/).').addText(text => text.setPlaceholder('Experiments/').setValue(this.plugin.settings.elnDirectory).onChange(async (v) => { this.plugin.settings.elnDirectory = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Default Experiment Prefix').setDesc('Prefix for new ELN files (e.g., EXP, JH, CHEM).').addText(text => text.setPlaceholder('EXP').setValue(this.plugin.settings.elnPrefix).onChange(async (v) => { this.plugin.settings.elnPrefix = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Analytical Sections').setDesc('Comma-separated list of sections to auto-generate inside new experiments.').addText(text => text.setPlaceholder('TLC, LCMS, NMR').setValue(this.plugin.settings.elnSections).onChange(async (v) => { this.plugin.settings.elnSections = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Compound Library File Path').setDesc('Optional: Point to a .md file (e.g. Meta/Compounds.md) that contains markdown tables or lists of your common chemicals. Used for auto-filling the ELN and the Library command.').addText(text => text.setPlaceholder('Meta/Compounds.md').setValue(this.plugin.settings.libraryFilePath).onChange(async (v) => { this.plugin.settings.libraryFilePath = v; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl).setName('Show Fume Hood Ribbon Icons').setDesc('Toggle Fume Hood Utilities (Flask, Camera, TLC) in the left sidebar.').addToggle(toggle => toggle.setValue(this.plugin.settings.showElnRibbonIcon).onChange(async (value) => { this.plugin.settings.showElnRibbonIcon = value; this.plugin.settings.showMediaRibbonIcons = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));
        new Setting(containerEl).setName('Show Chem Navigator Ribbon Icon').setDesc('Toggle the Chem Navigator compass icon in the left sidebar.').addToggle(toggle => toggle.setValue(this.plugin.settings.showNavigatorRibbonIcon).onChange(async (value) => { this.plugin.settings.showNavigatorRibbonIcon = value; await this.plugin.saveSettings(); this.plugin.refreshRibbonIcons(); }));

        // --- ADVANCED TOGGLE ---
        const advancedToggleBtn = containerEl.createEl('button', { text: "⚙️ Show Advanced Options", attr: { style: "margin-top: 20px; margin-bottom: 10px; width: 100%; font-weight: 600;" } });
        const advancedSection = containerEl.createDiv({ attr: { style: "display: none; padding-top: 10px;" } });

        advancedToggleBtn.onclick = () => {
            if (advancedSection.style.display === "none") { advancedSection.style.display = "block"; advancedToggleBtn.innerText = "Hide Advanced Options"; } 
            else { advancedSection.style.display = "none"; advancedToggleBtn.innerText = "⚙️ Show Advanced Options"; }
        };

        // --- MODULE TOGGLES (Moved inside Advanced) ---
        advancedSection.createEl('h3', { text: '🧩 Enabled Modules (Restart Required)' });
        advancedSection.createEl('p', { text: "Turn off features you don't use. You must restart the program (or reload the plugin) for changes to take effect.", cls: "setting-item-description", attr: { style: "margin-bottom: 15px;" }});
        
        new Setting(advancedSection).setName('Enable ELN & Databases').setDesc('Allows rendering of ```eln, ```chem-db, and ```chem-gallery blocks.').addToggle(t => t.setValue(this.plugin.settings.enableEln).onChange(async (v) => { this.plugin.settings.enableEln = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Enable Chem Navigator').setDesc('Enables the interactive side-panel for contextual chemistry analysis.').addToggle(t => t.setValue(this.plugin.settings.enableNavigator).onChange(async (v) => { this.plugin.settings.enableNavigator = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Enable Synthesis Pathways').setDesc('Allows rendering of interactive ```chem-pathway and ```synthesis-plan blocks.').addToggle(t => t.setValue(this.plugin.settings.enablePathways).onChange(async (v) => { this.plugin.settings.enablePathways = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Enable Chemistry Context Menu').setDesc('Shows chemical properties and copy options when you right-click a SMILES block.').addToggle(t => t.setValue(this.plugin.settings.enableContextMenu).onChange(async (v) => { this.plugin.settings.enableContextMenu = v; await this.plugin.saveSettings(); }));

        // --- GENERAL RENDERING ---
        advancedSection.createEl('h3', { text: '🧪 General Rendering' });
        new Setting(advancedSection).setName('Image Size (Block Embeds)').setDesc('Width and Height of the rendered structure blocks (pixels)').addText(text => text.setPlaceholder('Width (300)').setValue(this.plugin.settings.width.toString()).onChange(async (v) => { this.plugin.settings.width = parseInt(v) || 300; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Height (300)').setValue(this.plugin.settings.height.toString()).onChange(async (v) => { this.plugin.settings.height = parseInt(v) || 300; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Render SMILES as SVG').setDesc('Uses SVG instead of High-DPI Canvas for SMILES blocks. Looks crisper at extreme zoom levels.').addToggle(toggle => toggle.setValue(this.plugin.settings.useSvgSmiles).onChange(async (value) => { this.plugin.settings.useSvgSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('ChemDraw ACS 1996 Style (Ketcher)').setDesc('Applies the classic ACS Document 1996 drawing settings (bond lengths, fonts, thickness) to Ketcher editors and previews.').addToggle(toggle => toggle.setValue(this.plugin.settings.useAcsSettings).onChange(async (value) => { this.plugin.settings.useAcsSettings = value; await this.plugin.saveSettings(); }));

        // --- FUME HOOD UTILITIES ---
        advancedSection.createEl('h3', { text: '🔬 Fume Hood Utilities' });
        new Setting(advancedSection).setName('Media Images Save Path').setDesc('Folder where camera/TLC pictures will be stored (e.g. Assets/)').addText(text => text.setPlaceholder('Assets/').setValue(this.plugin.settings.mediaSavePath).onChange(async (v) => { this.plugin.settings.mediaSavePath = v; await this.plugin.saveSettings(); }));
        
        // --- NAVIGATOR SETTINGS ---
        advancedSection.createEl('h3', { text: '🗺️ Navigator & Pathways' });
        new Setting(advancedSection).setName('Navigator Default Tab').setDesc('Which tab to open by default in the Chem Navigator.').addDropdown(d => d.addOption('context', 'Context').addOption('projects', 'Projects').addOption('library', 'Library').addOption('inventory', 'Inventory').addOption('search', 'Search').addOption('tools', 'Tools').setValue(this.plugin.settings.navigatorDefaultTab).onChange(async (v) => { this.plugin.settings.navigatorDefaultTab = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Pathway Colors').setDesc('Comma separated hex colors for Mind-Map branches.').addTextArea(t => t.setValue(this.plugin.settings.pathwayColors).onChange(async (v) => { this.plugin.settings.pathwayColors = v; await this.plugin.saveSettings(); }));

        // --- CONTEXT MENU LINKS ---
        advancedSection.createEl('h3', { text: '🖱️ Context Menu (Right-Click)' });
        advancedSection.createEl('div', { cls: 'setting-item-description', text: 'Customize the links in the right-click menu for SMILES blocks. Use {{smiles}} to inject the structure.' }).style.marginBottom = "10px";
        new Setting(advancedSection).setName('Custom Link 1 Name').addText(text => text.setValue(this.plugin.settings.contextUrl1Name).onChange(async (v) => { this.plugin.settings.contextUrl1Name = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 1 URL').addText(text => text.setValue(this.plugin.settings.contextUrl1).onChange(async (v) => { this.plugin.settings.contextUrl1 = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 2 Name').addText(text => text.setValue(this.plugin.settings.contextUrl2Name).onChange(async (v) => { this.plugin.settings.contextUrl2Name = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 2 URL').addText(text => text.setValue(this.plugin.settings.contextUrl2).onChange(async (v) => { this.plugin.settings.contextUrl2 = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 3 Name').addText(text => text.setValue(this.plugin.settings.contextUrl3Name).onChange(async (v) => { this.plugin.settings.contextUrl3Name = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 3 URL').addText(text => text.setValue(this.plugin.settings.contextUrl3).onChange(async (v) => { this.plugin.settings.contextUrl3 = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 4 Name').addText(text => text.setValue(this.plugin.settings.contextUrl4Name).onChange(async (v) => { this.plugin.settings.contextUrl4Name = v; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Custom Link 4 URL').addText(text => text.setValue(this.plugin.settings.contextUrl4).onChange(async (v) => { this.plugin.settings.contextUrl4 = v; await this.plugin.saveSettings(); }));

        // --- SMART PASTE & EMBEDS ---
        advancedSection.createEl('h3', { text: '📋 Smart Paste & Embeds' });
        new Setting(advancedSection).setName('Auto-format pasted SMILES').setDesc('Automatically wrap pasted SMILES strings in a codeblock so they render as images instantly.').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteSmiles).onChange(async (value) => { this.plugin.settings.smartPasteSmiles = value; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Auto-format pasted MOL text').setDesc('Automatically wrap pasted MOL files (from ChemDraw/Marvin) in a codeblock.').addToggle(toggle => toggle.setValue(this.plugin.settings.smartPasteMol).onChange(async (value) => { this.plugin.settings.smartPasteMol = value; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Supported File Extensions').setDesc('Comma-separated list of extensions that should render chemical views automatically via ![[file.ext]] embeds.').addText(text => text.setPlaceholder('mol, cdxml, ket, sdf, rxn, inchi, smarts, svg, fasta, helm').setValue(this.plugin.settings.supportedEmbedExtensions).onChange(async (v) => { this.plugin.settings.supportedEmbedExtensions = v; await this.plugin.saveSettings(); }));

        // --- INLINE STRUCTURES ---
        advancedSection.createEl('h3', { text: '📝 Inline Structures' });
        new Setting(advancedSection).setName('Inline Image Size').setDesc('Max width/height for structures rendered inline').addText(text => text.setPlaceholder('Width (150)').setValue(this.plugin.settings.inlineWidth.toString()).onChange(async (v) => { this.plugin.settings.inlineWidth = parseInt(v) || 150; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Height (150)').setValue(this.plugin.settings.inlineHeight.toString()).onChange(async (v) => { this.plugin.settings.inlineHeight = parseInt(v) || 150; await this.plugin.saveSettings(); }));
        new Setting(advancedSection).setName('Inline Prefixes').setDesc('Text prefixes used to trigger inline rendering').addText(text => text.setPlaceholder('SMILES ($smiles=)').setValue(this.plugin.settings.inlineSmilesPrefix).onChange(async (v) => { this.plugin.settings.inlineSmilesPrefix = v; await this.plugin.saveSettings(); })).addText(text => text.setPlaceholder('Files ($mol=)').setValue(this.plugin.settings.inlineMolPrefix).onChange(async (v) => { this.plugin.settings.inlineMolPrefix = v; await this.plugin.saveSettings(); }));

        // --- THEMING ---
        advancedSection.createEl('h3', { text: '🎨 Theming' });
        const themeOptions = { 'light': 'Light', 'dark': 'Dark', 'oldschool': 'Oldschool (B&W)', 'solarized': 'Solarized Light', 'solarized-dark': 'Solarized Dark', 'matrix': 'Matrix', 'cyberpunk': 'Cyberpunk' };
        new Setting(advancedSection).setName('Themes').setDesc('Light and Dark mode rendering themes.').addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.lightTheme).onChange(async (value) => { this.plugin.settings.lightTheme = value; await this.plugin.saveSettings(); })).addDropdown(dropdown => dropdown.addOptions(themeOptions).setValue(this.plugin.settings.darkTheme).onChange(async (value) => { this.plugin.settings.darkTheme = value; await this.plugin.saveSettings(); }));
    }
}
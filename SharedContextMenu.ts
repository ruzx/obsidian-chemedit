// SharedContextMenu.ts
import { Menu, Notice, requestUrl } from 'obsidian';
import { AddToLibraryModal, addCompoundToLibrary, calculateMwOffline } from './SharedEln';
import { addCompoundToLibrary as addCompoundToDatabase } from './SharedBase';
import { ChemDataEngine } from './ChemDataEngine';

export function populateChemicalMenu(menu: Menu, plugin: any, smiles: string) {
    
    // --- DATABASE ACTIONS ---
    menu.addItem((item) => {
        item.setTitle("Add to Inline Library (Table)").setIcon("bookmark").onClick(() => {
            new AddToLibraryModal(plugin.app, smiles, (name: string, sm: string) => { 
                addCompoundToLibrary(plugin, name, sm); 
            }).open();
        });
    });

    menu.addItem((item) => {
        item.setTitle("Add to Compound Database (Card)").setIcon("flask-round").onClick(() => {
            addCompoundToDatabase(plugin.app, plugin, plugin.settings.elnDirectory || "Library", () => {}, smiles);
        });
    });

    menu.addSeparator();

    // --- COPY ACTIONS ---
    menu.addItem((item) => {
        item.setTitle("Copy SMILES").setIcon("copy").onClick(async () => {
            await navigator.clipboard.writeText(smiles); 
            new Notice("SMILES copied to clipboard!");
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy MOL Block (Offline)").setIcon("file-text").onClick(async () => {
            try {
                // Safely grab the headless engine from the new API
                const ketcher = plugin.api?.ketcher ? await plugin.api.ketcher.getHeadless() : plugin.headlessKetcher;
                
                if (ketcher) {
                    await ketcher.setMolecule(smiles);
                    const molBlock = await ketcher.getMolfile();
                    if (molBlock) {
                        await navigator.clipboard.writeText(molBlock);
                        new Notice("MOL Block copied to clipboard!");
                    }
                } else {
                    new Notice("Ketcher engine loading, try again in a second.");
                }
            } catch(err) { new Notice("Error generating MOL Block."); }
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy IUPAC Name (Web)").setIcon("whole-word").onClick(async () => {
            try {
                new Notice("Fetching IUPAC name...");
                const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/IUPACName/JSON`);
                
                if (res.status === 200) { 
                    const iupac = res.json.PropertyTable.Properties[0].IUPACName;
                    await navigator.clipboard.writeText(iupac); 
                    new Notice("IUPAC Name copied!"); 
                } else { 
                    new Notice("Failed to fetch IUPAC Name."); 
                }
            } catch(err) { new Notice("Error fetching IUPAC Name."); }
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy MW & Formula (Web/Offline)").setIcon("info").onClick(async () => {
            try {
                // 1. Try instantaneous OpenChemLib calculation
                const offlineProps = ChemDataEngine.getPropertiesFromSmiles(smiles);
                if (offlineProps && offlineProps.mw > 0) {
                    await navigator.clipboard.writeText(`Formula: ${offlineProps.formula}, MW: ${offlineProps.mw.toFixed(2)}`); 
                    new Notice("Properties copied (Offline)!"); 
                } else {
                    // 2. Try PubChem Web Fetch
                    new Notice("Fetching from Web...");
                    const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/MolecularWeight,MolecularFormula/JSON`);
                    if (res.status === 200) { 
                        const p = res.json.PropertyTable.Properties[0];
                        await navigator.clipboard.writeText(`Formula: ${p.MolecularFormula}, MW: ${p.MolecularWeight}`); 
                        new Notice("Properties copied (Web)!"); 
                    } else {
                        // 3. Absolute Fallback to regex counting
                        const props = await calculateMwOffline(smiles, plugin);
                        if (props && props.mw > 0) {
                            await navigator.clipboard.writeText(`Formula: ${props.formula}, MW: ${props.mw.toFixed(2)}`); 
                            new Notice(`Copied: Formula: ${props.formula}, MW: ${props.mw.toFixed(2)}`); 
                        } else {
                            new Notice("Properties not found.");
                        }
                    }
                }
            } catch(err) { new Notice("Error fetching properties."); }
        });
    });

    menu.addSeparator();

    // --- DYNAMIC WEB SEARCH LINKS ---
    const addCustomLink = (name: string, urlTemplate: string, icon: string) => {
        if (!name || !urlTemplate) return;
        menu.addItem((item) => {
            item.setTitle(`${name} (Web)`).setIcon(icon).onClick(() => {
                const url = urlTemplate.replace(/\{\{smiles\}\}/gi, encodeURIComponent(smiles));
                window.open(url, '_blank');
            });
        });
    };

    const s = plugin.settings;
    addCustomLink(s.contextUrl1Name, s.contextUrl1, "search");
    addCustomLink(s.contextUrl2Name, s.contextUrl2, "shopping-cart");
    addCustomLink(s.contextUrl3Name, s.contextUrl3, "activity");
    addCustomLink(s.contextUrl4Name, s.contextUrl4, "link");
}

export function showChemicalContextMenu(plugin: any, e: MouseEvent, smiles: string) {
    e.preventDefault();
    const menu = new Menu();
    populateChemicalMenu(menu, plugin, smiles);
    menu.showAtMouseEvent(e);
}
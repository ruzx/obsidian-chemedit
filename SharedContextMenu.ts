// SharedContextMenu.ts
import { Menu, Notice, requestUrl } from 'obsidian';
import { AddToLibraryModal, addCompoundToLibrary } from './SharedEln';

export function showChemicalContextMenu(plugin: any, e: MouseEvent, smiles: string) {
    e.preventDefault();
    const menu = new Menu();
    
    menu.addItem((item) => {
        item.setTitle("Add to Compound Library").setIcon("bookmark").onClick(() => {
            new AddToLibraryModal(plugin.app, smiles, (name: string, sm: string) => { 
                addCompoundToLibrary(plugin, name, sm); 
            }).open();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
        item.setTitle("Copy SMILES").setIcon("copy").onClick(async () => {
            await navigator.clipboard.writeText(smiles); 
            new Notice("SMILES copied to clipboard!");
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy MOL Block (Offline)").setIcon("file-text").onClick(async () => {
            try {
                if (plugin.headlessKetcher) {
                    await plugin.headlessKetcher.setMolecule(smiles);
                    const molBlock = await plugin.headlessKetcher.getMolfile();
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
                    const name = res.json?.PropertyTable?.Properties?.[0]?.IUPACName;
                    if (name) {
                        await navigator.clipboard.writeText(name); 
                        new Notice("IUPAC Name copied!"); 
                    } else { new Notice("IUPAC Name not found."); }
                } else { new Notice("Failed to fetch IUPAC Name."); }
            } catch(err) { new Notice("Error fetching IUPAC Name."); }
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy MW & Formula (Web)").setIcon("info").onClick(async () => {
            try {
                const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/MolecularWeight,MolecularFormula/JSON`);
                if (res.status === 200) { 
                    const p = res.json?.PropertyTable?.Properties?.[0];
                    if (p && p.MolecularFormula && p.MolecularWeight) {
                        await navigator.clipboard.writeText(`Formula: ${p.MolecularFormula}, MW: ${p.MolecularWeight}`); 
                        new Notice("Properties copied!"); 
                    } else { new Notice("Properties not found."); }
                }
            } catch(err) { new Notice("Error fetching properties."); }
        });
    });

    menu.addItem((item) => {
        item.setTitle("Copy CAS Number (Web)").setIcon("hash").onClick(async () => {
            try {
                new Notice("Fetching CAS Number...");
                const res = await requestUrl(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/cas`);
                if (res.status === 200) { 
                    const cas = res.text.split('\n')[0].trim();
                    if (cas && !cas.includes("<h1>")) { // Basic check to ensure it's not a 404 HTML page
                        await navigator.clipboard.writeText(cas); 
                        new Notice(`CAS Number copied: ${cas}`); 
                    } else { new Notice("CAS Number not found for this structure."); }
                } else { new Notice("Failed to fetch CAS Number."); }
            } catch(err) { new Notice("Error fetching CAS Number."); }
        });
    });

    menu.addSeparator();

    // Dynamically add custom URL links from settings
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

    menu.showAtMouseEvent(e);
}
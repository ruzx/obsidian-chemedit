// ExcalidrawBridge.ts
import { Notice, TFile, ItemView, setIcon, requestUrl } from 'obsidian';
import type ChemEditPlugin from './main';
import { extractDataFromSvg, embedDataInSvg } from './main';
import { calculateMwOffline } from './SharedEln';

export function initExcalidrawBridge(plugin: ChemEditPlugin) {
    plugin.registerEvent(plugin.app.workspace.on('layout-change', () => injectExcalidrawUI(plugin)));
    plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => injectExcalidrawUI(plugin)));
    setTimeout(() => injectExcalidrawUI(plugin), 1000);
}

function injectExcalidrawUI(plugin: ChemEditPlugin) {
    const view = plugin.app.workspace.getActiveViewOfType(ItemView);
    if (!view || view.getViewType() !== "excalidraw") return;

    const container = view.containerEl;
    const excalidrawUI = container.querySelector('.excalidraw');
    if (!excalidrawUI) return;

    let toolsContainer = container.querySelector('.chemedit-excalidraw-tools') as HTMLElement;
    if (!toolsContainer) {
        toolsContainer = document.createElement('div');
        toolsContainer.className = 'chemedit-excalidraw-tools';
        
        Object.assign(toolsContainer.style, {
            position: 'absolute',
            top: '80px',
            left: '16px',
            zIndex: '100',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '6px',
            backgroundColor: 'var(--background-primary)',
            borderRadius: '8px',
            border: '1px solid var(--background-modifier-border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        });
        excalidrawUI.appendChild(toolsContainer);

        const createBtn = (iconName: string, title: string, isMain: boolean, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.title = title;
            setIcon(btn, iconName);
            
            const size = isMain ? '38px' : '32px';
            const iconColor = isMain ? 'var(--text-normal)' : 'var(--text-muted)';
            const bgColor = isMain ? 'var(--background-modifier-active-hover)' : 'transparent';

            Object.assign(btn.style, {
                width: size, height: size, padding: '6px', borderRadius: '6px',
                backgroundColor: bgColor, color: iconColor, border: '1px solid transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s'
            });

            btn.onmouseover = () => { 
                btn.style.color = "var(--text-normal)"; 
                btn.style.backgroundColor = "var(--background-modifier-hover)"; 
                btn.style.borderColor = "var(--background-modifier-border)";
            };
            btn.onmouseout = () => { 
                btn.style.color = iconColor; 
                btn.style.backgroundColor = bgColor; 
                btn.style.borderColor = "transparent";
            };
            btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
            toolsContainer.appendChild(btn);
        };

        // THE TOOLBAR
        createBtn("hexagon", "Draw Structure (Select text like 'Aspirin' first to auto-convert)", true, () => handleAction(plugin, view, 'draw'));
        createBtn("info", "Extract Properties & IUPAC Name", false, () => handleAction(plugin, view, 'props'));
        createBtn("copy", "Copy SMILES to Clipboard", false, () => handleAction(plugin, view, 'copy'));
        createBtn("globe", "Search molecule on PubChem", false, () => handleAction(plugin, view, 'web'));
    }

    if (!container.dataset.chemeditDblClick) {
        container.dataset.chemeditDblClick = "true";
        container.addEventListener('dblclick', (e) => {
            const ea = plugin.app.plugins.plugins['obsidian-excalidraw-plugin']?.ea;
            if (!ea) return;
            ea.setView(view);

            setTimeout(() => {
                const selected = ea.getViewSelectedElements();
                if (selected.length === 1 && selected[0].type === "image") {
                    handleAction(plugin, view, 'draw', true, selected[0]);
                }
            }, 50);
        }, true);
    }
}

async function handleAction(plugin: ChemEditPlugin, view: any, actionType: 'draw'|'props'|'copy'|'web', isDblClick: boolean = false, targetEl: any = null) {
    const ea = plugin.app.plugins.plugins['obsidian-excalidraw-plugin']?.ea;
    if (!ea) { new Notice("Excalidraw API not found."); return; }
    ea.setView(view);

    const selected = ea.getViewSelectedElements();
    let initialData = "";
    let tfile: TFile | null = null;
    let elementToUpdate = targetEl;
    let isEdit = isDblClick;

    if (!isDblClick && selected.length === 1) {
        const sel = selected[0];
        if (sel.type === "text" && actionType === 'draw') {
            const textVal = sel.text.trim();
            new Notice("Resolving Structure from Web...");
            let smi = textVal;
            if (!/^[A-Za-z0-9@+\-\[\]\(\)\\\/=#%]+$/.test(textVal) || !/[CNOcno]/.test(textVal)) {
                try {
                    const opsin = await requestUrl(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(textVal)}.smi`);
                    if (opsin.status === 200) smi = opsin.text.trim();
                } catch(e) {}
            }
            initialData = smi;
        } 
        else if (sel.type === "image") {
            elementToUpdate = sel;
            isEdit = true;
        }
    }

    if (isEdit && elementToUpdate) {
        const excalidrawFile = view.excalidrawData.getFile(elementToUpdate.fileId);
        if (excalidrawFile && excalidrawFile.file) {
            tfile = excalidrawFile.file as TFile;
            if (['svg', 'mol', 'cdxml'].includes(tfile.extension.toLowerCase())) {
                initialData = await plugin.app.vault.read(tfile);
                if (tfile.extension.toLowerCase() === 'svg') {
                    const ex = extractDataFromSvg(initialData);
                    if (ex) initialData = ex.data;
                    else { if(actionType !== 'draw') new Notice("No chemical metadata found."); return; }
                }
            } else return; 
        } else return;
    }

    if (actionType !== 'draw' && !initialData) { new Notice("Please select a valid chemical structure first."); return; }

    let smilesData = initialData;
    if (actionType === 'copy' || actionType === 'web' || actionType === 'props') {
        new Notice("Processing structure...", 1000);
        try { smilesData = await plugin.api.ketcher.convertFormat(initialData, 'smiles'); } 
        catch (e) { new Notice("Failed to convert structure."); return; }
    }

    if (actionType === 'copy') { navigator.clipboard.writeText(smilesData); new Notice("SMILES Copied!"); return; }
    if (actionType === 'web') { window.open(`https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(smilesData)}`, '_blank'); return; }

    if (actionType === 'props') {
        new Notice("Calculating Properties...");
        const props = await calculateMwOffline(smilesData, plugin);
        let iupac = "";
        try {
            const res = await requestUrl(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smilesData)}/property/IUPACName/JSON`);
            if (res.status === 200) iupac = res.json.PropertyTable.Properties[0].IUPACName;
        } catch(e) {}

        if (props && props.mw > 0) {
            ea.clear();
            const text = `${iupac ? `**Name:** ${iupac}\n` : ''}**Formula:** ${props.formula}\n**MW:** ${props.mw.toFixed(2)}`;
            ea.addText(elementToUpdate.x + (elementToUpdate.width/2), elementToUpdate.y + elementToUpdate.height + 15, text, { textAlign: "center", fontSize: 16, strokeColor: "var(--text-muted)" });
            await ea.addElementsToView(false, false);
        } else { new Notice("Failed to calculate properties."); }
        return;
    }

    if (actionType === 'draw') {
        plugin.api.ketcher.openEditor(initialData, "svg", async (newData, isFile) => {
            if (isFile) { new Notice("Cannot 'Save as file' from Canvas mode."); return; }

            let newWidth = 300, newHeight = 300;
            const matchW = newData.match(/width="([^"]+)"/);
            const matchH = newData.match(/height="([^"]+)"/);
            const matchVB = newData.match(/viewBox="[^"]*\s[^"]*\s([^"]+)\s([^"]+)"/);
            
            if (matchW && matchH) { newWidth = parseFloat(matchW[1]); newHeight = parseFloat(matchH[1]); } 
            else if (matchVB) { newWidth = parseFloat(matchVB[1]); newHeight = parseFloat(matchVB[2]); }

            const excalidrawAPI = ea.getExcalidrawAPI();

            if (isEdit && tfile && elementToUpdate) {
                // WRITE TO DISK
                await plugin.app.vault.modify(tfile, newData);

                // MEMORY CACHE BUST (Forces Excalidraw to load the new SVG content)
                const mimeType = "image/svg+xml";
                const dataURL = `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(newData)))}`;
                
                excalidrawAPI.addFiles([{
                    id: elementToUpdate.fileId,
                    dataURL: dataURL,
                    mimeType: mimeType,
                    created: Date.now()
                }]);

                // DIRECT IN-PLACE RESIZE (Prevents UI ghost duplicates)
                const elements = ea.getViewElements();
                const el = elements.find((e: any) => e.id === elementToUpdate.id);
                if (el) {
                    el.width = newWidth;
                    el.height = newHeight;
                    el.version++;
                    el.versionNonce = Math.floor(Math.random() * 100000000);
                }
                
                excalidrawAPI.updateScene({ elements });
                new Notice("Structure Updated");
                
            } else {
                // NEW STRUCTURE
                new Notice("Generating structure...");
                let savePath = plugin.settings.mediaSavePath || "Assets/";
                if (savePath && !savePath.endsWith("/")) savePath += "/";
                if (savePath && !plugin.app.vault.getAbstractFileByPath(savePath.slice(0,-1))) await plugin.app.vault.createFolder(savePath.slice(0,-1));
                
                const filename = `${savePath}Structure_${window.moment().format("YYYYMMDD_HHmmss")}.svg`;
                const fileToEmbed = await plugin.app.vault.create(filename, newData);
                
                ea.clear();
                if (selected.length === 1 && selected[0].type === "text") {
                    const sel = selected[0];
                    await ea.addImage(sel.x, sel.y, fileToEmbed);
                    ea.deleteViewElements([sel]);
                    await ea.addElementsToView(false, false); 
                } else {
                    await ea.addImage(0, 0, fileToEmbed);
                    await ea.addElementsToView(true, false);
                }

                setTimeout(() => {
                    const elements = ea.getViewElements();
                    const el = elements[elements.length - 1]; 
                    if (el && el.type === "image") {
                        el.width = newWidth; el.height = newHeight; el.version++;
                        excalidrawAPI.updateScene({ elements });
                    }
                }, 100);
            }
        });
    }
}
// CanvasBridge.ts
import { Notice, TFile, ItemView, setIcon, requestUrl } from 'obsidian';
import type ChemEditPlugin from './main';
import { extractDataFromSvg, embedDataInSvg } from './main';
import { calculateMwOffline } from './SharedEln';

export function initCanvasBridge(plugin: ChemEditPlugin) {
    plugin.registerEvent(plugin.app.workspace.on('layout-change', () => injectCanvasUI(plugin)));
    plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => injectCanvasUI(plugin)));
    setTimeout(() => injectCanvasUI(plugin), 1000);
}

function injectCanvasUI(plugin: ChemEditPlugin) {
    const view = plugin.app.workspace.getActiveViewOfType(ItemView);
    if (!view || view.getViewType() !== "canvas") return;

    const container = view.containerEl;
    const canvasUI = container.querySelector('.canvas-wrapper') || container;
    if (!canvasUI) return;

    let toolsContainer = container.querySelector('.chemedit-canvas-tools') as HTMLElement;
    if (!toolsContainer) {
        toolsContainer = document.createElement('div');
        toolsContainer.className = 'chemedit-canvas-tools';
        
        // POSITIONING: Top Left, perfectly clear of native Canvas tools
        Object.assign(toolsContainer.style, {
            position: 'absolute',
            top: '70px',
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
        canvasUI.appendChild(toolsContainer);

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
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
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

        createBtn("hexagon", "Draw Structure (Select text like 'Aspirin' first to auto-convert)", true, () => handleCanvasAction(plugin, view, 'draw'));
        createBtn("info", "Extract Properties & IUPAC Name", false, () => handleCanvasAction(plugin, view, 'props'));
        createBtn("copy", "Copy SMILES to Clipboard", false, () => handleCanvasAction(plugin, view, 'copy'));
        createBtn("globe", "Search molecule on PubChem", false, () => handleCanvasAction(plugin, view, 'web'));
    }

    if (!container.dataset.chemeditDblClick) {
        container.dataset.chemeditDblClick = "true";
        container.addEventListener('dblclick', (e) => {
            const canvas = (view as any).canvas;
            if (!canvas) return;
            
            setTimeout(() => {
                const selectedNodes = Array.from(canvas.selection);
                if (selectedNodes.length === 1) {
                    const node = selectedNodes[0] as any;
                    if (node.file) handleCanvasAction(plugin, view, 'draw', true, node);
                }
            }, 50);
        }, true);
    }
}

// ---------------------------------------------------------
// POST-PROCESSOR: ChemDraw ACS 1996 / Total Synthesis Styler
// ---------------------------------------------------------
function applyChemDrawStyle(svg: string): string {
    let polished = svg.replace(/font-family="[^"]*"/g, 'font-family="Arial, Helvetica, sans-serif"');
    polished = polished.replace(/(stroke|fill)="#333333"/gi, '$1="#000000"');
    return polished;
}

async function handleCanvasAction(plugin: ChemEditPlugin, view: any, actionType: 'draw'|'props'|'copy'|'web', isDblClick: boolean = false, targetNode: any = null) {
    const canvas = view.canvas;
    if (!canvas) { new Notice("Canvas API not found."); return; }

    const selectedNodes = Array.from(canvas.selection) as any[];
    let initialData = "";
    let tfile: TFile | null = null;
    let nodeToUpdate = targetNode;
    let isEdit = isDblClick;

    if (!isDblClick && selectedNodes.length === 1) {
        const node = selectedNodes[0];
        if (node.text !== undefined && actionType === 'draw') {
            const textVal = node.text.trim();
            new Notice("Resolving Structure from Web...");
            let smi = textVal;
            if (!/^[A-Za-z0-9@+\-\[\]\(\)\\\/=#%]+$/.test(textVal) || !/[CNOcno]/.test(textVal)) {
                try {
                    const opsin = await requestUrl(`https://opsin.ch.cam.ac.uk/opsin/${encodeURIComponent(textVal)}.smi`);
                    if (opsin.status === 200) smi = opsin.text.trim();
                } catch(e) {}
            }
            initialData = smi;
            nodeToUpdate = node;
        } 
        else if (node.file) {
            nodeToUpdate = node;
            isEdit = true;
        }
    }

    if (isEdit && nodeToUpdate && nodeToUpdate.file) {
        tfile = nodeToUpdate.file as TFile;
        if (['svg', 'mol', 'cdxml'].includes(tfile.extension.toLowerCase())) {
            initialData = await plugin.app.vault.read(tfile);
            if (tfile.extension.toLowerCase() === 'svg') {
                const ex = extractDataFromSvg(initialData);
                if (ex) initialData = ex.data;
                else { if(actionType !== 'draw') new Notice("No chemical metadata found."); return; }
            }
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
            const text = `${iupac ? `**Name:** ${iupac}\n` : ''}**Formula:** ${props.formula}\n**MW:** ${props.mw.toFixed(2)}`;
            canvas.createTextNode({
                pos: { x: nodeToUpdate.x, y: nodeToUpdate.y + nodeToUpdate.height + 20 },
                size: { width: Math.max(nodeToUpdate.width, 200), height: 100 },
                text: text, save: true
            });
            canvas.requestSave();
        } else { new Notice("Failed to calculate properties."); }
        return;
    }

    if (actionType === 'draw') {
        plugin.api.ketcher.openEditor(initialData, "svg", async (newData, isFile) => {
            if (isFile) { new Notice("Cannot 'Save as file' from Canvas mode."); return; }

            // 1. APPLY CHEMDRAW STYLING
            newData = applyChemDrawStyle(newData);

            // 2. EXTRACT DIMENSIONS (Fixing px strings)
            let newWidth = 300, newHeight = 300;
            const matchW = newData.match(/width="([^"]+)"/);
            const matchH = newData.match(/height="([^"]+)"/);
            const matchVB = newData.match(/viewBox="[^"]*\s[^"]*\s([^"]+)\s([^"]+)"/);
            
            if (matchW && matchH) { 
                newWidth = parseFloat(matchW[1].replace('px', '')); 
                newHeight = parseFloat(matchH[1].replace('px', '')); 
            } else if (matchVB) { 
                newWidth = parseFloat(matchVB[1]); 
                newHeight = parseFloat(matchVB[2]); 
            }

            if (isEdit && tfile && nodeToUpdate) {
                // EDIT EXISTING IN PLACE (PRESERVES CONNECTIONS!)
                await plugin.app.vault.modify(tfile, newData);

                // Update Size
                if (typeof nodeToUpdate.moveAndResize === 'function') {
                    nodeToUpdate.moveAndResize({ x: nodeToUpdate.x, y: nodeToUpdate.y, width: newWidth, height: newHeight });
                } else {
                    nodeToUpdate.width = newWidth; nodeToUpdate.height = newHeight;
                }

                // FORCE OBSIDIAN CANVAS CACHE BUST
                setTimeout(() => {
                    if (nodeToUpdate.nodeEl) {
                        const imgEls = nodeToUpdate.nodeEl.querySelectorAll('img');
                        imgEls.forEach((img: HTMLImageElement) => {
                            const currentSrc = img.getAttribute('src');
                            if (currentSrc) {
                                img.setAttribute('src', currentSrc.split('?')[0] + '?_t=' + Date.now());
                            }
                        });
                    }
                    if (typeof nodeToUpdate.render === 'function') nodeToUpdate.render();
                    canvas.requestSave();
                }, 150);

                new Notice("Structure Updated");

            } else {
                // NEW STRUCTURE
                new Notice("Generating structure...");
                let savePath = plugin.settings.mediaSavePath || "Assets/";
                if (savePath && !savePath.endsWith("/")) savePath += "/";
                if (savePath && !plugin.app.vault.getAbstractFileByPath(savePath.slice(0,-1))) await plugin.app.vault.createFolder(savePath.slice(0,-1));
                
                const filename = `${savePath}Structure_${window.moment().format("YYYYMMDD_HHmmss")}.svg`;
                const fileToEmbed = await plugin.app.vault.create(filename, newData);
                
                // Wait for Obsidian to register the file
                await new Promise(r => setTimeout(r, 200));
                
                if (nodeToUpdate && nodeToUpdate.text !== undefined) {
                    const posX = nodeToUpdate.x; const posY = nodeToUpdate.y;
                    canvas.removeNode(nodeToUpdate);
                    canvas.createFileNode({ file: fileToEmbed, pos: { x: posX, y: posY }, size: { width: newWidth, height: newHeight }, save: true });
                } else {
                    // FIX: Robust calculation for dropping exactly in the center of the Canvas view!
                    const zoom = canvas.zoom || 1;
                    const dropX = ((window.innerWidth / 2) - (canvas.x || 0)) / zoom - (newWidth / 2);
                    const dropY = ((window.innerHeight / 2) - (canvas.y || 0)) / zoom - (newHeight / 2);

                    canvas.createFileNode({
                        file: fileToEmbed,
                        pos: { x: dropX, y: dropY },
                        size: { width: newWidth, height: newHeight }, 
                        save: true
                    });
                }
                canvas.requestSave();
            }
        });
    }
}
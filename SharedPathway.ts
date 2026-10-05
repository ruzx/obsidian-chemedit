// SharedPathway.ts
import { App, TFile, MarkdownView, Notice, Modal } from 'obsidian';
import { CreateExperimentModal, CloneExperimentModal } from './SharedEln';

interface GraphNode {
    id: string;          
    type: 'smiles' | 'eln' | 'text';
    label: string;
    smiles: string;
    data?: any;          
    rank: number;
    color?: string;      // Branch Color
    el?: HTMLElement;    
    rawToken?: string;   
}

interface GraphEdge {
    source: string; 
    target: string;
    color?: string;      // Inherited Edge Color
}

// Professional Mind-Map Color Palette
const PATH_COLORS = [
    "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
    "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"
];

export class SynthesisMapRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    // ========================================================================
    // 1. AUTO-GENERATED SYNTHESIS MAP (Clean Horizontal Rows)
    // ========================================================================
    async renderMap(source: string, el: HTMLElement, ctx: any) {
        const pathLine = source.split('\n').find(l => l.trim().startsWith('path:'));
        let folderPath = pathLine ? pathLine.replace('path:', '').trim() : "";
        
        const projectLine = source.split('\n').find(l => l.trim().startsWith('project:'));
        const targetProject = projectLine ? projectLine.replace('project:', '').trim() : "";

        if (!folderPath) {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile && activeFile.parent) folderPath = activeFile.parent.path === "/" ? "" : activeFile.parent.path;
        }

        const folder = folderPath === "" ? this.plugin.app.vault.getRoot() : this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) { 
            el.createEl("div", { text: `⚠️ Folder not found: ${folderPath || "Root Vault"}`, cls: "color-text-error" }); return; 
        }

        const files = (folder as any).children.filter((f: any) => f instanceof TFile && f.extension.toLowerCase() === 'md');
        const mapTitle = targetProject ? `🗺️ Synthesis Map: ${targetProject}` : "🗺️ Synthesis Map";
        const wrapper = this.createBaseWrapper(el, folderPath, mapTitle, false, ctx);
        const container = wrapper.querySelector('.chem-pathway-grid') as HTMLElement;
        
        container.style.flexDirection = "column";
        container.style.alignItems = "stretch"; 
        container.style.gap = "15px";

        let renderedCount = 0;

        for (const file of files) {
            const exp = await this.fetchChemicalData(file);
            if (!exp || exp.type !== 'eln') continue;

            if (targetProject && exp.data?.project !== targetProject) continue;

            const reactantSmi = exp.data?.reactants?.[0]?.smiles || "";
            const productSmi = exp.data?.products?.[0]?.smiles || "";
            const yieldNum = parseFloat(exp.data?.products?.[0]?.yield);
            const yieldStr = isNaN(yieldNum) ? 'N/A' : `${yieldNum}%`;
            const code = exp.data?.code || file.basename;

            if (!reactantSmi && !productSmi) continue;
            
            const color = PATH_COLORS[renderedCount % PATH_COLORS.length];
            renderedCount++;

            // Premium Row Wrapper with Subtle Gradient
            const rowWrapper = container.createDiv({ attr: { style: `display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 25px; width: 100%; padding: 15px 25px; background: linear-gradient(90deg, ${color}11, var(--background-primary) 30%); border: 1px solid var(--background-modifier-border); border-left: 5px solid ${color}; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);` }});

            if (reactantSmi) this.drawChemicalNode(rowWrapper, reactantSmi, exp.data?.reactants?.[0]?.name || "Starting Material", null, null, null, undefined, false, undefined, undefined, color);

            // Premium Arrow Box
            const arrowWrapper = rowWrapper.createDiv({ cls: "chem-exp-node", attr: { "data-search": `${code} ${productSmi} ${reactantSmi} ${exp.data?.project || ''}`.toLowerCase(), style: "display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; padding: 15px; border-radius: 6px; border: 1px solid transparent; min-width: 100px;" }});
            
            const badgeColor = yieldNum >= 80 ? 'var(--text-success)' : yieldNum <= 30 ? 'var(--text-error)' : 'var(--text-warning)';
            
            arrowWrapper.innerHTML = `
                <div style="font-size: 11px; color: var(--text-accent); font-weight: 700; background: var(--background-primary); padding: 4px 10px; border-radius: 12px; border: 1px solid var(--background-modifier-border); box-shadow: 0 1px 2px rgba(0,0,0,0.05); text-align: center;">${code}</div>
                <div style="font-size: 20px; color: ${color}; line-height: 1; margin: 8px 0; text-align: center;">⟶</div>
                <div style="font-size: 12px; color: ${badgeColor}; font-weight: 800; text-align: center;">${yieldStr}</div>
                ${exp.data?.project ? `<div style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-top: 6px; letter-spacing: 0.5px;">${exp.data.project}</div>` : ''}
            `;
            
            arrowWrapper.onmouseover = () => { arrowWrapper.style.backgroundColor = "var(--background-modifier-hover)"; arrowWrapper.style.borderColor = "var(--interactive-accent)"; arrowWrapper.style.transform = "scale(1.02)"; };
            arrowWrapper.onmouseout = () => { arrowWrapper.style.backgroundColor = "transparent"; arrowWrapper.style.borderColor = "transparent"; arrowWrapper.style.transform = "scale(1)"; };
            arrowWrapper.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(file);

            if (productSmi) this.drawChemicalNode(rowWrapper, productSmi, exp.data?.products?.[0]?.name || "Product", null, null, null, undefined, false, undefined, undefined, color);
        }

        if (renderedCount === 0) container.innerHTML = `<span class="color-text-muted" style="padding: 20px; font-style: italic;">No experiments found matching these criteria.</span>`;
        this.attachSearchLogic(wrapper);
    }

    // ========================================================================
    // 2. MANUAL SYNTHESIS PLAN (Interactive Mind-Map)
    // ========================================================================
    async renderPlan(source: string, el: HTMLElement, ctx: any) {
        const lines = source.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('path:') && !l.startsWith('project:'));
        
        const projectLine = source.split('\n').find(l => l.trim().startsWith('project:'));
        const targetProject = projectLine ? projectLine.replace('project:', '').trim() : "";
        const mapTitle = targetProject ? `🎯 Synthesis Plan: ${targetProject}` : "🎯 Synthesis Plan";

        const nodes = new Map<string, GraphNode>();
        const edges: GraphEdge[] = [];

        for (const line of lines) {
            const tokens = line.split(/\s*(?:->|=>)\s*/).filter(t => t.trim().length > 0);
            let prevId: string | null = null;

            for (const token of tokens) {
                const rawToken = token.trim();
                const linkMatch = rawToken.match(/\[\[(.*?)\]\]/);
                let currentId = rawToken;

                if (!nodes.has(currentId)) {
                    let type: 'eln' | 'smiles' | 'text' = 'text';
                    let label = rawToken;
                    let smiles = '';
                    let data = null;

                    if (linkMatch) {
                        const cleanName = linkMatch[1].split('|')[0].trim(); 
                        const alias = linkMatch[1].includes('|') ? linkMatch[1].split('|')[1].trim() : null;

                        let file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, ctx.sourcePath);
                        if (!file) file = this.plugin.app.vault.getMarkdownFiles().find((f: TFile) => f.basename === cleanName || f.name === cleanName);

                        if (file) {
                            const exp = await this.fetchChemicalData(file);
                            if (exp && exp.smiles) {
                                type = exp.type; smiles = exp.smiles; data = exp.data;
                                label = alias ? alias : (exp.type === 'eln' ? (exp.data?.code || file.basename) : file.basename);
                                currentId = file.path; 
                            } else { label = `[No Structure: ${cleanName}]`; }
                        } else { label = `[Missing Note: ${cleanName}]`; }
                    } else if (rawToken.includes('|')) {
                        const parts = rawToken.split('|');
                        type = 'smiles'; smiles = parts[0].trim(); label = parts[1].trim();
                    } else {
                        const isSmiles = /^[A-Za-z0-9@+\-\[\]\(\)\\\/=#%\.]+$/.test(rawToken) && /[A-Za-z]/.test(rawToken);
                        if (isSmiles) { 
                            type = 'smiles'; smiles = rawToken; 
                            label = rawToken.length > 15 ? `${rawToken.substring(0,12)}...` : rawToken; 
                        } else { type = 'text'; label = rawToken; }
                    }

                    if (!nodes.has(currentId)) nodes.set(currentId, { id: currentId, type, smiles, label, data, rank: 0, rawToken });
                }

                if (prevId) edges.push({ source: prevId, target: currentId });
                prevId = currentId;
            }
        }

        await this.renderDAG(el, nodes, edges, "", mapTitle, ctx, true);
    }

    // ========================================================================
    // INTERACTIVE DAG RENDERER
    // ========================================================================
    private async renderDAG(el: HTMLElement, nodes: Map<string, GraphNode>, edges: GraphEdge[], folderPath: string, titleText: string, ctx: any, isInteractive: boolean = false) {
        
        // 1. Calculate Ranks (Columns)
        let changed = true; let loops = 0;
        while (changed && loops < 100) {
            changed = false;
            edges.forEach(edge => {
                const sNode = nodes.get(edge.source); const tNode = nodes.get(edge.target);
                if (sNode && tNode && sNode.rank >= tNode.rank) { tNode.rank = sNode.rank + 1; changed = true; }
            });
            loops++;
        }

        // 2. Branch Coloring Algorithm
        let cIdx = 0;
        // Assign colors to roots
        nodes.forEach(n => {
            if (n.rank === 0) { n.color = PATH_COLORS[cIdx % PATH_COLORS.length]; cIdx++; }
        });
        // Propagate colors to children
        changed = true; loops = 0;
        while(changed && loops < 100) {
            changed = false;
            edges.forEach(e => {
                const sNode = nodes.get(e.source); const tNode = nodes.get(e.target);
                if (sNode && tNode && sNode.color) {
                    e.color = sNode.color; // Edge inherits source color
                    if (!tNode.color) { tNode.color = sNode.color; changed = true; }
                }
            });
            loops++;
        }
        // Catch any disconnected uncolored nodes
        nodes.forEach(n => { if (!n.color) { n.color = PATH_COLORS[cIdx % PATH_COLORS.length]; cIdx++; }});

        const wrapper = this.createBaseWrapper(el, folderPath, titleText, isInteractive, ctx);
        const scrollArea = wrapper.querySelector('.chem-pathway-grid') as HTMLElement;
        scrollArea.style.position = "relative";
        scrollArea.style.padding = "60px 80px"; 

        if (nodes.size === 0) {
            scrollArea.createDiv({ text: "Empty canvas. Use tools above or type connections (e.g., [[EXP-01]] -> C1=CC=CC=C1).", attr: { style: "padding: 20px; color: var(--text-muted); font-style: italic;" }});
            return;
        }

        const graphContainer = scrollArea.createDiv({ attr: { style: "display: flex; flex-direction: row; gap: 80px; min-width: max-content; position: relative;" }});
        
        // SVG Canvas
        const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgOverlay.style.position = 'absolute'; svgOverlay.style.top = '0'; svgOverlay.style.left = '0';
        svgOverlay.style.width = '100%'; svgOverlay.style.height = '100%';
        svgOverlay.style.pointerEvents = 'none'; svgOverlay.style.zIndex = '0';
        
        // Generate Color-Specific Arrow Markers
        let defsHtml = '';
        PATH_COLORS.forEach(c => {
            const hex = c.replace('#', '');
            defsHtml += `<marker id="arrow-${hex}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 2 L 8 5 L 0 8 z" fill="${c}"/></marker>`;
        });
        svgOverlay.innerHTML = `<defs>${defsHtml}</defs>`;
        graphContainer.appendChild(svgOverlay);

        const columns: GraphNode[][] = [];
        nodes.forEach(n => { if (!columns[n.rank]) columns[n.rank] = []; columns[n.rank].push(n); });

        for (const col of columns) {
            if (!col) continue;
            const colDiv = graphContainer.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 40px; justify-content: center; z-index: 1;" }});
            
            for (const node of col) {
                if (node.type === 'eln') {
                    this.drawExperimentNode(colDiv, node, isInteractive, ctx, el, node.color);
                } else if (node.type === 'text') {
                    const nodeEl = colDiv.createDiv({ text: node.label, cls: "chem-exp-node", attr: { "data-id": node.id, style: `display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, ${node.color}11, var(--background-primary)); border: 1px solid var(--background-modifier-border); border-left: 4px solid ${node.color}; border-radius: 12px; padding: 15px 25px; min-width: 100px; font-weight: 600; font-size: 14px; color: var(--text-normal); text-align: center; word-break: break-word; box-shadow: 0 4px 15px rgba(0,0,0,0.05); z-index: 2; position: relative; transition: transform 0.2s;` }});
                    node.el = nodeEl;
                    if (isInteractive) this.attachMindMapInteractions(nodeEl, node, ctx, el, graphContainer, svgOverlay);
                } else {
                    this.drawChemicalNode(colDiv, node.smiles, node.label, node.rawToken || null, ctx, el, node, isInteractive, graphContainer, svgOverlay, node.color);
                }
            }
        }

        const drawLines = () => {
            svgOverlay.style.width = `${graphContainer.scrollWidth}px`;
            svgOverlay.style.height = `${graphContainer.scrollHeight}px`;
            Array.from(svgOverlay.querySelectorAll('path.chem-edge')).forEach(e => e.remove());

            const getRelativePos = (element: HTMLElement) => {
                let x = 0, y = 0; let curr: HTMLElement | null = element;
                while (curr && curr !== graphContainer) { x += curr.offsetLeft; y += curr.offsetTop; curr = curr.offsetParent as HTMLElement; }
                return { x, y, w: element.offsetWidth, h: element.offsetHeight };
            };

            edges.forEach(edge => {
                const sNode = nodes.get(edge.source); const tNode = nodes.get(edge.target);
                if (sNode?.el && tNode?.el) {
                    const sPos = getRelativePos(sNode.el); const tPos = getRelativePos(tNode.el);
                    const startX = sPos.x + sPos.w; const startY = sPos.y + (sPos.h / 2);
                    const endX = tPos.x - 8; const endY = tPos.y + (tPos.h / 2);

                    const dx = Math.max(Math.abs(endX - startX) * 0.5, 40);
                    const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('class', 'chem-edge');
                    path.setAttribute('d', pathD);
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', edge.color || 'var(--text-muted)');
                    path.setAttribute('stroke-width', '2.5'); 
                    path.setAttribute('stroke-linecap', 'round');
                    if (edge.color) path.setAttribute('marker-end', `url(#arrow-${edge.color.replace('#', '')})`);
                    svgOverlay.appendChild(path);
                }
            });
        };

        setTimeout(drawLines, 100); 
        new ResizeObserver(() => drawLines()).observe(wrapper);
        this.attachSearchLogic(wrapper);
    }

    // ========================================================================
    // MIND-MAP INTERACTIONS 
    // ========================================================================
    private attachMindMapInteractions(nodeEl: HTMLElement, node: GraphNode, ctx: any, el: HTMLElement, graphContainer: HTMLElement, svgOverlay: SVGSVGElement) {
        const toolOverlay = nodeEl.createDiv({ attr: { style: "position: absolute; right: -110px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 4px; opacity: 0; transition: opacity 0.2s; z-index: 10;" }});
        nodeEl.addEventListener('mouseenter', () => toolOverlay.style.opacity = '1');
        nodeEl.addEventListener('mouseleave', () => toolOverlay.style.opacity = '0');

        const dragHandle = toolOverlay.createDiv({ attr: { title: "Drag to connect", style: `width: 16px; height: 16px; background: ${node.color || 'var(--interactive-accent)'}; border: 3px solid var(--background-primary); border-radius: 50%; cursor: crosshair; pointer-events: auto; box-shadow: 0 2px 4px rgba(0,0,0,0.2);` }});
        
        const branchStructBtn = toolOverlay.createEl("button", { attr: { title: "Add Structure Branch", style: "width: 24px; height: 24px; padding: 0; background: var(--interactive-accent); border: none; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-on-accent); font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);" }});
        branchStructBtn.innerHTML = `⬡<span style="font-size:8px;">+</span>`;
        branchStructBtn.onclick = (e) => {
            e.stopPropagation();
            this.plugin.openKetcherModal("", "smiles", (newData: string) => {
                this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${newData}`);
            });
        };

        const branchTextBtn = toolOverlay.createEl("button", { attr: { title: "Add Text Branch", style: "width: 24px; height: 24px; padding: 0; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-normal); font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.05);" }});
        branchTextBtn.innerHTML = `T<span style="font-size:8px;">+</span>`;
        branchTextBtn.onclick = (e) => {
            e.stopPropagation();
            new TextPromptModal(this.plugin.app, "Add Text Note", "Enter text for the new branch", "", (txt) => {
                this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${txt}`);
            }).open();
        };

        // EDIT & DELETE BUTTON
        const editBtn = toolOverlay.createEl("button", { attr: { title: "Edit or Delete Node", style: "width: 24px; height: 24px; padding: 0; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-normal); font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);" }});
        editBtn.innerHTML = `✏️`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            new TextPromptModal(this.plugin.app, "Edit Node", "Change the link/text. Clear the input to delete this node.", node.rawToken || "", (newVal) => {
                this.updateMarkdownNodeText(ctx, el, node.rawToken!, newVal);
            }).open();
        };

        // Drag & Drop Logic
        let isDragging = false;
        let tempPath: SVGPathElement | null = null;

        const getRelativeMousePos = (e: MouseEvent) => {
            const rect = graphContainer.getBoundingClientRect();
            return { x: e.clientX - rect.left + graphContainer.scrollLeft, y: e.clientY - rect.top + graphContainer.scrollTop };
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const mousePos = getRelativeMousePos(e);
            let sx = 0, sy = 0; let curr: HTMLElement | null = nodeEl;
            while (curr && curr !== graphContainer) { sx += curr.offsetLeft; sy += curr.offsetTop; curr = curr.offsetParent as HTMLElement; }
            sx += nodeEl.offsetWidth; sy += nodeEl.offsetHeight / 2;

            const dx = Math.max(Math.abs(mousePos.x - sx) * 0.5, 30);
            const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${mousePos.x - dx} ${mousePos.y}, ${mousePos.x} ${mousePos.y}`;
            if (tempPath) tempPath.setAttribute('d', d);
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isDragging) return;
            isDragging = false;
            if (tempPath) { tempPath.remove(); tempPath = null; }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            toolOverlay.style.display = 'none';
            const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.chem-exp-node') as HTMLElement;
            toolOverlay.style.display = 'flex';

            if (targetEl && targetEl !== nodeEl) {
                const targetRawToken = targetEl.getAttribute('data-token') || targetEl.getAttribute('data-id');
                if (targetRawToken && node.rawToken) {
                    this.updateMarkdownBlock(ctx, el, null, `\n${node.rawToken} -> ${targetRawToken}`);
                    new Notice("Connected!");
                }
            }
        };

        dragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            isDragging = true;
            tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tempPath.setAttribute('fill', 'none'); tempPath.setAttribute('stroke', node.color || 'var(--interactive-accent)');
            tempPath.setAttribute('stroke-width', '3'); tempPath.setAttribute('stroke-dasharray', '5,5');
            tempPath.setAttribute('marker-end', `url(#arrow-${(node.color || '').replace('#', '')})`);
            svgOverlay.appendChild(tempPath);

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    private updateMarkdownBlock(ctx: any, el: HTMLElement, oldText: string | null, newText: string) {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        let info = ctx.getSectionInfo(el);
        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
        if (!info) return;

        const editor = view.editor;
        const lines = editor.getValue().split('\n');
        
        if (oldText && oldText !== newText) {
            for (let i = info.lineStart; i <= info.lineEnd; i++) {
                if (lines[i].includes(oldText)) {
                    lines[i] = lines[i].replace(oldText, newText);
                    break;
                }
            }
        } else if (!oldText) {
            lines.splice(info.lineEnd, 0, newText);
        }
        
        editor.setValue(lines.join('\n'));
    }

    private updateMarkdownNodeText(ctx: any, el: HTMLElement, oldToken: string, newToken: string) {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        let info = ctx.getSectionInfo(el);
        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
        if (!info) return;

        const editor = view.editor;
        const lines = editor.getValue().split('\n');
        
        for (let i = info.lineStart; i <= info.lineEnd; i++) {
            if (lines[i].includes(oldToken)) {
                if (newToken === "") {
                    // Safe Deletion Logic: Remove the token, and clean up dangling arrows
                    let line = lines[i].replace(oldToken, '');
                    line = line.replace(/(->|=>|-)\s*(->|=>|-)/g, '$1'); // Collapse double arrows
                    line = line.replace(/^\s*(->|=>|-)\s*/, ''); // Remove leading arrow
                    line = line.replace(/\s*(->|=>|-)\s*$/, ''); // Remove trailing arrow
                    
                    if (line.trim() === '') lines.splice(i, 1); // Delete empty lines
                    else lines[i] = line;
                } else {
                    lines[i] = lines[i].replace(oldToken, newToken);
                }
                editor.setValue(lines.join('\n'));
                break;
            }
        }
    }

    // ========================================================================
    // UI BUILDERS
    // ========================================================================
    
    private createBaseWrapper(parent: HTMLElement, folderPath: string, titleText: string, isInteractive: boolean = false, ctx?: any): HTMLElement {
        const wrapper = parent.createDiv({ cls: "chem-pathway-wrapper", attr: { style: "border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-primary); overflow: hidden; margin-top: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.02);" }});
        
        const toolbar = wrapper.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); flex-wrap: wrap; gap: 10px; z-index:10; position:relative;" }});
        toolbar.createEl("h3", { text: titleText, attr: { style: "margin: 0; font-size: 16px; font-weight: 700; color: var(--text-normal); display:flex; align-items:center; gap:8px;" }});

        const tools = toolbar.createDiv({ attr: { style: "display: flex; gap: 8px; align-items: center;" }});
        
        if (isInteractive && ctx) {
            const addSmiBtn = tools.createEl("button", { text: "⬡ Add Structure", attr: { style: "height: 28px; font-size: 11px; padding: 0 12px; border-radius: 4px; font-weight: 600;" }});
            addSmiBtn.onclick = () => {
                this.plugin.openKetcherModal("", "smiles", (newData: string) => { this.updateMarkdownBlock(ctx, wrapper, null, `\n${newData}`); });
            };

            const addTxtBtn = tools.createEl("button", { text: "📝 Add Note", attr: { style: "height: 28px; font-size: 11px; padding: 0 12px; border-radius: 4px; font-weight: 600;" }});
            addTxtBtn.onclick = () => {
                new TextPromptModal(this.plugin.app, "Add Note Node", "Enter text for the new node", "", (txt) => { this.updateMarkdownBlock(ctx, wrapper, null, `\n${txt}`); }).open();
            };

            const addElnBtn = tools.createEl("button", { text: "🧪 Add ELN", cls: "mod-cta", attr: { style: "height: 28px; font-size: 11px; padding: 0 12px; border-radius: 4px; font-weight: 600;" }});
            addElnBtn.onclick = () => {
                const activeFile = this.plugin.app.workspace.getActiveFile();
                const targetFolder = folderPath || (activeFile?.parent?.path === "/" ? "" : activeFile?.parent?.path) || "";
                
                new CreateExperimentModal(this.plugin.app, this.plugin, this.plugin.settings.elnPrefix, targetFolder, async (expCode: string) => {
                    this.updateMarkdownBlock(ctx, wrapper, null, `\n[[${expCode}]]`);
                    await this.plugin.api.eln.createExperiment(expCode, targetFolder);
                }).open();
            };
        }

        tools.createEl("input", { type: "search", cls: "chem-pathway-search", placeholder: "Search nodes...", attr: { style: "width: 140px; padding: 6px 12px; font-size: 12px; border-radius: 4px; border: 1px solid var(--background-modifier-border);" }});

        wrapper.createDiv({ cls: "chem-pathway-grid", attr: { style: "padding: 20px; overflow-x: auto; display: flex; flex-direction: row; align-items: center;" }});
        return wrapper;
    }

    private drawChemicalNode(parent: HTMLElement, smiles: string, label: string, rawToken: string | null, ctx?: any, el?: HTMLElement, nodeObj?: GraphNode, isInteractive: boolean = false, graphContainer?: HTMLElement, svgOverlay?: SVGSVGElement, color?: string) {
        const bgGrad = color ? `linear-gradient(135deg, ${color}11, var(--background-primary))` : 'var(--background-secondary)';
        const borderL = color ? `4px solid ${color}` : `1px solid var(--background-modifier-border)`;
        
        const box = parent.createDiv({ cls: "chem-exp-node", attr: { "data-search": `${label} ${smiles}`.toLowerCase(), "data-id": nodeObj?.id || smiles, "data-token": rawToken || smiles, style: `display: flex; flex-direction: column; align-items: center; background: ${bgGrad}; border: 1px solid var(--background-modifier-border); border-left: ${borderL}; border-radius: 12px; padding: 12px; width: 140px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); position: relative; transition: transform 0.2s; z-index: 2;` }});
        
        if (nodeObj) nodeObj.el = box;

        const preview = box.createDiv({ attr: { style: "width: 120px; height: 90px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border-radius: 6px; box-shadow: inset 0 0 4px rgba(0,0,0,0.02);" }});
        preview.innerHTML = `⏳`;
        box.createDiv({ text: label, attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-normal); text-align: center; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" }});

        if (rawToken && ctx && el) {
            box.style.cursor = "pointer";
            box.title = "Double-click to edit Structure/Name";
            box.onmouseover = () => { box.style.transform = "translateY(-2px)"; };
            box.onmouseout = () => { box.style.transform = "translateY(0)"; };

            box.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                this.plugin.openKetcherModal(smiles, "smiles", (newData: string) => {
                    const replacement = label !== "Structure" ? `${newData}|${label}` : newData;
                    this.updateMarkdownNodeText(ctx, el, rawToken, replacement);
                });
            });
        }

        if (isInteractive && nodeObj && graphContainer && svgOverlay) {
            this.attachMindMapInteractions(box, nodeObj, ctx, el!, graphContainer, svgOverlay);
        }

        requestAnimationFrame(async () => {
            const renderEl = await this.plugin.api.renderStructure(smiles, 120, 90);
            preview.empty();
            if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; preview.appendChild(renderEl); } else preview.innerHTML = `❌`;
        });
    }

    private drawExperimentNode(parent: HTMLElement, node: GraphNode, isInteractive: boolean = false, ctx?: any, el?: HTMLElement, color?: string) {
        const yieldNum = parseFloat(node.data?.products?.[0]?.yield);
        const yieldStr = isNaN(yieldNum) ? 'N/A' : `${yieldNum}%`;
        const badgeColor = yieldNum >= 80 ? 'var(--text-success)' : yieldNum <= 30 ? 'var(--text-error)' : 'var(--text-warning)';

        const bgGrad = color ? `linear-gradient(135deg, ${color}11, var(--background-primary))` : 'var(--background-primary)';
        const borderL = color ? `4px solid ${color}` : `1px solid var(--background-modifier-border)`;

        const nodeEl = parent.createDiv({ cls: "chem-exp-node", attr: { "data-search": `${node.label} ${node.smiles} ${node.data?.project || ''}`.toLowerCase(), "data-id": node.id, "data-token": node.rawToken, style: `display: flex; flex-direction: column; align-items: center; background: ${bgGrad}; border: 1px solid var(--background-modifier-border); border-left: ${borderL}; border-radius: 12px; padding: 12px; width: 140px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); position: relative; transition: transform 0.2s; z-index: 2;` }});
        node.el = nodeEl;

        const header = nodeEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; width: 100%; margin-bottom: 8px; align-items: center;" }});
        header.createDiv({ text: node.label, attr: { style: `font-size: 11px; font-weight: 700; color: ${color || 'var(--text-accent)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` }});
        header.createDiv({ text: yieldStr, attr: { style: `font-size: 10px; font-weight: 800; color: ${badgeColor}; background: var(--background-secondary-alt); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border);` }});
        
        this.attachHoverActions(nodeEl, node.id, node.label, node.data);

        if (isInteractive && ctx && el) {
            const graphContainer = el.querySelector('.chem-pathway-grid') as HTMLElement;
            const svgOverlay = el.querySelector('svg') as SVGSVGElement;
            if (graphContainer && svgOverlay) this.attachMindMapInteractions(nodeEl, node, ctx, el, graphContainer, svgOverlay);
        }

        const preview = nodeEl.createDiv({ attr: { style: "width: 120px; height: 90px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border-radius: 6px; box-shadow: inset 0 0 4px rgba(0,0,0,0.02);" }});
        preview.innerHTML = `⏳`;

        if (node.data?.project) {
            nodeEl.createDiv({ text: node.data.project, attr: { style: "font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin-top: 6px; letter-spacing: 0.5px; width: 100%; text-align: center;" }});
        }

        requestAnimationFrame(async () => {
            const renderEl = await this.plugin.api.renderStructure(node.smiles, 120, 90);
            preview.empty();
            if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; preview.appendChild(renderEl); } else preview.innerHTML = `❌`;
        });
    }

    private attachHoverActions(nodeEl: HTMLElement, filePath: string, code: string, data: any) {
        const overlay = nodeEl.createDiv({ attr: { style: "position: absolute; inset: 0; background: rgba(0,0,0,0.7); border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; opacity: 0; transition: opacity 0.2s; backdrop-filter: blur(2px); z-index: 5;" }});
        nodeEl.addEventListener('mouseenter', () => { overlay.style.opacity = "1"; nodeEl.style.transform = "translateY(-2px)"; });
        nodeEl.addEventListener('mouseleave', () => { overlay.style.opacity = "0"; nodeEl.style.transform = "translateY(0)"; });
        
        const openBtn = overlay.createEl("button", { text: "👁️", attr: { title: "Open Note", style: "padding: 5px; background: transparent; border: none; cursor: pointer; font-size: 16px;" }});
        openBtn.onclick = () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) this.plugin.app.workspace.getLeaf(false).openFile(file);
        };
        
        const cloneBtn = overlay.createEl("button", { text: "🗐", attr: { title: "Clone Exp", style: "padding: 5px; background: transparent; border: none; cursor: pointer; font-size: 16px;" }});
        cloneBtn.onclick = () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) new CloneExperimentModal(this.plugin.app, this.plugin, code, file, data).open();
        };
    }

    private attachSearchLogic(wrapper: HTMLElement) {
        const searchInput = wrapper.querySelector('.chem-pathway-search') as HTMLInputElement;
        const nodes = wrapper.querySelectorAll('.chem-exp-node');
        
        searchInput.addEventListener('input', (e: any) => {
            const query = e.target.value.toLowerCase();
            nodes.forEach((node: any) => {
                const text = node.getAttribute('data-search') || "";
                if (text.includes(query)) {
                    node.style.opacity = "1";
                    node.style.filter = "none";
                } else {
                    node.style.opacity = "0.3";
                    node.style.filter = "grayscale(100%)";
                }
            });
        });
    }

    private async fetchChemicalData(file: TFile): Promise<{type: 'eln'|'smiles', smiles: string, data?: any} | null> {
        const content = await this.plugin.app.vault.cachedRead(file);
        
        const elnMatch = content.match(/```eln\s*\n([\s\S]*?)\n```/);
        if (elnMatch) {
            try {
                const { parseYaml } = require('obsidian');
                const safeSource = elnMatch[1].replace(/smiles:\s*(.*)$/gm, (m, p1) => {
                    let s = p1.trim(); if (!s) return m;
                    const cMatch = s.match(/(\s+#.*)$/); if (cMatch) s = s.substring(0, s.length - cMatch[1].length).trim();
                    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                    return `smiles: '${s.replace(/\\"/g, '"').replace(/'/g, "''")}'`;
                });
                const data = parseYaml(safeSource);
                const smiles = data.products?.[0]?.smiles || data.reactants?.[0]?.smiles;
                if (smiles) return { type: 'eln', smiles, data };
            } catch(e) {}
        }

        const smiMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
        if (smiMatch && smiMatch[1].trim()) return { type: 'smiles', smiles: smiMatch[1].trim() };

        const cache = this.plugin.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.smiles) return { type: 'smiles', smiles: cache.frontmatter.smiles };

        return null;
    }
}

class TextPromptModal extends Modal {
    title: string; desc: string; initialVal: string; onSubmit: (val: string) => void;
    constructor(app: App, title: string, desc: string, initialVal: string, onSubmit: (val: string) => void) {
        super(app); this.title = title; this.desc = desc; this.initialVal = initialVal; this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.title });
        contentEl.createEl('p', { text: this.desc, cls: 'color-text-muted', attr: {style: "font-size:12px; margin-bottom:10px;"}});
        const inp = contentEl.createEl('input', { type: 'text', value: this.initialVal, attr: { style: 'width:100%; margin-bottom:15px;' }});
        inp.onkeydown = (e) => { if (e.key === 'Enter') { this.onSubmit(inp.value.trim()); this.close(); } };
        const btn = contentEl.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { style: 'float:right;' }});
        btn.onclick = () => { this.onSubmit(inp.value.trim()); this.close(); };
        setTimeout(() => { inp.focus(); inp.select(); }, 50);
    }
    onClose() { this.contentEl.empty(); }
}
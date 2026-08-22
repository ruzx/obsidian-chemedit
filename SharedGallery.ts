import { App, TFile, Notice } from 'obsidian';

export class SharedGalleryRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderGalleryBlock(source: string, el: HTMLElement, ctx: any) {
        // Parse the folder path
        const match = source.match(/path:\s*['"]?(.*?)['"]?(?:\n|$)/);
        const folderPath = match ? match[1].trim() : "";

        if (!folderPath) {
            el.createEl("div", { text: "⚠️ Please specify a folder path (e.g., path: Molecules/)", cls: "color-text-error" });
            return;
        }

        const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) {
            el.createEl("div", { text: `⚠️ Folder not found: ${folderPath}`, cls: "color-text-error" });
            return;
        }

        const validExts = ['mol', 'cdxml', 'sdf', 'rxn', 'ket', 'smi', 'smiles', 'md'];
        const files = folder.children.filter((f: any) => f instanceof TFile && validExts.includes(f.extension.toLowerCase()));

        if (files.length === 0) {
            el.createEl("div", { text: "No supported files found in this folder.", cls: "color-text-muted" });
            return;
        }

        // --- HEADER & SEARCH BAR ---
        const header = el.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;" } });
        const countLabel = header.createDiv({ text: `Loading...`, attr: { style: "font-size: 13px; color: var(--text-muted); font-weight: 500;" } });
        
        const searchInput = header.createEl("input", { 
            type: "search", 
            placeholder: "Search name or SMILES...", 
            attr: { style: "width: 250px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary);" } 
        });

        // --- GRID CONTAINER ---
        const container = el.createDiv({ cls: "chem-gallery-container" });
        container.style.display = "grid";
        container.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
        container.style.gap = "15px";
        container.style.padding = "5px 0";

        const cards: { el: HTMLElement, text: string }[] = [];
        let renderCount = 0;

        for (const file of files) {
            let dataToRender = "";
            let renderFormat = file.extension.toLowerCase();
            let searchableText = file.name.toLowerCase();

            // Handle MD files (extract first SMILES)
            if (renderFormat === 'md') {
                const content = await this.plugin.app.vault.cachedRead(file);
                
                // Match ```smiles block
                const blockMatch = content.match(/```smiles\s*\n([\s\S]*?)\n```/);
                
                // Match inline $smiles=
                const prefix = this.plugin.settings.inlineSmilesPrefix || '$smiles=';
                const escapedPrefix = prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const inlineRegex = new RegExp(`${escapedPrefix}([^\\s]+)`);
                const inlineMatch = content.match(inlineRegex);

                if (blockMatch) {
                    dataToRender = blockMatch[1].trim();
                } else if (inlineMatch) {
                    dataToRender = inlineMatch[1].trim();
                } else {
                    continue; // Skip MD files that have no SMILES strings inside them
                }
                renderFormat = 'smiles';
                searchableText += " " + dataToRender.toLowerCase(); // Allow searching by the SMILES string itself
            } else {
                dataToRender = await this.plugin.app.vault.read(file);
                if (renderFormat === 'smi') renderFormat = 'smiles';
                if (renderFormat === 'smiles') searchableText += " " + dataToRender.toLowerCase();
            }

            renderCount++;

            // --- CREATE CARD ---
            const card = container.createDiv({ cls: "chem-gallery-card" });
            card.style.border = "1px solid var(--background-modifier-border)";
            card.style.borderRadius = "8px";
            card.style.padding = "10px";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.alignItems = "center";
            card.style.backgroundColor = "var(--background-primary)";
            card.style.cursor = "pointer";
            card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.05)";
            card.style.transition = "border-color 0.2s ease";
            
            card.onmouseover = () => card.style.borderColor = "var(--interactive-accent)";
            card.onmouseout = () => card.style.borderColor = "var(--background-modifier-border)";

            // Image wrapper
            const previewWrapper = card.createDiv();
            previewWrapper.style.width = "100%";
            previewWrapper.style.height = "100px";
            previewWrapper.style.display = "flex";
            previewWrapper.style.justifyContent = "center";
            previewWrapper.style.alignItems = "center";
            previewWrapper.innerHTML = `<span class="color-text-muted" style="font-size:12px;">⏳ Loading...</span>`;

            // Label
            const label = card.createDiv();
            label.textContent = file.name;
            label.style.fontSize = "12px";
            label.style.marginTop = "10px";
            label.style.textAlign = "center";
            label.style.wordBreak = "break-word";
            label.style.color = "var(--text-normal)";
            label.style.fontWeight = "500";
            
            if (file.extension.toLowerCase() === 'md') {
                label.style.color = "var(--text-accent)"; // Highlight MD files slightly
            }

            cards.push({ el: card, text: searchableText });

            // --- CLICK BEHAVIOR ---
            card.onclick = async () => {
                if (file.extension.toLowerCase() === 'md') {
                    // Open the markdown note in Obsidian
                    this.plugin.app.workspace.getLeaf(false).openFile(file);
                } else {
                    // Open Ketcher editor for pure chemical files
                    const freshData = await this.plugin.app.vault.read(file);
                    this.plugin.openKetcherForFile(file, freshData, renderFormat, previewWrapper);
                }
            };

            // --- RENDER IMAGE ---
            requestAnimationFrame(async () => {
                const originalW = this.plugin.settings.width; 
                const originalH = this.plugin.settings.height;
                this.plugin.settings.width = 120; 
                this.plugin.settings.height = 100; // force tiny render
                
                try {
                    const previewEl = await this.plugin.renderMoleculeToPreview(dataToRender, renderFormat, false);
                    previewWrapper.empty();
                    if (previewEl) {
                        previewEl.style.maxWidth = '100%';
                        previewEl.style.maxHeight = '100%';
                        previewWrapper.appendChild(previewEl);
                    } else {
                        previewWrapper.innerHTML = `❌ Error`;
                    }
                } catch(e) {
                    previewWrapper.innerHTML = `❌ Error`;
                } finally {
                    this.plugin.settings.width = originalW;
                    this.plugin.settings.height = originalH;
                }
            });
        }

        countLabel.textContent = `${renderCount} molecules`;

        // --- REAL-TIME SEARCH LOGIC ---
        searchInput.addEventListener("input", (e: any) => {
            const query = e.target.value.toLowerCase();
            let visibleCount = 0;
            cards.forEach(c => {
                if (c.text.includes(query)) {
                    c.el.style.display = "flex";
                    visibleCount++;
                } else {
                    c.el.style.display = "none";
                }
            });
            countLabel.textContent = `${visibleCount} / ${renderCount} molecules`;
        });
    }
}
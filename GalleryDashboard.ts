// GalleryDashboard.ts
import { ItemView, WorkspaceLeaf, TFile, debounce } from 'obsidian';
import type ChemEditPlugin from './main';
import { renderLimsNav } from './SharedBase';

export const GALLERY_DASHBOARD_VIEW_TYPE = "chem-gallery-dashboard";

interface GalleryEntry {
    file: TFile;
    ext: string;
    data: string;
    name: string;
    searchText: string;
    cardEl?: HTMLElement;
}

export class GalleryDashboardView extends ItemView {
    plugin: ChemEditPlugin;
    gridContainer: HTMLElement;
    searchQuery: string = '';
    private observer: IntersectionObserver;
    allFiles: GalleryEntry[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: ChemEditPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Lazy-loader for structures: Only read/render files when they scroll into view!
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(async entry => {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    
                    if (!el.dataset.rendered && el.dataset.index) {
                        el.dataset.rendered = "true";
                        
                        const idx = parseInt(el.dataset.index, 10);
                        const item = this.allFiles[idx];
                        if (!item) return;

                        let dataToRender = item.data;

                        // ULTRA-EFFICIENCY: We only read heavy chemical files (.mol, .cdxml) 
                        // from the hard drive when they actually scroll onto the screen!
                        if (!dataToRender && item.file.extension.toLowerCase() !== 'md') {
                            dataToRender = await this.plugin.app.vault.read(item.file);
                            item.data = dataToRender; // cache it so we don't read it again
                        }

                        if (dataToRender) {
                            this.plugin.api.renderStructure(dataToRender, 160, 120).then(renderEl => {
                                el.empty();
                                if (renderEl) { 
                                    renderEl.style.maxWidth = '100%'; 
                                    renderEl.style.maxHeight = '100%'; 
                                    el.appendChild(renderEl); 
                                } else {
                                    el.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">Error</span>`;
                                }
                            });
                        } else {
                            el.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">Empty</span>`;
                        }
                    }
                }
            });
        }, { root: null, rootMargin: "200px", threshold: 0.1 });
    }

    getViewType() { return GALLERY_DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return "Drawings Gallery"; }
    getIcon() { return "image"; }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chem-gallery-dashboard-view');
        Object.assign(container.style, { display: "flex", flexDirection: "column", padding: "0", background: "var(--background-primary)" });

        // --- HEADER ---
        const header = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 30px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border);" }});
        const titleArea = header.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});

        // --- UNIVERSAL NAV SWITCHER ---
        renderLimsNav(titleArea, "gallery", this.plugin);

        titleArea.createEl("h2", { text: "Drawings Gallery", attr: { style: "margin: 0; font-size: 22px; font-weight: 700; color: var(--text-normal);" }});
        titleArea.createEl("span", { text: "Visual overview of all chemical structures across your vault", attr: { style: "font-size: 13px; color: var(--text-muted); margin-top: 4px;" }});

        // --- TOOLBAR ---
        const toolbarEl = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px 30px; background: var(--background-primary); border-bottom: 1px solid var(--background-modifier-border);" }});
        
        const leftTools = toolbarEl.createDiv({ attr: { style: "display: flex; gap: 15px; align-items: center;" }});
        
        // Quick Folder Setting
        const dirWrap = leftTools.createDiv({ attr: { style: "display: flex; align-items: center; gap: 6px;" }});
        dirWrap.createEl("span", { text: "📁 Folder:", attr: { style: "font-size: 11px; font-weight: 600; color: var(--text-muted);" }});
        const dirInp = dirWrap.createEl("input", { type: "text", value: window.localStorage.getItem('chem-gallery-dir') || "", attr: { placeholder: "Leave empty for entire vault", style: "width: 180px; font-size: 12px; padding: 4px 8px; border-radius: 4px; height: 26px; border: 1px solid var(--background-modifier-border);" }});
        dirInp.onchange = (e: any) => {
            window.localStorage.setItem('chem-gallery-dir', e.target.value.trim());
            this.loadDrawings();
        };

        const searchInp = toolbarEl.createEl("input", { type: "search", placeholder: "Search file names...", attr: { style: "width: 280px; font-size: 13px; border-radius: 6px;" }});
        searchInp.oninput = (e: any) => { 
            this.searchQuery = e.target.value.toLowerCase(); 
            this.applyFilters(); // FAST CSS FILTER
        };

        // --- GRID CONTAINER ---
        this.gridContainer = container.createDiv({ attr: { style: "flex-grow: 1; overflow: auto; padding: 20px 30px; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px; align-content: start;" }});

        await this.loadDrawings();
        
        // BATTERY-EFFICIENT AUTO-REFRESH
        const requestRefresh = debounce(() => this.loadDrawings(), 2000, true);
        this.registerEvent(this.app.vault.on('modify', requestRefresh));
        this.registerEvent(this.app.vault.on('create', requestRefresh));
        this.registerEvent(this.app.vault.on('delete', requestRefresh));
    }

    private async loadDrawings() {
        const targetDir = window.localStorage.getItem('chem-gallery-dir') || "";
        const files = this.app.vault.getFiles();
        const validExts = ['mol', 'cdxml', 'sdf', 'rxn', 'ket'];
        const entries: GalleryEntry[] = [];

        for (const file of files) {
            // 1. Instantly filter out irrelevant folders using string checking (zero battery cost)
            if (targetDir && !file.path.startsWith(targetDir)) continue;

            const ext = file.extension.toLowerCase();
            
            if (validExts.includes(ext)) {
                // DO NOT READ DISK YET! Leave data empty. Lazy loader will handle it.
                entries.push({ file, ext, data: "", name: file.basename, searchText: file.basename.toLowerCase() });
            } 
            else if (ext === 'md') {
                // 2. RAM CACHE PRE-FILTER: Check Obsidian's metadata cache to see if the note even has a codeblock
                const cache = this.app.metadataCache.getFileCache(file);
                const hasCodeBlock = cache?.sections?.some(s => s.type === 'code');
                
                if (hasCodeBlock) {
                    const content = await this.app.vault.cachedRead(file);
                    // Match the first smiles or mol block to use as the thumbnail
                    const blockMatch = content.match(/```(smiles|mol)\s*\n([\s\S]*?)\n```/);
                    if (blockMatch && blockMatch[2].trim()) {
                        entries.push({ 
                            file, 
                            ext: blockMatch[1], 
                            data: blockMatch[2].trim(), 
                            name: file.basename, 
                            searchText: file.basename.toLowerCase() 
                        });
                    }
                }
            }
        }
        
        this.allFiles = entries.sort((a, b) => a.name.localeCompare(b.name));
        
        // Build DOM exactly once
        this.buildGridDOM();
        
        // Apply instant CSS filters
        this.applyFilters();
    }

    private buildGridDOM() {
        // DocumentFragment builds the grid offline, preventing screen blinking
        const fragment = document.createDocumentFragment();
        this.observer.disconnect();

        if (this.allFiles.length === 0) {
            const emptyDiv = document.createElement("div");
            emptyDiv.style.gridColumn = "1/-1";
            emptyDiv.style.textAlign = "center";
            emptyDiv.style.padding = "40px";
            emptyDiv.style.color = "var(--text-muted)";
            emptyDiv.style.fontStyle = "italic";
            emptyDiv.innerText = "No drawings found in the specified directory.";
            fragment.appendChild(emptyDiv);
        } else {
            this.allFiles.forEach((item, index) => {
                const card = document.createElement("div");
                Object.assign(card.style, { background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s" });
                
                card.onmouseover = () => { card.style.transform = "translateY(-4px)"; card.style.boxShadow = "0 6px 12px rgba(0,0,0,0.1)"; card.style.borderColor = "var(--interactive-accent)"; };
                card.onmouseout = () => { card.style.transform = "translateY(0)"; card.style.boxShadow = "none"; card.style.borderColor = "var(--background-modifier-border)"; };
                card.onclick = () => this.app.workspace.getLeaf(false).openFile(item.file);
                
                item.cardEl = card; // Save reference for CSS filtering

                // Pass the array index to the observer so it knows which file to lazily load
                const preview = card.createDiv({ attr: { 'data-index': index.toString(), style: "width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; background: var(--background-primary); border-radius: 4px; margin-bottom: 10px;" }});
                preview.innerHTML = `<span style="color:var(--text-muted); font-size: 11px;">⏳</span>`;
                this.observer.observe(preview);

                card.createDiv({ text: item.name, attr: { style: "font-size: 12px; font-weight: 600; color: var(--text-normal); text-align: center; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" }});
                card.createDiv({ text: item.ext.toUpperCase(), attr: { style: "font-size: 9px; color: var(--text-muted); margin-top: 4px; background: var(--background-primary); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--background-modifier-border);" }});

                fragment.appendChild(card);
            });
        }

        // Swap the entire grid at once
        this.gridContainer.empty();
        this.gridContainer.appendChild(fragment);
    }

    // CPU-Free Filtering: Toggles display:none directly on the DOM cards
    private applyFilters() {
        this.allFiles.forEach(e => {
            if (!e.cardEl) return;
            const matchSearch = !this.searchQuery || e.searchText.includes(this.searchQuery);
            e.cardEl.style.display = matchSearch ? "flex" : "none"; // Hide card instantly
        });
    }

    async onClose() { 
        this.observer.disconnect(); 
    }
}
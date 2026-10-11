// LivePreview.ts
import { RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, WidgetType, Decoration, DecorationSet } from "@codemirror/view";
import { TFile } from 'obsidian';
import type ChemEditPlugin from './main';
import { extractDataFromSvg } from './ChemUtils';

class ChemInlineWidget extends WidgetType {
    constructor(public data: string, public type: 'smiles'|'file', public plugin: ChemEditPlugin) { super(); }
    
    eq(other: ChemInlineWidget) { return this.data === other.data && this.type === other.type; }
    
    toDOM() {
        const wrapper = document.createElement("span"); 
        wrapper.className = "chem-inline-widget"; 
        wrapper.style.display = "inline-block"; 
        wrapper.style.verticalAlign = "middle"; 
        wrapper.style.cursor = "pointer"; 
        wrapper.style.margin = "0 4px"; 
        wrapper.innerHTML = `⏳`;
        
        requestAnimationFrame(async () => {
            if (this.type === 'smiles') { 
                const el = await this.plugin.renderMoleculeToPreview(this.data, 'smiles', true); 
                wrapper.empty(); 
                if (el) wrapper.appendChild(el); else wrapper.innerHTML = '❌'; 
            } else {
                const cleanName = this.data.replace('[[', '').replace(']]', ''); 
                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, "");
                if (file && file instanceof TFile) {
                    const format = file.extension.toLowerCase(); 
                    const fileData = await this.plugin.app.vault.read(file);
                    if (format === 'svg') { 
                        const extracted = extractDataFromSvg(fileData); 
                        if (extracted) { 
                            wrapper.empty(); 
                            const svgContainer = document.createElement("span"); 
                            svgContainer.innerHTML = this.plugin.namespaceSvgIds(fileData); 
                            const svgNode = svgContainer.querySelector('svg'); 
                            if (svgNode) {  
                                svgNode.style.width = `${this.plugin.settings.inlineWidth}px`;  
                                svgNode.style.height = `${this.plugin.settings.inlineHeight}px`;  
                            } 
                            wrapper.appendChild(svgContainer); 
                            return; 
                        } else { 
                            wrapper.innerHTML = '❌'; return; 
                        } 
                    }
                    const el = await this.plugin.renderMoleculeToPreview(fileData, format, true); 
                    wrapper.empty(); 
                    if (el) wrapper.appendChild(el); else wrapper.innerHTML = '❌';
                } else { 
                    wrapper.innerHTML = '❌'; 
                }
            }
        });
        return wrapper;
    }
}

export function buildLivePreviewPlugin(plugin: ChemEditPlugin) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.buildDecorations(view); this.processEmbeds(view); }
        update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged || update.selectionSet) { this.decorations = this.buildDecorations(update.view); setTimeout(() => this.processEmbeds(update.view), 50); } }
        
        buildDecorations(view: EditorView) {
            const builder = new RangeSetBuilder<Decoration>(); 
            const prefixSmiles = plugin.settings.inlineSmilesPrefix; 
            const prefixMol = plugin.settings.inlineMolPrefix;
            
            if (!prefixSmiles && !prefixMol) return builder.finish();
            
            for (let {from, to} of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to); 
                let match; 
                const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                const regexSrc = []; 
                if (prefixSmiles) regexSrc.push(`(?:${escapeRegex(prefixSmiles)}[^\\s]+)`); 
                if (prefixMol) regexSrc.push(`(?:${escapeRegex(prefixMol)}[^\\s]+)`); 
                const regex = new RegExp(regexSrc.join('|'), 'g');
                
                while ((match = regex.exec(text)) !== null) {
                    const start = from + match.index; const end = start + match[0].length; 
                    const hasCursorInside = view.state.selection.ranges.some(r => r.from >= start && r.to <= end); 
                    if (hasCursorInside) continue;
                    
                    const isSmiles = prefixSmiles && match[0].startsWith(prefixSmiles); 
                    const prefixLen = isSmiles ? prefixSmiles.length : prefixMol.length; 
                    const data = match[0].substring(prefixLen);
                    
                    builder.add(start, end, Decoration.replace({ widget: new ChemInlineWidget(data, isSmiles ? 'smiles' : 'file', plugin) }));
                }
            }
            return builder.finish();
        }
        
        processEmbeds(view: EditorView) {
            const embeds = view.dom.querySelectorAll('.internal-embed'); 
            const activeExts = plugin.getSupportedExts();
            embeds.forEach(embed => {
                const src = embed.getAttribute('src'); if (!src) return; 
                const lowerSrc = src.toLowerCase(); 
                const hasExt = activeExts.some(ext => lowerSrc.endsWith(`.${ext}`));
                if (hasExt) { 
                    if (embed.hasAttribute('data-chem-preview-done')) return; 
                    embed.setAttribute('data-chem-preview-done', 'true'); 
                    plugin.injectNativeEmbed(embed as HTMLElement, src, ""); 
                }
            });
        }
    }, { decorations: v => v.decorations });
}
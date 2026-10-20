// PolymerEln.ts
import { App, MarkdownView, Notice, TFile, Menu, Modal } from 'obsidian';
import { calculateMwOffline, getCompoundLibrary, CompoundSuggestModal } from './SharedEln';
import { takeStandardPhoto, saveMediaFile } from './SharedMedia';

export class PolymerCalculator {
    static calculate(data: any) {
        if (!data.monomers) data.monomers = [];
        if (!data.initiators) data.initiators = [];
        if (!data.agents) data.agents = [];
        if (!data.components) data.components = []; 
        if (!data.characterization) data.characterization = {};

        // ==========================================
        // MODE 1: FORMULATION / RESIN MODE (PHR-BASED)
        // ==========================================
        if (data.type === 'formulation') {
            let totalPhr = 0;
            data.components.forEach((c: any) => {
                c.phr = c.phr || 0;
                totalPhr += c.phr;
            });

            const targetMassMg = data.target_mass_mg || (data.target_mass_g ? data.target_mass_g * 1000 : 100000); // Default 100g

            data.components.forEach((c: any) => {
                c.wt_frac = totalPhr > 0 ? c.phr / totalPhr : 0;
                c.mass_mg = targetMassMg * c.wt_frac;
                c.mass_g = c.mass_mg / 1000;
                if (c.density) c.volume_ml = c.mass_g / c.density;
            });

            data.total_mass_g = targetMassMg / 1000;
            return data;
        }

        // ==========================================
        // MODE 2: POLYMERIZATION (RATIO/DP-BASED)
        // ==========================================
        let totalMonomerEq = 0;
        let baseMonomerMw = 0;
        
        data.monomers.forEach((m: any) => {
            m.eq = m.eq || m.mol_ratio || 1;
            totalMonomerEq += m.eq;
            if (m.eq === 1 && m.mw) baseMonomerMw = m.mw;
        });
        if (baseMonomerMw === 0 && data.monomers[0]?.mw) baseMonomerMw = data.monomers[0].mw;

        const targetDp = data.target_dp || 100;
        const targetMassMg = data.target_mass_mg || (data.target_mass_g ? data.target_mass_g * 1000 : null);
        
        let totalMonomerMassWeight = 0;
        if (totalMonomerEq > 0) {
            data.monomers.forEach((m: any) => { totalMonomerMassWeight += (m.eq / totalMonomerEq) * (m.mw || 0); });
        }
        
        data.initiators.forEach((i: any) => {
            if (i.ratio_to_monomer) i.eq = totalMonomerEq * i.ratio_to_monomer;
            else if (!i.eq) i.eq = totalMonomerEq / targetDp;
        });
        
        data.agents.forEach((a: any) => {
            if (a.ratio_to_monomer) a.eq = totalMonomerEq * a.ratio_to_monomer;
            else if (!a.eq) a.eq = totalMonomerEq / targetDp;
        });

        const activeChainEq = data.agents.length > 0 ? data.agents[0].eq : (data.initiators.length > 0 ? data.initiators[0].eq : 1);
        const theoryDp = activeChainEq > 0 ? totalMonomerEq / activeChainEq : 0;
        data.theoretical_mn = (theoryDp * totalMonomerMassWeight) + (data.agents[0]?.mw || data.initiators[0]?.mw || 0);

        if (targetMassMg) {
            let totalRelativeMass = 0;
            data.monomers.forEach((m:any) => totalRelativeMass += m.eq * (m.mw || 0));
            data.initiators.forEach((i:any) => totalRelativeMass += i.eq * (i.mw || 0));
            data.agents.forEach((a:any) => totalRelativeMass += a.eq * (a.mw || 0));

            const scaleFactor = totalRelativeMass > 0 ? targetMassMg / totalRelativeMass : 0;

            const applyScale = (arr: any[]) => {
                arr.forEach(item => {
                    item.mmol = item.eq * scaleFactor;
                    item.mass_mg = item.mmol * (item.mw || 0);
                    item.mass_g = item.mass_mg / 1000;
                    if (item.density) item.volume_ml = item.mass_g / item.density;
                });
            };

            applyScale(data.monomers);
            applyScale(data.initiators);
            applyScale(data.agents);
        }

        return data;
    }
}

export class PolymerElnRenderer {
    plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async renderPolymerBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        wrapper.style.position = "relative"; 
        wrapper.style.border = "1px solid var(--interactive-accent)";
        wrapper.style.padding = "45px 15px 15px 15px"; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary-alt)";
        wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.innerHTML = `<h3 class="color-text-muted" style="text-align:center;">⏳ Calculating Macromolecules...</h3>`;

        try {
            const safeSource = source.replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                let s = p1.trim();
                if (!s) return match;
                let comment = "";
                const commentMatch = s.match(/(\s+#.*)$/);
                if (commentMatch) { comment = commentMatch[1]; s = s.substring(0, s.length - comment.length).trim(); }
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                s = s.replace(/\\"/g, '"'); s = s.replace(/'/g, "''"); 
                return `smiles: '${s}'${comment}`;
            });
            
            let data = parseYaml(safeSource);
            if (!data) throw new Error("Empty YAML Data.");

            const fetchMws = async (arr: any[]) => {
                if(!arr) return;
                for (const item of arr) {
                    if (item.smiles && (!item.mw || item.mw <= 0)) {
                        const p = await calculateMwOffline(item.smiles, this.plugin);
                        if (p && p.mw > 0) item.mw = p.mw;
                    }
                }
            };

            await fetchMws(data.monomers); await fetchMws(data.initiators); await fetchMws(data.agents); await fetchMws(data.components);
            data = PolymerCalculator.calculate(data);

            const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            const currentFile = view ? view.file : null;
            const expCode = data.code || (currentFile ? currentFile.basename : "POLY");

            wrapper.innerHTML = '';

            // --- INLINE EDITING LISTENER ---
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('eln-editable')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('eln-editable') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const type = target.getAttribute('data-type');
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const key = target.getAttribute('data-key');
                    const inputType = target.getAttribute('data-input-type') || 'number';
                    if (!key) return;

                    const originalHTML = target.innerHTML;
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.innerHTML = ''; target.style.padding = "4px"; 
                    
                    const input = document.createElement('input');
                    input.type = inputType === 'text' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: "1px solid var(--interactive-accent)", borderRadius: "4px", background: "var(--background-primary)" });
                    
                    target.appendChild(input); input.focus();

                    const finishEdit = () => {
                        const newValStr = input.value.trim().replace(/,/g, '.'); 
                        let info = ctx.getSectionInfo(el);
                        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                        
                        if (view && info) {
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                let yamlObj = parseYaml(blockText);
                                let valToSave: any = newValStr;
                                if (inputType === 'number') { const num = parseFloat(newValStr); valToSave = isNaN(num) ? undefined : num; } 
                                else { valToSave = newValStr === '' ? undefined : newValStr; }

                                if (type === 'root') {
                                    if (valToSave === undefined) delete yamlObj[key]; else yamlObj[key] = valToSave;
                                } else if (type === 'characterization') {
                                    if (!yamlObj.characterization) yamlObj.characterization = {};
                                    if (valToSave === undefined) delete yamlObj.characterization[key]; else yamlObj.characterization[key] = valToSave;
                                } else {
                                    if (!yamlObj[type!]) yamlObj[type!] = [];
                                    if (!yamlObj[type!][idx]) yamlObj[type!] = {};
                                    if (valToSave === undefined) { delete yamlObj[type!][idx][key]; } 
                                    else { yamlObj[type!][idx][key] = valToSave; }
                                }
                                
                                yamlObj = PolymerCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { target.innerHTML = originalHTML; target.style.padding = "10px"; }
                        } else { target.innerHTML = originalHTML; target.style.padding = "10px"; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; target.style.padding = "10px"; } };
                }
            });

            // --- ACTION BAR ---
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { position: "absolute", top: "8px", right: "10px", display: "flex", gap: "5px", zIndex: "10", flexWrap: "wrap", justifyContent: "flex-end" });

            const createBtn = (text: string, title: string, onClick: (e?: MouseEvent) => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.title = title; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 8px";
                btn.style.backgroundColor = "var(--background-secondary)"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-normal)"; btn.style.borderRadius = "4px";
                btn.onmouseover = () => btn.style.backgroundColor = "var(--background-modifier-hover)";
                btn.onmouseout = () => btn.style.backgroundColor = "var(--background-secondary)";
                btn.onclick = onClick; return btn;
            };

            const updateYamlState = (mutate: (y: any) => void) => {
                if (!view) return;
                let info = ctx.getSectionInfo(el);
                if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                if (!info) return;
                const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                try {
                    const yamlObj = parseYaml(blockText);
                    mutate(yamlObj);
                    const newYaml = stringifyYaml(yamlObj);
                    view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                } catch (err) {}
            };

            createBtn("⚙️ Status", "Change Experiment Status", (e?: MouseEvent) => {
                if (!e) return;
                const menu = new Menu();
                menu.addItem((item) => item.setTitle("Mark as Planned").setIcon("calendar").onClick(() => updateYamlState(y => y.status = "Planned")));
                menu.addItem((item) => item.setTitle("Mark as Running").setIcon("play").onClick(() => updateYamlState(y => y.status = "Running")));
                menu.addItem((item) => item.setTitle("Mark as Completed").setIcon("check").onClick(() => updateYamlState(y => y.status = "Completed")));
                menu.addItem((item) => item.setTitle("Mark as Failed").setIcon("cross").onClick(() => updateYamlState(y => y.status = "Failed")));
                menu.showAtMouseEvent(e);
            });

            createBtn("📝 Edit", "Open Visual Polymer Editor", () => {
                if (!view) return;
                let info = ctx.getSectionInfo(el);
                if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                if (info) {
                    new PolymerMetaEditorModal(this.plugin.app, this.plugin, data, async (updatedYamlObj) => {
                        const newYaml = stringifyYaml(updatedYamlObj);
                        view.editor.replaceRange(`\`\`\`polymer-eln\n${newYaml}\`\`\``, {line: info.lineStart, ch: 0}, {line: info.lineEnd, ch: view.editor.getLine(info.lineEnd).length});
                    }).open();
                }
            });

            // --- HTML RENDERING ---
            const thColor = "var(--background-secondary)"; 
            const bdColor = "var(--background-modifier-border-hover)";
            const textColor = "var(--text-normal)";

            let statusColor = "var(--text-muted)";
            if (data.status === "Completed") statusColor = "var(--text-success)";
            else if (data.status === "Running") statusColor = "var(--text-warning)";
            else if (data.status === "Failed") statusColor = "var(--text-error)";
            else if (data.status === "Planned") statusColor = "var(--text-accent)";
            
            const statusBadge = data.status ? `<span style="font-size: 11px; padding: 2px 8px; border-radius: 12px; background: var(--background-primary); border: 1px solid ${statusColor}; color: ${statusColor}; vertical-align: middle; margin-left: 10px; font-weight: 500;">${data.status}</span>` : '';

            let html = `<div style="font-size: 14px; color: ${textColor}; margin-top:5px;">`;
            
            // Header
            html += `
            <div style="border-bottom: 2px solid var(--interactive-accent); padding-bottom: 10px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:flex-end;">
                <div>
                    <h2 style="margin: 0; font-size: 22px; font-weight: 700; color: var(--interactive-accent);">${expCode} ${statusBadge}</h2>
                    <div style="font-size: 13px; color: var(--text-muted); margin-top:4px;">${data.title || data.type || 'Polymerization'}</div>
                </div>
            </div>`;

            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number' | 'text' = 'number', customHtml?: string, extraStyles: string = "") => {
                let innerHTML = customHtml !== undefined ? customHtml : '-';
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                if (customHtml === undefined) {
                    if (inputType === 'text') innerHTML = val ? val : '-';
                    else { const numVal = Number(val); innerHTML = (!isNaN(numVal) && numVal > 0) ? numVal.toFixed(2) : '-'; }
                }
                return `<td class="eln-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 10px; cursor: text; transition: background 0.2s; ${extraStyles}">${innerHTML}</td>`;
            };

            const makeEditableRoot = (key: string, val: any, type: string = 'root', inputType = 'number') => {
                const displayVal = val || '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="eln-editable" data-type="${type}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 1px dashed var(--interactive-accent); display: inline-block;">${displayVal}</span>`;
            };

            // ==========================================
            // RENDER FORMULATION MODE
            // ==========================================
            if (data.type === 'formulation') {
                html += `
                <div style="margin-bottom: 15px; font-size: 13px; background: var(--background-secondary); padding: 10px; border-radius: 6px;">
                    <span style="color:var(--text-muted)">Target Mass [g]:</span> ${makeEditableRoot('target_mass_g', data.target_mass_g)}
                </div>
                <h4 style="margin-bottom: 10px; color: var(--text-normal);">Formulation Components (PHR Base)</h4>
                <div style="overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Component</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">PHR</th><th style="padding: 10px;">Wt %</th><th style="padding: 10px;">Mass [g]</th><th style="padding: 10px;">Vol [mL]</th>
                    </tr>`;
                
                data.components.forEach((c: any, i: number) => {
                    html += `<tr style="border-bottom: 1px solid ${bdColor};">
                        ${makeEditableTd('components', i, 'name', c.name, 'text', c.name, "font-weight:600;")}
                        <td style="padding: 10px;"><div class="poly-struct" data-type="components" data-idx="${i}" data-smiles="${c.smiles||''}"></div></td>
                        ${makeEditableTd('components', i, 'phr', c.phr, 'number', undefined, "color:var(--text-accent); font-weight:bold;")}
                        <td style="padding: 10px;">${(c.wt_frac * 100).toFixed(1)}%</td>
                        <td style="padding: 10px;">${c.mass_g ? c.mass_g.toFixed(3) : '-'}</td>
                        <td style="padding: 10px;">${c.volume_ml ? c.volume_ml.toFixed(2) : '-'}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            } 
            // ==========================================
            // RENDER POLYMERIZATION MODE
            // ==========================================
            else {
                html += `
                <div style="display: flex; gap: 15px; margin-bottom: 20px; font-size: 13px; background: var(--background-secondary); padding: 10px; border-radius: 6px;">
                    <div><span style="color:var(--text-muted)">Target DP:</span> ${makeEditableRoot('target_dp', data.target_dp)}</div>
                    <div><span style="color:var(--text-muted)">Target Mass [g]:</span> ${makeEditableRoot('target_mass_g', data.target_mass_g)}</div>
                </div>`;

                const char = data.characterization || {};
                html += `
                <div style="display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 25px;">
                    <div style="flex: 1; min-width: 120px; background: var(--background-secondary); padding: 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Theoretical Mn</div>
                        <div style="font-size:18px; font-weight:bold; color:var(--interactive-accent);">${data.theoretical_mn ? Math.round(data.theoretical_mn).toLocaleString() : '-'}</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: var(--background-secondary); padding: 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">GPC Actual Mn</div>
                        <div style="font-size:18px; font-weight:bold; color:var(--text-normal);">${makeEditableRoot('Mn_gpc', char.Mn_gpc, 'characterization')}</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: var(--background-secondary); padding: 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Dispersity (Đ)</div>
                        <div style="font-size:18px; font-weight:bold; color:${char.dispersity < 1.2 ? 'var(--text-success)' : 'var(--text-warning)'};">${makeEditableRoot('dispersity', char.dispersity, 'characterization')}</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: var(--background-secondary); padding: 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); text-align:center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Thermal Tg [°C]</div>
                        <div style="font-size:18px; font-weight:bold; color:var(--text-normal);">${makeEditableRoot('Tg', char.Tg, 'characterization')}</div>
                    </div>
                </div>`;

                // Monomer Table
                html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Monomers</h4>
                <div style="overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                        <th style="padding: 10px;">Name</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">Eq (Ratio)</th><th style="padding: 10px;">MW</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">m [g]</th><th style="padding: 10px;">V [mL]</th>
                    </tr>`;
                
                data.monomers.forEach((m: any, i: number) => {
                    html += `<tr style="border-bottom: 1px solid ${bdColor};">
                        ${makeEditableTd('monomers', i, 'name', m.name, 'text', m.name, "font-weight:600;")}
                        <td style="padding: 10px;"><div class="poly-struct" data-type="monomers" data-idx="${i}" data-smiles="${m.smiles||''}"></div></td>
                        ${makeEditableTd('monomers', i, 'eq', m.eq, 'number', undefined, "font-weight:bold;")}
                        <td style="padding: 10px; color:var(--text-muted);">${m.mw ? m.mw.toFixed(1) : '-'}</td>
                        <td style="padding: 10px;">${m.mmol ? m.mmol.toFixed(2) : '-'}</td>
                        <td style="padding: 10px; color:var(--interactive-accent); font-weight:bold;">${m.mass_g ? m.mass_g.toFixed(3) : '-'}</td>
                        <td style="padding: 10px;">${m.volume_ml ? m.volume_ml.toFixed(2) : '-'}</td>
                    </tr>`;
                });
                html += `</table></div>`;

                if (data.initiators.length > 0 || data.agents.length > 0) {
                    html += `<h4 style="margin-bottom: 10px; color: var(--text-normal);">Initiators, Catalysts & Agents</h4>
                    <div style="overflow-x: auto; margin-bottom: 20px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <tr style="background-color: ${thColor}; border-bottom: 2px solid var(--background-modifier-border);">
                            <th style="padding: 10px;">Role</th><th style="padding: 10px;">Name</th><th style="padding: 10px;">Structure</th><th style="padding: 10px;">[M]/[I] Ratio</th><th style="padding: 10px;">n [mmol]</th><th style="padding: 10px;">m [mg]</th>
                        </tr>`;
                    
                    const renderAgent = (a: any, role: string, type: string, idx: number) => {
                        const baseEq = data.monomers[0]?.eq || 1;
                        const aEq = a.eq || 1;
                        const mToIRatio = baseEq / aEq;
                        
                        html += `<tr style="border-bottom: 1px solid ${bdColor};">
                            <td style="padding: 10px; color:var(--text-muted); font-size:11px; text-transform:uppercase;">${role}</td>
                            ${makeEditableTd(type, idx, 'name', a.name, 'text', a.name, "font-weight:600;")}
                            <td style="padding: 10px;"><div class="poly-struct" data-type="${type}" data-idx="${idx}" data-smiles="${a.smiles||''}"></div></td>
                            <td style="padding: 10px; font-weight:bold; color:var(--text-warning);">${Math.round(mToIRatio)} : 1</td>
                            <td style="padding: 10px;">${a.mmol ? a.mmol.toFixed(3) : '-'}</td>
                            <td style="padding: 10px; color:var(--text-normal); font-weight:bold;">${a.mass_mg ? a.mass_mg.toFixed(1) : '-'}</td>
                        </tr>`;
                    };

                    data.initiators.forEach((i: any, idx: number) => renderAgent(i, "Initiator", "initiators", idx));
                    data.agents.forEach((a: any, idx: number) => renderAgent(a, "CTA/Agent", "agents", idx));
                    
                    html += `</table></div>`;
                }
            }

            html += `</div>`;
            
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.eln-editable:hover { background-color: var(--background-modifier-hover); }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

            // Structure Render & Click Handlers
            const nodes = contentDiv.querySelectorAll('.poly-struct');
            nodes.forEach(node => {
                const elNode = node as HTMLElement;
                const smiles = elNode.dataset.smiles;
                const type = elNode.dataset.type as string;
                const idx = parseInt(elNode.dataset.idx || '0', 10);

                elNode.style.width = `120px`; elNode.style.height = `80px`; 
                elNode.style.cursor = "pointer"; elNode.title = "Double-click to edit structure"; 
                elNode.innerHTML = "⏳";
                
                if (smiles) {
                    requestAnimationFrame(async () => {
                        const renderEl = await this.plugin.api.renderStructure(smiles, 120, 80);
                        elNode.empty();
                        if (renderEl) { renderEl.style.maxWidth='100%'; renderEl.style.maxHeight='100%'; elNode.appendChild(renderEl); } 
                        else elNode.innerHTML = "❌";
                    });
                } else { elNode.innerHTML = "Draw..."; elNode.style.color = "var(--text-muted)"; }

                elNode.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    let info = ctx.getSectionInfo(el);
                    if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                    if (!view || !info) return;

                    this.plugin.api.ketcher.openEditor(smiles || "", "smiles", (newData: string) => {
                        const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        try {
                            const yamlObj = parseYaml(blockText);
                            yamlObj[type][idx].smiles = newData;
                            delete yamlObj[type][idx].mw; // wipe mw so it recalculates
                            const newYaml = stringifyYaml(yamlObj);
                            view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        } catch (err) {}
                    });
                });
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Polymer ELN Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}

export class PolymerMetaEditorModal extends Modal {
    plugin: any; data: any; onSave: (updated: any) => void;
    
    constructor(app: App, plugin: any, yamlObj: any, onSave: (updated: any) => void) {
        super(app); this.plugin = plugin; this.data = JSON.parse(JSON.stringify(yamlObj));
        if (!this.data.monomers) this.data.monomers = [];
        if (!this.data.initiators) this.data.initiators = [];
        if (!this.data.agents) this.data.agents = [];
        if (!this.data.components) this.data.components = [];
        this.onSave = onSave;
    }

    onOpen() { this.render(); }
    
    render() {
        const { contentEl } = this; contentEl.empty();
        
        const header = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;" }});
        header.createEl("h2", { text: "Edit Polymer Meta", attr: { style: "margin: 0; font-size: 1.2em;" } });
        
        const saveBtn = header.createEl("button", { text: "Save", cls: "mod-cta" });
        saveBtn.onclick = () => { this.onSave(this.data); this.close(); };

        const metaGrid = contentEl.createDiv({ attr: { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;" }});
        
        const addInput = (parent: HTMLElement, label: string, key: string) => {
            const wrap = parent.createDiv(); wrap.createEl("div", { text: label, cls: "color-text-muted", attr: { style: "font-size:12px; margin-bottom:3px;"} });
            const inp = wrap.createEl("input", { type: "text", value: this.data[key] || "", attr: { style: "width:100%;" } });
            inp.onchange = (e: any) => this.data[key] = e.target.value;
        };
        
        addInput(metaGrid, "Experiment Code", "code"); 
        addInput(metaGrid, "Title", "title");
        addInput(metaGrid, "Target Mass (g)", "target_mass_g");
        if (this.data.type !== 'formulation') addInput(metaGrid, "Target DP", "target_dp");

        const renderChemRow = (item: any, type: string, idx: number) => {
            const row = contentEl.createDiv({ attr: { style: "background: var(--background-secondary-alt); padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; gap: 10px;" }});
            
            const topWrap = row.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center;" }});
            const nameInp = topWrap.createEl("input", { type: "text", value: item.name || "", attr: { placeholder: "Chemical Name", style: "width: 100%; font-weight: bold;" }});
            nameInp.onchange = (e: any) => item.name = e.target.value;

            const actionRow = row.createDiv({ attr: { style: "display: flex; gap: 6px; justify-content: flex-start; flex-wrap: wrap;" }});
            
            const drawBtn = actionRow.createEl("button", { text: "✏️ Draw", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            drawBtn.onclick = () => {
                this.plugin.api.ketcher.openEditor(item.smiles || "", "smiles", (newSmiles: string) => { item.smiles = newSmiles; this.render(); });
            };

            const libBtn = actionRow.createEl("button", { text: "📚 Lib", attr: {style: "font-size:11px; padding: 4px 8px;"} });
            libBtn.onclick = async () => {
                const lib = await getCompoundLibrary(this.plugin);
                new CompoundSuggestModal(this.plugin.app, lib, (selected) => { item.name = selected.name; item.smiles = selected.smiles; this.render(); }).open();
            };

            const delBtn = actionRow.createEl("button", { text: "🗑️ Remove", attr: { style: "color: var(--text-error); font-size:11px; padding: 4px 8px; margin-left:auto;" }});
            delBtn.onclick = () => { this.data[type].splice(idx, 1); this.render(); };

            const botRow = row.createDiv({ attr: { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(75px, 1fr)); gap: 8px; margin-top: 5px;" }});
            
            const makeNumInp = (key: string, label: string) => {
                const wrap = botRow.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
                wrap.createEl("span", { text: label, attr: { style: "font-size: 10px; color: var(--text-muted); margin-bottom: 2px; white-space: nowrap;" }});
                const inp = wrap.createEl("input", { type: "number", value: item[key] !== undefined ? item[key] : "", attr: { style: "width: 100%; padding: 4px; box-sizing: border-box;" }});
                inp.onchange = (e: any) => { const val = parseFloat(e.target.value.replace(/,/g, '.')); if (isNaN(val)) delete item[key]; else item[key] = val; this.render(); };
            };
            
            if (type === 'monomers') { makeNumInp('eq', 'Eq'); }
            if (type === 'initiators' || type === 'agents') { makeNumInp('ratio_to_monomer', 'Ratio [I]/[M]'); }
            if (type === 'components') { makeNumInp('phr', 'PHR'); }
        };

        const makeSection = (title: string, typeKey: string) => {
            const h = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; margin-top: 20px;" }});
            h.createEl("h3", { text: title, attr: { style: "margin: 0; font-size: 1.1em;" } });
            const btn = h.createEl("button", { text: "+ Add" });
            btn.onclick = () => { this.data[typeKey].push({ name: "", smiles: "" }); this.render(); };
            this.data[typeKey].forEach((x: any, idx: number) => renderChemRow(x, typeKey, idx));
        };

        if (this.data.type === 'formulation') {
            makeSection("Components (Resins, Fillers)", "components");
        } else {
            makeSection("Monomers", "monomers");
            makeSection("Initiators & Catalysts", "initiators");
            makeSection("RAFT / CTA Agents", "agents");
        }
        
        contentEl.createDiv({ attr: { style: "height: 50px;" } }); 
    }
    onClose() { this.contentEl.empty(); }
}
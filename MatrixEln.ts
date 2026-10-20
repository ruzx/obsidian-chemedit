// MatrixEln.ts
import { App, Notice } from 'obsidian';

export class MatrixCalculator {
    static calculate(data: any) {
        if (!data.variables) data.variables = {};
        if (!data.fixed_components) data.fixed_components = [];

        const scaleMmol = data.scale_mmol || 0.05; 
        const volPerVialUl = data.vol_per_vial_ul || 500;
        const overage = data.overage_percent !== undefined ? data.overage_percent : 10;

        // Generate Cartesian Product (Reaction Array)
        const varKeys = Object.keys(data.variables);
        const combinations: any[] = [];
        
        const helper = (idx: number, currentObj: any) => {
            if (idx === varKeys.length) { combinations.push({ ...currentObj }); return; }
            const key = varKeys[idx];
            data.variables[key].forEach((item: any) => {
                currentObj[key] = item;
                helper(idx + 1, currentObj);
            });
        };
        
        if (varKeys.length > 0) helper(0, {});
        else combinations.push({});

        data.matrix = combinations;
        data.total_reactions = combinations.length;
        data.calc_reactions = data.total_reactions * (1 + overage / 100);
        data.total_master_vol_ul = data.calc_reactions * volPerVialUl;

        // Calculate Master Mix
        data.fixed_components.forEach((c: any) => {
            c.eq = c.eq || 1;
            c.total_mmol = scaleMmol * c.eq * data.calc_reactions;
            if (c.mw) c.total_mass_mg = c.total_mmol * c.mw;
        });

        if (!data.yields) {
            data.yields = new Array(data.total_reactions).fill(null);
        }

        return data;
    }
}

export class MatrixElnRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }

    async renderBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        const themeColor = "#6366f1"; 
        const bdColor = "var(--background-modifier-border)";
        const bgSec = "var(--background-secondary)"; // <-- FIXED: Added missing variable

        wrapper.style.position = "relative"; 
        wrapper.style.border = `1px solid ${bdColor}`; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.padding = "24px";
        wrapper.style.boxShadow = "0 4px 12px rgba(99, 102, 241, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.style.marginBottom = "15px";

        try {
            let data = parseYaml(source);
            if (!data) throw new Error("Empty YAML Data.");
            data = MatrixCalculator.calculate(data);

            let html = `
            <div style="position: relative; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="display:flex; flex-direction:column;">
                        <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: ${themeColor};">⚗️ ${data.title || 'HTE Reaction Array'}</h2>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${data.strategy || 'High-Throughput Experimentation Matrix'}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:28px; font-weight:800; color:var(--text-normal);">${data.total_reactions} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">Rxns</span></div>
                    </div>
                </div>
            </div>`;

            const formatNum = (num: any, decimals: number = 2) => {
                const n = Number(num);
                if (isNaN(n) || n === 0) return '-';
                return (n % 1 === 0) ? n.toString() : n.toFixed(decimals);
            };

            // 1. MASTER MIX VISUALIZER
            html += `
            <h4 style="color: var(--text-normal); margin-bottom: 10px; font-size: 14px;">1. Master Mix Preparation</h4>
            <div style="display: flex; align-items: stretch; background: var(--background-secondary-alt); border-radius: 8px; border: 1px solid ${bdColor}; padding: 20px 10px; gap: 15px; margin-bottom: 24px;">
                
                <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <svg stroke="${themeColor}" fill="rgba(99, 102, 241, 0.15)" width="48" height="48" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a2 2 0 0 0 1.8 2.45h10.96a2 2 0 0 0 1.8-2.45L14.21 10.42a2 2 0 0 1-.21-.896V2"/><path d="M8.5 2h7"/><path d="M14 16H5.5"/></svg>
                    <div style="font-weight: 700; font-size: 14px; color: var(--text-normal); margin-top: 10px;">Master Vial</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 5px;">Total Required Volume:</div>
                    <div style="font-size: 20px; font-weight: 800; color: ${themeColor}; margin-top: 4px;">${formatNum(data.total_master_vol_ul / 1000)} <span style="font-size:12px; font-weight:500;">mL</span></div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">(Includes ${data.overage_percent}% overage)</div>
                </div>

                <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative;">
                    <div style="position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: ${themeColor}; z-index: 0; border-style: dashed; opacity: 0.5;"></div>
                    <div style="background: var(--background-primary); padding: 15px; z-index: 1; display: flex; flex-direction: column; align-items: center; border-radius: 8px; border: 1px solid ${bdColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <svg stroke="var(--text-muted)" fill="none" width="32" height="32" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/></svg>
                        <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-top: 10px; text-transform: uppercase;">Dispense</div>
                        <div style="font-size: 16px; font-weight: 800; color: var(--text-normal); margin-top: 4px;">${data.vol_per_vial_ul} <span style="font-size:11px; font-weight:500;">µL / vial</span></div>
                    </div>
                </div>

                <div style="flex: 1; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <svg stroke="var(--text-muted)" fill="none" width="48" height="48" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><circle cx="15.5" cy="8.5" r="1.5"/><circle cx="8.5" cy="15.5" r="1.5"/><circle cx="15.5" cy="15.5" r="1.5"/></svg>
                    <div style="font-weight: 700; font-size: 14px; color: var(--text-normal); margin-top: 10px;">HTE Array</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 5px;">Reactions:</div>
                    <div style="font-size: 20px; font-weight: 800; color: var(--text-normal); margin-top: 4px;">${data.total_reactions}</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">Scale: ${data.scale_mmol} mmol</div>
                </div>
            </div>`;

            // Fixed Components Table
            html += `
            <div style="overflow-x: auto; margin-bottom: 25px;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                <tr style="background-color: ${bgSec}; border-bottom: 2px solid ${bdColor};">
                    <th style="padding: 8px;">Fixed Component</th><th style="padding: 8px;">MW</th><th style="padding: 8px;">Equiv</th><th style="padding: 8px; color:${themeColor};">Mass to Weigh (mg)</th>
                </tr>`;
            if (data.fixed_components) {
                data.fixed_components.forEach((c: any) => {
                    html += `<tr style="border-bottom: 1px solid var(--background-modifier-border-hover);">
                        <td style="padding: 8px; font-weight:600;">${c.name}</td>
                        <td style="padding: 8px;">${c.mw || '-'}</td>
                        <td style="padding: 8px;">${c.eq || 1}</td>
                        <td style="padding: 8px; font-weight:bold; color:var(--text-normal); font-size:14px;">${c.total_mass_mg ? c.total_mass_mg.toFixed(1) : '-'}</td>
                    </tr>`;
                });
            }
            html += `</table></div>`;

            // 2. ARRAY MATRIX
            const varKeys = Object.keys(data.variables);
            
            html += `<h4 style="color: var(--text-normal); margin-bottom: 10px; font-size: 14px;">2. Experimental Array</h4>
            <div style="overflow-x: auto; margin-bottom: 10px;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; border: 1px solid ${bdColor};">
                <tr style="background-color: ${bgSec}; border-bottom: 2px solid ${bdColor};">
                    <th style="padding: 8px; text-align:center;">Vial</th>`;
            
            varKeys.forEach(k => html += `<th style="padding: 8px;">${k}</th>`);
            html += `<th style="padding: 8px; color:${themeColor}; text-align:right;">Yield (%)</th></tr>`;

            data.matrix.forEach((combo: any, i: number) => {
                const currentYield = data.yields[i] !== null ? data.yields[i] : '';
                const displayYield = currentYield !== '' ? currentYield : '-';
                
                let yColor = "var(--text-muted)";
                if (currentYield !== '') {
                    const y = parseFloat(currentYield);
                    if (y >= 80) yColor = "var(--text-success)";
                    else if (y >= 40) yColor = "var(--text-warning)";
                    else yColor = "var(--text-error)";
                }

                html += `<tr style="border-bottom: 1px solid var(--background-modifier-border-hover);">
                    <td style="padding: 8px; font-weight:bold; color:${themeColor}; background:var(--background-secondary-alt); text-align:center; width: 40px;">${i+1}</td>`;
                
                varKeys.forEach(k => {
                    const item = combo[k];
                    const name = typeof item === 'object' ? item.name : item;
                    html += `<td style="padding: 8px; font-weight:600; color:var(--text-normal);">${name}</td>`;
                });
                
                html += `<td class="matrix-yield-cell" data-idx="${i}" data-raw-value="${currentYield}" title="Double-click to enter yield" style="padding: 8px; text-align:right; font-weight:bold; font-size:14px; color:${yColor}; cursor:text; transition: background 0.2s;">${displayYield}</td></tr>`;
            });
            html += `</table></div>`;

            // Action Bar
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { display: "flex", gap: "10px", marginTop: "15px", flexWrap: "wrap", justifyContent: "flex-end" });
            
            const createBtn = (text: string, onClick: () => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "6px 12px"; btn.style.fontWeight = "600";
                btn.style.backgroundColor = "var(--background-secondary)"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-normal)"; btn.style.borderRadius = "6px";
                btn.onmouseover = () => { btn.style.borderColor = themeColor; btn.style.color = themeColor; };
                btn.onmouseout = () => { btn.style.borderColor = "var(--background-modifier-border)"; btn.style.color = "var(--text-normal)"; };
                btn.onclick = onClick; return btn;
            };

            createBtn("📊 Export to Excel", () => {
                let csv = `Vial\t${varKeys.join('\t')}\tYield_Percent\n`;
                data.matrix.forEach((combo: any, i: number) => {
                    let row = `${i+1}`;
                    varKeys.forEach(k => { row += `\t${typeof combo[k] === 'object' ? combo[k].name : combo[k]}`; });
                    row += `\t${data.yields[i] !== null ? data.yields[i] : ''}`;
                    csv += row + '\n';
                });
                navigator.clipboard.writeText(csv);
                new Notice("Excel-ready Data copied to clipboard!");
            });

            createBtn("🤖 Export CSV (ML-Ready)", () => {
                let csv = `${varKeys.join(',')},Yield\n`;
                data.matrix.forEach((combo: any, i: number) => {
                    let row: string[] = [];
                    varKeys.forEach(k => { row.push(`"${typeof combo[k] === 'object' ? combo[k].name : combo[k]}"`); });
                    row.push(data.yields[i] !== null ? data.yields[i] : '');
                    csv += row.join(',') + '\n';
                });
                navigator.clipboard.writeText(csv);
                new Notice("Machine-Learning ready CSV copied to clipboard!");
            });

            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.matrix-yield-cell:hover { background-color: rgba(99, 102, 241, 0.1); }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);
            wrapper.appendChild(actionBar);

            // Double-Click Inline Editing for Yields
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('matrix-yield-cell')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('matrix-yield-cell') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.innerHTML = ''; target.style.padding = "4px"; 
                    
                    const input = document.createElement('input');
                    input.type = 'number'; input.step = "any";
                    input.value = currentValText;
                    Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: `2px solid ${themeColor}`, borderRadius: "4px", background: "var(--background-primary)", fontSize: "14px", fontWeight: "bold", color: "var(--text-normal)", textAlign: "right" });
                    
                    target.appendChild(input); input.focus();

                    const finishEdit = () => {
                        const newValStr = input.value.trim().replace(/,/g, '.'); 
                        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                        let info = ctx.getSectionInfo(el);
                        if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                        
                        if (view && info) {
                            const { parseYaml, stringifyYaml } = require('obsidian');
                            const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            try {
                                let yamlObj = parseYaml(blockText);
                                if (!yamlObj.yields) yamlObj.yields = new Array(yamlObj.total_reactions).fill(null);
                                
                                const num = parseFloat(newValStr);
                                yamlObj.yields[idx] = isNaN(num) ? null : num;
                                
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) {}
                        }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); };
                }
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Matrix Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}
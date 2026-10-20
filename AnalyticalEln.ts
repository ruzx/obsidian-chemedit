// AnalyticalEln.ts
import { App, MarkdownView, Notice } from 'obsidian';

export class AnalyticalCalculator {
    static calculate(data: any) {
        if (!data.type) data.type = 'calibration';

        // 1. CALIBRATION CURVE
        if (data.type === 'calibration') {
            if (!data.standards) data.standards = [];
            if (!data.samples) data.samples = [];

            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0, n = 0;
            data.standards.forEach((std: any) => {
                if (std.conc !== undefined && std.area !== undefined && std.exclude !== true) {
                    sumX += std.conc; sumY += std.area; sumXY += std.conc * std.area; sumXX += std.conc * std.conc; sumYY += std.area * std.area; n++;
                }
            });

            if (n > 1) {
                const denominator = (n * sumXX - sumX * sumX);
                if (denominator !== 0) {
                    data.slope = (n * sumXY - sumX * sumY) / denominator;
                    data.intercept = (sumY - data.slope * sumX) / n;
                    const meanY = sumY / n;
                    let ssTot = 0, ssRes = 0;
                    data.standards.forEach((std: any) => {
                        if (std.conc !== undefined && std.area !== undefined && std.exclude !== true) {
                            const predY = data.slope * std.conc + data.intercept;
                            ssTot += Math.pow(std.area - meanY, 2); ssRes += Math.pow(std.area - predY, 2);
                        }
                    });
                    data.r_squared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 1;
                }
            } else { data.slope = null; data.intercept = null; data.r_squared = null; }

            if (data.slope && data.slope !== 0) {
                data.samples.forEach((samp: any) => {
                    samp.dilution_factor = samp.dilution_factor || 1;
                    if (samp.area !== undefined) {
                        samp.vial_conc = (samp.area - data.intercept) / data.slope;
                        samp.original_conc = samp.vial_conc * samp.dilution_factor;
                    }
                });
            }
        }

        // 2. SERIAL DILUTION
        if (data.type === 'serial_dilution') {
            if (!data.targets) data.targets = [];
            const stock = data.stock_conc || 0;
            if (stock > 0) {
                data.targets.forEach((t: any) => {
                    if (t.target_conc && t.target_vol) {
                        t.stock_vol = (t.target_conc * t.target_vol) / stock;
                        t.diluent_vol = t.target_vol - t.stock_vol;
                    }
                });
            }
        }

        // 3. ACID & BASE PREPARATION (SIGMA-ALDRICH STYLE)
        if (data.type === 'acid_base_prep') {
            const density = data.density || 0;
            const mw = data.mw || 0;
            const ww = data.w_w_percent || 0;
            const tVol = data.target_volume_ml || 0;
            const tMol = data.target_molarity || 0;

            if (mw > 0 && density > 0 && ww > 0) {
                // Molarity of stock = (Density * 1000 * (w/w / 100)) / MW = (Density * 10 * w/w) / MW
                data.stock_molarity = (density * 10 * ww) / mw;
                
                if (data.stock_molarity > 0 && tVol > 0 && tMol > 0) {
                    // V1 = (M2 * V2) / M1
                    data.volume_to_dispense_ml = (tMol * tVol) / data.stock_molarity;
                } else { data.volume_to_dispense_ml = 0; }
            } else {
                data.stock_molarity = 0; data.volume_to_dispense_ml = 0;
            }
        }

        // 4. STANDARD ADDITION METHOD
        if (data.type === 'standard_addition') {
            if (!data.standards) data.standards = [];
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, n = 0;

            data.standards.forEach((std: any) => {
                if (std.added_conc !== undefined && std.area !== undefined && std.exclude !== true) {
                    sumX += std.added_conc; sumY += std.area; sumXY += std.added_conc * std.area; sumXX += std.added_conc * std.added_conc; n++;
                }
            });

            if (n > 1) {
                const denominator = (n * sumXX - sumX * sumX);
                if (denominator !== 0) {
                    data.slope = (n * sumXY - sumX * sumY) / denominator;
                    data.intercept = (sumY - data.slope * sumX) / n;
                    // X-intercept absolute value is the unknown concentration
                    data.calculated_unknown_conc = Math.abs(data.intercept / data.slope);
                }
            } else { data.calculated_unknown_conc = null; }
        }

        return data;
    }
}

export class AnalyticalElnRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }

    async renderAnalyticalBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        const themeColor = "#3b82f6"; 
        const bdColor = "var(--background-modifier-border)";

        wrapper.style.position = "relative"; 
        wrapper.style.border = `1px solid ${bdColor}`; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.padding = "20px";
        wrapper.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.05)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.style.marginBottom = "15px";

        try {
            const safeSource = source.replace(/smiles:\s*(.*)$/gm, (match, p1) => {
                let s = p1.trim(); if (!s) return match;
                let comment = ""; const commentMatch = s.match(/(\s+#.*)$/);
                if (commentMatch) { comment = commentMatch[1]; s = s.substring(0, s.length - comment.length).trim(); }
                if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.substring(1, s.length - 1);
                s = s.replace(/\\"/g, '"'); s = s.replace(/'/g, "''"); 
                return `smiles: '${s}'${comment}`;
            });
            
            let data = parseYaml(safeSource);
            if (!data) throw new Error("Empty YAML Data.");
            data = AnalyticalCalculator.calculate(data);

            let html = `
            <div style="margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: ${themeColor};">${data.title || 'Analytical Assay'}</h2>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${data.type.replace(/_/g, ' ')}</div>
            </div>`;

            const formatNum = (num: any, dec: number = 2) => {
                const n = Number(num);
                if (isNaN(n)) return '-';
                if (n === 0) return '0';
                if (n > 1000000) return n.toExponential(2);
                return (n % 1 === 0 && dec !== 0) ? n.toString() : n.toFixed(dec);
            };

            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number'|'text' = 'number', customHtml?: string, extraStyle="") => {
                let innerHTML = customHtml !== undefined ? customHtml : (inputType === 'number' ? formatNum(val) : (val||'-'));
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<td class="ana-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 6px 10px; cursor: text; border-bottom: 1px solid ${bdColor}; ${extraStyle}">${innerHTML}</td>`;
            };

            const makeEditableRoot = (key: string, val: any, inputType = 'number', unit = "") => {
                const displayVal = val !== undefined ? (inputType==='number' ? formatNum(val) : val) : '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="ana-editable" data-type="root" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 2px dotted ${themeColor}; font-weight: bold; color: var(--text-normal); padding: 0 2px;">${displayVal}${unit}</span>`;
            };

            // ==========================================
            // 1. CALIBRATION CURVE 
            // ==========================================
            if (data.type === 'calibration') {
                const u = data.units || 'µg/mL';
                html += `
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div style="flex: 1; background: var(--background-secondary-alt); padding: 10px; border-radius: 6px; text-align:center; border: 1px solid ${bdColor};">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Linear Equation</div>
                        <div style="font-size:14px; font-weight:bold; color:#3b82f6;">y = ${formatNum(data.slope, 4)}x ${data.intercept >= 0 ? '+' : '-'} ${formatNum(Math.abs(data.intercept), 4)}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-secondary-alt); padding: 10px; border-radius: 6px; text-align:center; border: 1px solid ${bdColor};">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">R-Squared (R²)</div>
                        <div style="font-size:16px; font-weight:bold; color:${data.r_squared >= 0.99 ? 'var(--text-success)' : 'var(--text-warning)'};">${formatNum(data.r_squared, 4)}</div>
                    </div>
                </div>`;

                html += `<div style="overflow-x: auto; margin-bottom: 20px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: var(--background-secondary); border-bottom: 2px solid ${bdColor};">
                        <th style="padding: 8px;">Standard</th><th style="padding: 8px;">Conc [${u}]</th><th style="padding: 8px;">Response</th><th style="padding: 8px; text-align:center;">Use</th>
                    </tr>`;
                data.standards.forEach((std: any, i: number) => {
                    const isEx = std.exclude ? `<span style="color:var(--text-error); font-size:10px; font-weight:bold;">EXCLUDED</span>` : `✅`;
                    html += `<tr style="border-bottom: 1px solid var(--background-modifier-border-hover); ${std.exclude ? 'opacity: 0.5;' : ''}">
                        ${makeEditableTd('standards', i, 'name', std.name, 'text', std.name, "font-weight:600;")}
                        ${makeEditableTd('standards', i, 'conc', std.conc, 'number')}
                        ${makeEditableTd('standards', i, 'area', std.area, 'number', undefined, "font-weight:bold; color:var(--interactive-accent);")}
                        <td class="ana-exclude-toggle" data-idx="${i}" data-state="${std.exclude ? 'true' : 'false'}" style="padding: 8px; text-align:center; cursor:pointer;" title="Toggle"> ${isEx}</td>
                    </tr>`;
                });
                html += `</table></div>`;

                if (data.samples && data.samples.length > 0) {
                    html += `<div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <tr style="background-color: var(--background-secondary); border-bottom: 2px solid ${bdColor};">
                            <th style="padding: 8px;">Sample</th><th style="padding: 8px;">Dil. Factor</th><th style="padding: 8px;">Response</th><th style="padding: 8px; color:#3b82f6;">Original Conc [${u}]</th>
                        </tr>`;
                    data.samples.forEach((samp: any, i: number) => {
                        html += `<tr>
                            ${makeEditableTd('samples', i, 'name', samp.name, 'text', samp.name, "font-weight:600;")}
                            ${makeEditableTd('samples', i, 'dilution_factor', samp.dilution_factor || 1, 'number')}
                            ${makeEditableTd('samples', i, 'area', samp.area, 'number')}
                            <td style="padding: 8px; font-weight:bold; color:var(--text-normal); font-size:14px; border-bottom: 1px solid ${bdColor};">${formatNum(samp.original_conc, 3)}</td>
                        </tr>`;
                    });
                    html += `</table></div>`;
                }
            }

            // ==========================================
            // 2. SERIAL DILUTION
            // ==========================================
            else if (data.type === 'serial_dilution') {
                const u = data.stock_units || '';
                html += `
                <div style="display: flex; gap: 15px; margin-bottom: 15px; font-size: 13px; background: var(--background-secondary-alt); padding: 10px; border-radius: 6px; border: 1px solid ${bdColor};">
                    <div><span style="color:var(--text-muted)">Stock:</span> ${makeEditableRoot('stock_conc', data.stock_conc)} ${u}</div>
                    <div><span style="color:var(--text-muted)">Diluent:</span> ${makeEditableRoot('diluent', data.diluent, 'text')}</div>
                </div>
                <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: var(--background-secondary); border-bottom: 2px solid ${bdColor};">
                        <th style="padding: 8px;">Target Conc [${u}]</th><th style="padding: 8px;">Target Vol</th><th style="padding: 8px; color:#3b82f6;">Stock to Add</th><th style="padding: 8px; color:#3b82f6;">Diluent to Add</th>
                    </tr>`;
                data.targets.forEach((t: any, i: number) => {
                    html += `<tr>
                        ${makeEditableTd('targets', i, 'target_conc', t.target_conc, 'number', undefined, "font-weight:bold; color:var(--text-normal);")}
                        ${makeEditableTd('targets', i, 'target_vol', t.target_vol, 'number')}
                        <td style="padding: 8px; font-weight:bold; color:var(--text-accent); border-bottom: 1px solid ${bdColor};">${formatNum(t.stock_vol)}</td>
                        <td style="padding: 8px; font-weight:bold; color:var(--text-normal); border-bottom: 1px solid ${bdColor};">${formatNum(t.diluent_vol)}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 3. ACID / BASE PREP
            // ==========================================
            else if (data.type === 'acid_base_prep') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 15px;">
                    <div style="background: var(--background-secondary-alt); border: 1px solid ${bdColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Density (g/mL)</div>
                        <div style="font-size:18px;">${makeEditableRoot('density', data.density)}</div>
                    </div>
                    <div style="background: var(--background-secondary-alt); border: 1px solid ${bdColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Formula Wt (g/mol)</div>
                        <div style="font-size:18px;">${makeEditableRoot('mw', data.mw)}</div>
                    </div>
                    <div style="background: var(--background-secondary-alt); border: 1px solid ${bdColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Weight % (w/w)</div>
                        <div style="font-size:18px;">${makeEditableRoot('w_w_percent', data.w_w_percent)}</div>
                    </div>
                    <div style="background: var(--background-secondary-alt); border: 1px solid ${bdColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Target Vol (mL)</div>
                        <div style="font-size:18px;">${makeEditableRoot('target_volume_ml', data.target_volume_ml)}</div>
                    </div>
                    <div style="background: var(--background-secondary-alt); border: 1px solid ${bdColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Target Molarity</div>
                        <div style="font-size:18px;">${makeEditableRoot('target_molarity', data.target_molarity)}</div>
                    </div>
                    <div style="background: var(--background-primary); border: 1px solid ${themeColor}; border-radius: 6px; padding: 10px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 4px;">Stock Molarity</div>
                        <div style="font-size:18px; color:${themeColor}; font-weight:bold;">${data.stock_molarity ? data.stock_molarity.toFixed(2) : '-'} M</div>
                    </div>
                </div>
                
                <div style="background: rgba(59, 130, 246, 0.1); border-left: 4px solid ${themeColor}; padding: 12px; border-radius: 4px; font-size: 14px; color: var(--text-normal);">
                    Take <b>${data.volume_to_dispense_ml ? data.volume_to_dispense_ml.toFixed(1) : '-'} mL</b> of concentrated ${data.reagent || 'solution'} and slowly add it to a flask containing water. Dilute to a final volume of <b>${data.target_volume_ml || '-'} mL</b>.
                </div>`;
            }

            // ==========================================
            // 4. STANDARD ADDITION
            // ==========================================
            else if (data.type === 'standard_addition') {
                const u = data.units || 'ppm';
                html += `
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div style="flex: 1; background: var(--background-secondary-alt); padding: 10px; border-radius: 6px; text-align:center; border: 1px solid ${bdColor};">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Regression Line</div>
                        <div style="font-size:14px; font-weight:bold; color:#3b82f6;">y = ${formatNum(data.slope, 4)}x ${data.intercept >= 0 ? '+' : '-'} ${formatNum(Math.abs(data.intercept), 4)}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); padding: 10px; border-radius: 6px; text-align:center; border: 2px solid ${themeColor};">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase;">Calculated Unknown Conc.</div>
                        <div style="font-size:18px; font-weight:bold; color:var(--text-normal);">${data.calculated_unknown_conc ? formatNum(data.calculated_unknown_conc, 3) : '-'} <span style="font-size:12px; color:var(--text-muted);">${u}</span></div>
                    </div>
                </div>

                <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <tr style="background-color: var(--background-secondary); border-bottom: 2px solid ${bdColor};">
                        <th style="padding: 8px;">Added Conc [${u}]</th><th style="padding: 8px;">Response (Area)</th><th style="padding: 8px; text-align:center;">Use</th>
                    </tr>`;
                data.standards.forEach((std: any, i: number) => {
                    const isEx = std.exclude ? `<span style="color:var(--text-error); font-size:10px; font-weight:bold;">EXCLUDED</span>` : `✅`;
                    html += `<tr style="border-bottom: 1px solid var(--background-modifier-border-hover); ${std.exclude ? 'opacity: 0.5;' : ''}">
                        ${makeEditableTd('standards', i, 'added_conc', std.added_conc, 'number')}
                        ${makeEditableTd('standards', i, 'area', std.area, 'number', undefined, "font-weight:bold; color:var(--interactive-accent);")}
                        <td class="ana-exclude-toggle" data-idx="${i}" data-state="${std.exclude ? 'true' : 'false'}" style="padding: 8px; text-align:center; cursor:pointer;"> ${isEx}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 5. HPLC METHOD
            // ==========================================
            else if (data.type === 'hplc_method' || data.type === 'gc_method') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: var(--background-secondary-alt); padding: 12px; border-radius: 8px; border: 1px solid ${bdColor}; margin-bottom: 15px;">
                    <div><b style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Column</b><br><span style="font-weight:600; font-size:13px;">${makeEditableRoot('column', data.column, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Flow / Carrier</b><br><span style="font-weight:600; font-size:13px;">${makeEditableRoot('flow_rate', data.flow_rate, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Temp</b><br><span style="font-weight:600; font-size:13px;">${makeEditableRoot('temp', data.temp, 'text')}</span></div>
                    <div><b style="color:var(--text-muted); font-size:10px; text-transform:uppercase;">Detection</b><br><span style="font-weight:600; font-size:13px;">${makeEditableRoot('detection', data.detection, 'text')}</span></div>
                </div>`;

                if (data.gradient) {
                    html += `
                    <div style="overflow-x: auto;">
                    <table style="width: 50%; min-width:250px; border-collapse: collapse; text-align: left; font-size: 13px;">
                        <tr style="background-color: var(--background-secondary); border-bottom: 2px solid ${bdColor};">
                            <th style="padding: 8px;">Time (min)</th><th style="padding: 8px;">% B (or °C)</th>
                        </tr>`;
                    data.gradient.forEach((g: any, i: number) => {
                        html += `<tr>
                            ${makeEditableTd('gradient', i, 'time', g.time, 'number', undefined, "font-weight:bold; border-bottom: 1px solid " + bdColor + ";")}
                            ${makeEditableTd('gradient', i, 'b_percent', g.b_percent, 'number', undefined, "border-bottom: 1px solid " + bdColor + ";")}
                        </tr>`;
                    });
                    html += `</table></div>`;
                }
            }

            html += `</div>`;
            
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.ana-editable:hover { background-color: rgba(59, 130, 246, 0.1); border-radius: 4px; }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

            // Double-Click Inline Editing
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('ana-editable')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('ana-editable') && !target.querySelector('input')) {
                    e.stopPropagation();
                    const type = target.getAttribute('data-type');
                    const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
                    const key = target.getAttribute('data-key');
                    const inputType = target.getAttribute('data-input-type') || 'number';
                    if (!key) return;

                    const originalHTML = target.innerHTML;
                    const currentValText = target.getAttribute('data-raw-value') || '';
                    
                    target.innerHTML = ''; 
                    
                    const input = document.createElement('input');
                    input.type = inputType === 'text' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: `2px solid ${themeColor}`, borderRadius: "4px", background: "var(--background-primary)", fontSize: "inherit", fontWeight: "inherit", color: "var(--text-normal)" });
                    
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
                                let valToSave: any = newValStr;
                                if (inputType === 'number') { const num = parseFloat(newValStr); valToSave = isNaN(num) ? undefined : num; } 
                                else { valToSave = newValStr === '' ? undefined : newValStr; }

                                if (type === 'root') {
                                    if (valToSave === undefined) delete yamlObj[key]; else yamlObj[key] = valToSave;
                                } else {
                                    if (!yamlObj[type!]) yamlObj[type!] = [];
                                    if (!yamlObj[type!][idx]) yamlObj[type!] = {};
                                    if (valToSave === undefined) delete yamlObj[type!][idx][key];
                                    else yamlObj[type!][idx][key] = valToSave;
                                }
                                
                                yamlObj = AnalyticalCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { target.innerHTML = originalHTML; }
                        } else { target.innerHTML = originalHTML; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; } };
                }
            });

            // Exclude Toggle Listener
            const toggles = contentDiv.querySelectorAll('.ana-exclude-toggle');
            toggles.forEach(node => {
                node.addEventListener('click', (e) => {
                    const elNode = node as HTMLElement;
                    const idx = parseInt(elNode.dataset.idx || '0', 10);
                    const currentState = elNode.dataset.state === 'true';

                    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
                    let info = ctx.getSectionInfo(el);
                    if (!info && el.parentElement) info = ctx.getSectionInfo(el.parentElement);
                    
                    if (view && info) {
                        const { parseYaml, stringifyYaml } = require('obsidian');
                        const blockText = view.editor.getRange({line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        try {
                            let yamlObj = parseYaml(blockText);
                            yamlObj.standards[idx].exclude = !currentState;
                            yamlObj = AnalyticalCalculator.calculate(yamlObj);
                            view.editor.replaceRange(stringifyYaml(yamlObj), {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                        } catch (err) {}
                    }
                });
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Analytical ELN Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}
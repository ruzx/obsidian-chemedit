// BioEln.ts
import { App, MarkdownView, Notice, Menu } from 'obsidian';

export class BioCalculator {
    static calculate(data: any) {
        if (!data.type) data.type = 'pcr';

        // 1. PCR
        if (data.type === 'pcr') {
            if (!data.components) data.components = [];
            const rxns = data.reactions || 1;
            const overage = data.overage_percent !== undefined ? data.overage_percent : 10;
            const calcRxns = rxns * (1 + overage / 100);
            const totalVol = data.total_volume_ul || 25;

            let waterIdx = -1;
            let currentVol = 0;

            data.components.forEach((c: any, i: number) => {
                const name = c.name?.toLowerCase() || '';
                if (name.includes('water') || name.includes('h2o')) { waterIdx = i; return; }

                if (c.volume_ul !== undefined && c.volume_ul !== null) { } 
                else if (c.stock && c.final) {
                    const stockVal = parseFloat(String(c.stock).replace(/[^\d.-]/g, ''));
                    const finalVal = parseFloat(String(c.final).replace(/[^\d.-]/g, ''));
                    if (!isNaN(stockVal) && !isNaN(finalVal) && stockVal > 0) c.volume_ul = (finalVal / stockVal) * totalVol;
                } else { c.volume_ul = 0; }
                
                c.mm_volume_ul = c.volume_ul * calcRxns;
                if (!c.add_to_mm_separately) currentVol += c.volume_ul;
            });

            if (waterIdx !== -1) {
                const waterVol = totalVol - currentVol;
                data.components[waterIdx].volume_ul = waterVol > 0 ? waterVol : 0;
                data.components[waterIdx].mm_volume_ul = data.components[waterIdx].volume_ul * calcRxns;
            }
            data.calculated_reactions = calcRxns;
        }

        // 2. BUFFER
        if (data.type === 'buffer') {
            if (!data.components) data.components = [];
            const volLiters = data.volume_L || 1.0;
            data.components.forEach((c: any) => {
                if (c.target_M && c.mw) c.mass_g = c.target_M * volLiters * c.mw;
                else if (c.target_mg_ml) c.mass_g = c.target_mg_ml * volLiters;
            });
        }

        // 3. CELL SEEDING
        if (data.type === 'cell_seeding') {
            const currentConc = data.current_cells_per_ml || 0;
            const targetPerWell = data.target_cells_per_well || 0;
            const wells = data.wells || 1;
            const volPerWell = data.vol_per_well_ml || 1.0;
            const overage = data.overage_percent !== undefined ? data.overage_percent : 10;
            
            const calcWells = wells * (1 + overage / 100);
            data.total_cells_needed = targetPerWell * calcWells;
            data.total_media_needed_ml = volPerWell * calcWells;
            
            if (currentConc > 0) {
                data.cell_suspension_vol_ml = data.total_cells_needed / currentConc;
                data.media_to_add_ml = data.total_media_needed_ml - data.cell_suspension_vol_ml;
                if (data.media_to_add_ml < 0) data.media_to_add_ml = 0; 
            }
        }

        // 4. NGS POOLING
        if (data.type === 'ngs_pooling') {
            if (!data.samples) data.samples = [];
            let totalPoolVol = 0;
            const targetFmol = data.target_fmol_per_sample || 100; 
            data.samples.forEach((s: any) => {
                if (s.conc_ng_ul && s.length_bp) s.conc_nM = (s.conc_ng_ul * 1000000) / (s.length_bp * 660);
                if (s.conc_nM > 0) {
                    s.pool_vol_ul = targetFmol / s.conc_nM;
                    totalPoolVol += s.pool_vol_ul;
                }
            });
            data.total_pool_vol_ul = totalPoolVol;
        }

        // 5. PROTEIN QUANTIFICATION
        if (data.type === 'protein_quant') {
            if (!data.samples) data.samples = [];
            const pathLength = data.path_length_cm || 1.0;
            data.samples.forEach((s: any) => {
                if (s.A280 && s.ext_coeff) {
                    s.conc_M = s.A280 / (s.ext_coeff * pathLength);
                    s.conc_uM = s.conc_M * 1000000;
                    if (s.mw) s.conc_mg_ml = s.conc_M * s.mw;
                }
            });
        }

        // 6. OLIGO ANALYZER
        if (data.type === 'oligo_analyzer') {
            const seq = (data.sequence || "").toUpperCase().replace(/[^ATCGU]/g, '');
            data.length = seq.length;
            if (seq.length > 0) {
                const gCount = (seq.match(/G/g) || []).length; const cCount = (seq.match(/C/g) || []).length;
                const aCount = (seq.match(/A/g) || []).length; const tCount = (seq.match(/T/g) || []).length + (seq.match(/U/g) || []).length;
                data.gc_percent = ((gCount + cCount) / seq.length) * 100;
                if (seq.length < 14) data.tm = (aCount + tCount) * 2 + (gCount + cCount) * 4;
                else data.tm = 64.9 + 41 * (gCount + cCount - 16.4) / seq.length;
                data.mw = (aCount * 313.2) + (tCount * 304.2) + (cCount * 289.2) + (gCount * 329.2) - 61.96;
                const compMap: any = { 'A':'T', 'T':'A', 'U':'A', 'C':'G', 'G':'C' };
                data.rev_comp = seq.split('').reverse().map(base => compMap[base] || base).join('');
                
                // Fast Translation Frame 1
                const codons: any = {
                    'ATA':'I', 'ATC':'I', 'ATT':'I', 'ATG':'M', 'ACA':'T', 'ACC':'T', 'ACG':'T', 'ACT':'T',
                    'AAC':'N', 'AAT':'N', 'AAA':'K', 'AAG':'K', 'AGC':'S', 'AGT':'S', 'AGA':'R', 'AGG':'R',
                    'CTA':'L', 'CTC':'L', 'CTG':'L', 'CTT':'L', 'CCA':'P', 'CCC':'P', 'CCG':'P', 'CCT':'P',
                    'CAC':'H', 'CAT':'H', 'CAA':'Q', 'CAG':'Q', 'CGA':'R', 'CGC':'R', 'CGG':'R', 'CGT':'R',
                    'GTA':'V', 'GTC':'V', 'GTG':'V', 'GTT':'V', 'GCA':'A', 'GCC':'A', 'GCG':'A', 'GCT':'A',
                    'GAC':'D', 'GAT':'D', 'GAA':'E', 'GAG':'E', 'GGA':'G', 'GGC':'G', 'GGG':'G', 'GGT':'G',
                    'TCA':'S', 'TCC':'S', 'TCG':'S', 'TCT':'S', 'TTC':'F', 'TTT':'F', 'TTA':'L', 'TTG':'L',
                    'TAC':'Y', 'TAT':'Y', 'TAA':'*', 'TAG':'*', 'TGC':'C', 'TGT':'C', 'TGA':'*', 'TGG':'W',
                };
                let protein = "";
                for (let i = 0; i < seq.length - 2; i += 3) protein += codons[seq.substring(i, i+3).replace(/U/g, 'T')] || '?';
                data.translation = protein;
            }
        }

        // 7. LIGATION
        if (data.type === 'ligation') {
            const vKb = data.vector_kb || 0; const vNg = data.vector_ng || 0;
            const iKb = data.insert_kb || 0; const ratio = data.ratio || 3;
            if (vKb > 0 && iKb > 0 && vNg > 0) data.insert_ng_needed = (iKb / vKb) * vNg * ratio;
        }

        // 8. PROTOCOL
        if (data.type === 'protocol') {
            if (!data.steps) data.steps = [];
            let completed = 0;
            data.steps.forEach((s: any) => { if (s.done) completed++; });
            data.progress = data.steps.length > 0 ? (completed / data.steps.length) * 100 : 0;
        }

        return data;
    }
}

export class BioElnRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }

    async renderBioBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        
        // Benchling-style Main Card
        wrapper.style.position = "relative"; 
        wrapper.style.border = "1px solid var(--background-modifier-border)"; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.padding = "24px";
        wrapper.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.03)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.style.marginBottom = "15px";

        try {
            let data = parseYaml(source);
            if (!data) throw new Error("Empty YAML Data.");
            data = BioCalculator.calculate(data);

            const greenColor = "#4cae4f";
            const bdColor = "var(--background-modifier-border)";

            // Header (Benchling Style)
            let html = `
            <div style="position: relative; margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: ${greenColor};">${data.title || data.code || 'Biological Protocol'}</h2>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${data.type.replace('_', ' ')}</div>
                    </div>
                </div>
                <div style="height: 2px; background-color: ${greenColor}; margin-top: 12px;"></div>
            </div>`;

            // Inline Editing Helpers 
            const formatNum = (num: any, decimals: number = 2) => {
                const n = Number(num);
                if (isNaN(n) || n === 0) return '-';
                if (n > 1000000 || (n < 0.001 && n > 0)) return n.toExponential(decimals);
                return (n % 1 === 0) ? n.toString() : n.toFixed(decimals);
            };

            const makeEditableTd = (type: string, i: number, key: string, val: any, inputType: 'number'|'text'|'string' = 'number', customHtml?: string, extraStyle="") => {
                let innerHTML = customHtml !== undefined ? customHtml : (inputType === 'number' ? formatNum(val) : (val||'-'));
                let rawValAttr = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<td class="bio-editable" data-type="${type}" data-idx="${i}" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawValAttr}" title="Double-click to edit" style="padding: 12px 10px; cursor: text; border-bottom: 1px solid ${bdColor}; ${extraStyle}">${innerHTML}</td>`;
            };

            const makeEditableRoot = (key: string, val: any, inputType = 'number') => {
                const displayVal = val !== undefined ? (inputType==='number' ? formatNum(val) : val) : '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="bio-editable" data-type="root" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 2px dotted ${greenColor}; font-weight: 700; color: var(--text-normal); padding: 0 2px;">${displayVal}</span>`;
            };

            // ==========================================
            // 1. PCR MODE
            // ==========================================
            if (data.type === 'pcr') {
                html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--background-secondary); padding: 15px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 13px;">
                    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                        <div><span style="color:var(--text-muted); margin-right: 6px;">Reactions:</span> ${makeEditableRoot('reactions', data.reactions)}</div>
                        <div><span style="color:var(--text-muted); margin-right: 6px;">Overage:</span> ${makeEditableRoot('overage_percent', data.overage_percent)} <span style="font-weight:700;">%</span></div>
                        <div><span style="color:var(--text-muted); margin-right: 6px;">Vol/Rxn:</span> ${makeEditableRoot('total_volume_ul', data.total_volume_ul)} <span style="font-weight:700;">µL</span></div>
                    </div>
                    <div style="color:${greenColor}; font-weight:700; font-size: 14px;">Master Mix prepared for: ${data.calculated_reactions?.toFixed(1) || 0} rxns</div>
                </div>`;

                html += `<div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Component</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Stock</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Final</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: ${greenColor};">1x Rxn (µL)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 700; color: ${greenColor};">Master Mix (µL)</th>
                    </tr>`;
                
                data.components.forEach((c: any, i: number) => {
                    const isSeparate = c.add_to_mm_separately ? `<span style="font-size:9px; color:var(--text-warning); border:1px solid var(--text-warning); padding:2px 4px; border-radius:4px; margin-left:6px;">ADD SEP</span>` : '';
                    html += `<tr>
                        ${makeEditableTd('components', i, 'name', c.name, 'text', (c.name||'') + isSeparate, "font-weight:600; color:var(--text-normal);")}
                        ${makeEditableTd('components', i, 'stock', c.stock, 'text')}
                        ${makeEditableTd('components', i, 'final', c.final, 'text')}
                        ${makeEditableTd('components', i, 'volume_ul', c.volume_ul, 'number')}
                        <td style="padding: 12px 10px; font-weight:700; color:var(--text-normal); border-bottom: 1px solid ${bdColor}; font-size: 15px;">${c.mm_volume_ul !== undefined && !c.add_to_mm_separately ? c.mm_volume_ul.toFixed(1) : '<span style="color:var(--text-muted); font-weight:normal;">-</span>'}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 2. BUFFER / RECIPE MODE
            // ==========================================
            else if (data.type === 'buffer') {
                html += `
                <div style="display: flex; gap: 24px; background: var(--background-secondary); padding: 15px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 13px;">
                    <div><span style="color:var(--text-muted); margin-right: 6px;">Target Volume (L):</span> ${makeEditableRoot('volume_L', data.volume_L)}</div>
                    <div><span style="color:var(--text-muted); margin-right: 6px;">Target pH:</span> ${makeEditableRoot('ph', data.ph, 'text')}</div>
                </div>`;

                html += `<div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Reagent</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">MW (g/mol)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Target Conc.</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 700; color: ${greenColor};">Mass to Weigh (g)</th>
                    </tr>`;
                
                data.components.forEach((c: any, i: number) => {
                    const concStr = c.target_M ? `${c.target_M} M` : (c.target_mg_ml ? `${c.target_mg_ml} mg/mL` : '-');
                    html += `<tr>
                        ${makeEditableTd('components', i, 'name', c.name, 'text', c.name, "font-weight:600; color:var(--text-normal);")}
                        ${makeEditableTd('components', i, 'mw', c.mw, 'number')}
                        ${makeEditableTd('components', i, 'target_M', c.target_M, 'number', concStr)}
                        <td style="padding: 12px 10px; font-weight:700; color:var(--text-normal); border-bottom: 1px solid ${bdColor}; font-size: 15px;">${c.mass_g ? c.mass_g.toFixed(3) : '-'}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 3. CELL SEEDING CALCULATOR
            // ==========================================
            else if (data.type === 'cell_seeding') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px;">Current Conc (cells/mL)</div>
                        <div style="font-size:20px;">${makeEditableRoot('current_cells_per_ml', data.current_cells_per_ml)}</div>
                    </div>
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px;">Target per Well</div>
                        <div style="font-size:20px;">${makeEditableRoot('target_cells_per_well', data.target_cells_per_well)}</div>
                    </div>
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px;">Number of Wells</div>
                        <div style="font-size:20px;">${makeEditableRoot('wells', data.wells)}</div>
                    </div>
                </div>

                <div style="background: var(--background-primary); border: 2px solid ${greenColor}; border-radius: 8px; padding: 20px;">
                    <h4 style="margin: 0 0 15px 0; color: ${greenColor}; text-align: center;">Preparation Required</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px; max-width: 300px; margin: 0 auto;">
                        <div style="color:var(--text-muted);">Cell Suspension:</div><div style="font-weight:bold; text-align:right;">${formatNum(data.cell_suspension_vol_ml)} mL</div>
                        <div style="color:var(--text-muted);">Fresh Media:</div><div style="font-weight:bold; text-align:right;">${formatNum(data.media_to_add_ml)} mL</div>
                        <div style="border-top: 1px dashed var(--background-modifier-border); padding-top: 10px; margin-top:5px; font-weight:bold;">Total Master Mix:</div>
                        <div style="border-top: 1px dashed var(--background-modifier-border); padding-top: 10px; margin-top:5px; font-weight:bold; color:${greenColor}; text-align:right;">${formatNum(data.total_media_needed_ml)} mL</div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 4. NGS LIBRARY POOLING
            // ==========================================
            else if (data.type === 'ngs_pooling') {
                html += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: var(--background-secondary); padding: 15px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 13px;">
                    <div style="display: flex; gap: 24px;">
                        <div><span style="color:var(--text-muted); margin-right: 6px;">Target per Sample (fmol):</span> ${makeEditableRoot('target_fmol_per_sample', data.target_fmol_per_sample)}</div>
                    </div>
                    <div style="color:${greenColor}; font-weight:700; font-size: 14px;">Total Pool Volume: ${formatNum(data.total_pool_vol_ul)} µL</div>
                </div>`;

                html += `
                <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Library Name</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Length (bp)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Conc (ng/µL)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Calc. Molarity</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 700; color: ${greenColor};">Vol to Pool (µL)</th>
                    </tr>`;
                
                data.samples.forEach((s: any, i: number) => {
                    html += `<tr>
                        ${makeEditableTd('samples', i, 'name', s.name, 'text', s.name, "font-weight:600; color:var(--text-normal);")}
                        ${makeEditableTd('samples', i, 'length_bp', s.length_bp, 'number')}
                        ${makeEditableTd('samples', i, 'conc_ng_ul', s.conc_ng_ul, 'number')}
                        <td style="padding: 12px 10px; color:var(--text-muted); border-bottom: 1px solid ${bdColor};">${formatNum(s.conc_nM)} nM</td>
                        <td style="padding: 12px 10px; font-weight:700; color:var(--text-normal); border-bottom: 1px solid ${bdColor}; font-size: 15px;">${formatNum(s.pool_vol_ul)}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 5. PROTEIN QUANTIFICATION (A280)
            // ==========================================
            else if (data.type === 'protein_quant') {
                html += `
                <div style="background: var(--background-secondary); padding: 15px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 13px;">
                    <span style="color:var(--text-muted); margin-right: 6px;">Cuvette Path Length (cm):</span> ${makeEditableRoot('path_length_cm', data.path_length_cm)}
                </div>`;

                html += `
                <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
                    <tr>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Protein Name</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Abs (A280)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Ext. Coeff</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">MW (kDa)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 600; color: var(--text-normal);">Conc. (µM)</th>
                        <th style="padding: 10px; border-bottom: 1px solid ${bdColor}; font-weight: 700; color: ${greenColor};">mg/mL</th>
                    </tr>`;
                
                data.samples.forEach((s: any, i: number) => {
                    const mwDisplay = s.mw ? (s.mw/1000).toFixed(1) : '-'; 
                    html += `<tr>
                        ${makeEditableTd('samples', i, 'name', s.name, 'text', s.name, "font-weight:600; color:var(--text-normal);")}
                        ${makeEditableTd('samples', i, 'A280', s.A280, 'number')}
                        ${makeEditableTd('samples', i, 'ext_coeff', s.ext_coeff, 'number')}
                        ${makeEditableTd('samples', i, 'mw', s.mw, 'number', mwDisplay)}
                        <td style="padding: 12px 10px; font-weight:600; color:var(--text-normal); border-bottom: 1px solid ${bdColor};">${formatNum(s.conc_uM)}</td>
                        <td style="padding: 12px 10px; font-weight:700; color:${greenColor}; border-bottom: 1px solid ${bdColor}; font-size: 15px;">${formatNum(s.conc_mg_ml)}</td>
                    </tr>`;
                });
                html += `</table></div>`;
            }

            // ==========================================
            // 6. OLIGO ANALYZER
            // ==========================================
            else if (data.type === 'oligo_analyzer') {
                html += `
                <div style="margin-bottom: 20px; font-size: 13px; background: var(--background-secondary); padding: 15px; border-radius: 8px; border-left: 4px solid ${greenColor};">
                    <div style="color:var(--text-muted); font-size:11px; margin-bottom:6px; text-transform:uppercase; font-weight:600;">Sequence (5' → 3')</div>
                    <div style="font-family: monospace; font-size: 16px; word-break: break-all; color: var(--text-normal); line-height: 1.5; letter-spacing: 1px;">${makeEditableRoot('sequence', data.sequence, 'text')}</div>
                </div>`;

                if (data.length > 0) {
                    html += `
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px;">
                        <div style="background: var(--background-primary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border); text-align:center;">
                            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Length</div>
                            <div style="font-size:20px; font-weight:bold; color:var(--text-normal); margin-top:4px;">${data.length} <span style="font-size:12px; color:var(--text-muted);">bp</span></div>
                        </div>
                        <div style="background: var(--background-primary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border); text-align:center;">
                            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">GC Content</div>
                            <div style="font-size:20px; font-weight:bold; color:var(--text-normal); margin-top:4px;">${data.gc_percent.toFixed(1)} <span style="font-size:12px; color:var(--text-muted);">%</span></div>
                        </div>
                        <div style="background: var(--background-primary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border); text-align:center;">
                            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Melting Temp (Tm)</div>
                            <div style="font-size:20px; font-weight:bold; color:${greenColor}; margin-top:4px;">${data.tm.toFixed(1)} <span style="font-size:12px; color:var(--text-muted);">°C</span></div>
                        </div>
                        <div style="background: var(--background-primary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border); text-align:center;">
                            <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Mol. Weight</div>
                            <div style="font-size:20px; font-weight:bold; color:var(--text-normal); margin-top:4px;">${Math.round(data.mw)} <span style="font-size:12px; color:var(--text-muted);">g/mol</span></div>
                        </div>
                    </div>
                    
                    <div style="background: var(--background-secondary-alt); padding: 15px; border-radius: 8px; font-size:13px; font-family: monospace; border: 1px solid var(--background-modifier-border);">
                        <div style="margin-bottom:10px;">
                            <span style="color:var(--text-muted); display:inline-block; width:130px; font-family:var(--font-interface);">Reverse Complement:</span> 
                            <span style="color: var(--text-normal); word-break:break-all; font-weight:bold; letter-spacing: 1px;">3' <span style="color:var(--interactive-accent)">${data.rev_comp}</span> 5'</span>
                        </div>
                        <div>
                            <span style="color:var(--text-muted); display:inline-block; width:130px; font-family:var(--font-interface);">Translation (Frame 1):</span> 
                            <span style="color: var(--text-normal); word-break:break-all; font-weight:bold; letter-spacing: 1px;"><span style="color:var(--text-warning)">${data.translation}</span></span>
                        </div>
                    </div>`;
                }
            }

            // ==========================================
            // 7. LIGATION / CLONING CALCULATOR
            // ==========================================
            else if (data.type === 'ligation') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Vector Size (kb)</div>
                        <div style="font-size:20px;">${makeEditableRoot('vector_kb', data.vector_kb)}</div>
                    </div>
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Vector Mass (ng)</div>
                        <div style="font-size:20px;">${makeEditableRoot('vector_ng', data.vector_ng)}</div>
                    </div>
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Insert Size (kb)</div>
                        <div style="font-size:20px;">${makeEditableRoot('insert_kb', data.insert_kb)}</div>
                    </div>
                    <div style="background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Molar Ratio (I:V)</div>
                        <div style="font-size:20px;">${makeEditableRoot('ratio', data.ratio)} <span style="color:var(--text-muted)">: 1</span></div>
                    </div>
                </div>

                <div style="background: var(--background-primary); border: 2px solid ${greenColor}; border-radius: 8px; padding: 20px; text-align: center;">
                    <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Insert Mass Required</div>
                    <div style="font-size:28px; font-weight:700; color:${greenColor};">${data.insert_ng_needed ? data.insert_ng_needed.toFixed(1) + ' ng' : '-'}</div>
                </div>`;
            }

            // ==========================================
            // 8. INTERACTIVE PROTOCOL (CHECKLIST)
            // ==========================================
            else if (data.type === 'protocol') {
                html += `
                <div style="margin-bottom: 20px; background: var(--background-secondary); padding: 15px; border-radius: 8px; border: 1px solid var(--background-modifier-border);">
                    <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; color:var(--text-normal); margin-bottom:8px;">
                        <span>Protocol Progress</span><span style="color:${greenColor};">${data.progress.toFixed(0)}%</span>
                    </div>
                    <div style="width:100%; background:var(--background-primary-alt); height:8px; border-radius:4px; overflow:hidden;">
                        <div style="width:${data.progress}%; background:${greenColor}; height:100%; transition:width 0.3s ease;"></div>
                    </div>
                </div>`;

                html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
                data.steps.forEach((s: any, i: number) => {
                    const isDone = s.done === true || s.done === "true";
                    const bg = isDone ? 'var(--background-secondary)' : 'var(--background-primary)';
                    const opacity = isDone ? '0.5' : '1';
                    const textDec = isDone ? 'line-through' : 'none';
                    
                    const checkSVG = isDone 
                        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="${greenColor}" stroke="${greenColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><polyline points="9 12 12 15 17 9" stroke="white"></polyline></svg>`
                        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;

                    html += `
                    <div class="bio-protocol-step" data-idx="${i}" data-state="${isDone ? 'true' : 'false'}" style="display:flex; align-items:flex-start; gap:14px; background:${bg}; padding:14px; border-radius:8px; border:1px solid var(--background-modifier-border); cursor:pointer; opacity:${opacity}; transition:all 0.2s ease;">
                        <div style="margin-top:2px;">${checkSVG}</div>
                        <div style="font-size:14px; text-decoration:${textDec}; color:var(--text-normal); line-height: 1.5;">${s.text}</div>
                    </div>`;
                });
                html += `</div>`;
            }

            // Fallback
            else {
                html += `<div style="padding: 20px; font-family: monospace; font-size:12px;">Data loaded for ${data.type}</div>`;
            }

            html += `</div>`; // End main wrapper
            
            // --- EVENT LISTENERS ---

            // Hover effects via CSS injection
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `
                .bio-editable:hover { background-color: rgba(76, 174, 79, 0.1); border-radius: 4px; }
                .bio-protocol-step:hover { border-color: ${greenColor} !important; transform: translateX(2px); }
            `;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

            // Double-Click Inline Editing
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('bio-editable')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('bio-editable') && !target.querySelector('input')) {
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
                    input.type = inputType === 'text' || inputType === 'string' ? 'text' : 'number';
                    if (inputType === 'number') input.step = "any";
                    input.value = currentValText;
                    Object.assign(input.style, { width: "100%", boxSizing: "border-box", padding: "4px 6px", border: `2px solid ${greenColor}`, borderRadius: "4px", background: "var(--background-primary)", fontSize: "inherit", fontWeight: "inherit", color: "var(--text-normal)" });
                    
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
                                
                                yamlObj = BioCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { target.innerHTML = originalHTML; }
                        } else { target.innerHTML = originalHTML; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; } };
                }
            });

            // Protocol Checkbox Listener
            if (data.type === 'protocol') {
                const steps = contentDiv.querySelectorAll('.bio-protocol-step');
                steps.forEach(stepNode => {
                    stepNode.addEventListener('click', (e) => {
                        const elNode = stepNode as HTMLElement;
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
                                yamlObj.steps[idx].done = !currentState;
                                yamlObj = BioCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) {}
                        }
                    });
                });
            }

            // Action Bar for Biologists
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { position: "absolute", top: "15px", right: "15px", display: "flex", gap: "8px", zIndex: "10" });
            
            const createActionBarBtn = (text: string, onClick: () => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 10px"; btn.style.fontWeight = "600";
                btn.style.backgroundColor = "transparent"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-muted)"; btn.style.borderRadius = "4px";
                btn.onmouseover = () => { btn.style.borderColor = greenColor; btn.style.color = greenColor; };
                btn.onmouseout = () => { btn.style.borderColor = "var(--background-modifier-border)"; btn.style.color = "var(--text-muted)"; };
                btn.onclick = onClick; return btn;
            };

            if (data.type === 'oligo_analyzer' && data.sequence) {
                createActionBarBtn("🔍 BLAST", () => window.open(`https://blast.ncbi.nlm.nih.gov/Blast.cgi?PAGE=Nucleotides&QUERY=${data.sequence}`, '_blank'));
                createActionBarBtn("📄 FASTA", () => {
                    navigator.clipboard.writeText(`>${data.title || 'Sequence'}\n${data.sequence}`);
                    new Notice("Copied as FASTA format!");
                });
            } else if (data.type === 'pcr') {
                createActionBarBtn("🌡️ NEB Tm Calc", () => window.open(`https://tmcalculator.neb.com/`, '_blank'));
            }

            // Generic copy button
            createActionBarBtn("📋 Copy Table", () => {
                let txt = "";
                if (data.type === 'pcr') {
                    txt = "Component\tStock\tFinal\t1x (uL)\tMM (uL)\n";
                    data.components.forEach((c:any) => txt += `${c.name||'-'}\t${c.stock||'-'}\t${c.final||'-'}\t${c.volume_ul?.toFixed(2)||'-'}\t${c.mm_volume_ul?.toFixed(1)||'-'}\n`);
                } else if (data.type === 'buffer') {
                    txt = "Component\tTarget Conc\tMass (g)\n";
                    data.components.forEach((c:any) => txt += `${c.name||'-'}\t${c.target_M ? c.target_M+' M' : (c.target_mg_ml ? c.target_mg_ml+' mg/mL' : '-')}\t${c.mass_g?.toFixed(3)||'-'}\n`);
                } else if (data.type === 'ngs_pooling') {
                    txt = "Sample\tLength (bp)\tConc (ng/uL)\tMolarity (nM)\tVol to Pool (uL)\n";
                    data.samples.forEach((s:any) => txt += `${s.name||'-'}\t${s.length_bp||'-'}\t${s.conc_ng_ul||'-'}\t${s.conc_nM?.toFixed(2)||'-'}\t${s.pool_vol_ul?.toFixed(2)||'-'}\n`);
                } else if (data.type === 'protein_quant') {
                    txt = "Protein\tA280\tConc (uM)\tConc (mg/mL)\n";
                    data.samples.forEach((s:any) => txt += `${s.name||'-'}\t${s.A280||'-'}\t${s.conc_uM?.toFixed(2)||'-'}\t${s.conc_mg_ml?.toFixed(2)||'-'}\n`);
                } else if (data.type === 'protocol') {
                    txt = `Protocol: ${data.title}\n`;
                    data.steps.forEach((s:any, i:number) => txt += `${i+1}. [${s.done ? 'x' : ' '}] ${s.text}\n`);
                }
                navigator.clipboard.writeText(txt);
                new Notice("Copied to clipboard!");
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Bio ELN Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}
// OrganicHelpers.ts
import { App, MarkdownView, Notice, Menu } from 'obsidian';

export class OrgHelperCalculator {
    static calculate(data: any) {
        if (!data.type) return data;

        // 1. NMR YIELD CALCULATOR
        if (data.type === 'nmr_yield') {
            const stdMass = data.standard_mass_mg || 0; const stdMw = data.standard_mw || 1;
            const stdInt = data.standard_integral || 1; const stdH = data.standard_protons || 1;
            const prodMw = data.product_mw || 1; const prodInt = data.product_integral || 0;
            const prodH = data.product_protons || 1; const theoryMmol = data.theory_mmol || 1;

            const stdMmol = stdMass / stdMw;
            const normStdInt = stdInt / stdH;
            const normProdInt = prodInt / prodH;

            if (normStdInt > 0) {
                data.product_mmol = stdMmol * (normProdInt / normStdInt);
                data.product_mass_mg = data.product_mmol * prodMw;
                data.yield_percent = (data.product_mmol / theoryMmol) * 100;
            } else {
                data.product_mmol = 0; data.product_mass_mg = 0; data.yield_percent = 0;
            }
        }

        // 2. FARADAIC EFFICIENCY CALCULATOR
        if (data.type === 'faradaic_efficiency') {
            const mA = data.current_mA || 0; const h = data.time_hours || 0;
            const z = data.electrons_z || 2; const prodMmol = data.product_mmol || 0;
            data.total_coulombs = mA * h * 3.6;
            data.theory_max_mmol = ((data.total_coulombs / 96485) / z) * 1000;
            data.faradaic_efficiency = data.theory_max_mmol > 0 ? (prodMmol / data.theory_max_mmol) * 100 : 0;
        }

        // 3. CATALYST METRICS (TON/TOF)
        if (data.type === 'catalyst_metrics') {
            const pMmol = data.product_mmol || 0; const cMmol = data.catalyst_mmol || 1; const t = data.time_hours || 1;
            data.ton = pMmol / cMmol;
            data.tof = data.ton / t;
        }

        // 4. ORGANOMETALLIC TITRATION
        if (data.type === 'titration') {
            const stdMass = data.standard_mass_mg || 0; const stdMw = data.standard_mw || 1;
            const volUsed = data.titrant_vol_ml || 0; const ratio = data.stoichiometry_ratio || 1; 
            data.molarity = (stdMw > 0 && volUsed > 0) ? ((stdMass / stdMw) * ratio) / volUsed : 0;
        }

        // 5. CHROMATOGRAPHY CV CALCULATOR
        if (data.type === 'chromatography') {
            const rf1 = data.rf_product || 0; const rf2 = data.rf_impurity || 0;
            const d = data.column_diameter_cm || 0; const h = data.silica_height_cm || 0;

            if (rf1 > 0 && rf2 > 0) {
                data.delta_cv = Math.abs((1 / rf1) - (1 / rf2));
                if (data.delta_cv > 0.4) data.difficulty = "Easy (Flash)";
                else if (data.delta_cv > 0.2) data.difficulty = "Moderate";
                else data.difficulty = "Difficult (Slow Gradient)";
            } else { data.delta_cv = 0; data.difficulty = "-"; }
            data.column_volume_ml = (d > 0 && h > 0) ? Math.PI * Math.pow(d/2, 2) * h * 0.65 : 0;
        }

        // 6. GREEN CHEMISTRY METRICS
        if (data.type === 'green_metrics') {
            const reagentsMass = data.total_reagents_mass_g || 0;
            const solventMass = data.total_solvent_mass_g || 0;
            const productMass = data.product_mass_g || 0;
            const targetMw = data.target_product_mw || 0;
            const reactantsMw = data.total_reactants_mw || 0;

            if (productMass > 0) {
                data.pmi = (reagentsMass + solventMass) / productMass;
                data.e_factor = data.pmi - 1; // Simplification: E-Factor = PMI - 1
            } else {
                data.pmi = 0; data.e_factor = 0;
            }
            data.atom_economy = reactantsMw > 0 ? (targetMw / reactantsMw) * 100 : 0;
        }

        // 7. RECRYSTALLIZATION
        if (data.type === 'recrystallization') {
            const crude = data.crude_mass_mg || 0;
            const recovered = data.recovered_mass_mg || 0;
            const vol = data.solvent_vol_ml || 0;

            data.recovery_percent = crude > 0 ? (recovered / crude) * 100 : 0;
            data.concentration = vol > 0 ? crude / vol : 0;
        }

        return data;
    }
}

export class OrganicHelpersRenderer {
    plugin: any;
    constructor(plugin: any) { this.plugin = plugin; }

    async renderBlock(source: string, el: HTMLElement, ctx: any) {
        const { parseYaml, stringifyYaml } = require('obsidian'); 
        
        const wrapper = el.createDiv();
        const themeColor = "#f59e0b"; 
        const bgSec = "var(--background-secondary)";
        const bdColor = "var(--background-modifier-border)";

        wrapper.style.position = "relative"; 
        wrapper.style.border = `1px solid ${bdColor}`; 
        wrapper.style.borderRadius = "12px";
        wrapper.style.backgroundColor = "var(--background-primary)";
        wrapper.style.padding = "24px";
        wrapper.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.03)";
        wrapper.style.fontFamily = "var(--font-interface)";
        wrapper.style.width = "100%";
        wrapper.style.marginBottom = "15px";

        // Reusable SVG Icons
        const icons = {
            zap: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${themeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
            clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
            current: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
            nmrTube: `<svg stroke="${themeColor}" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v18a2 2 0 0 0 4 0V2"/><path d="M8 2h8"/><path d="M10 16h4"/></svg>`,
            column: `<svg stroke="${themeColor}" fill="none" width="32" height="32" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6"/><path d="M10 2v14.5a1.5 1.5 0 0 0 1.5 1.5h1a1.5 1.5 0 0 0 1.5-1.5V2"/><path d="M12 18v4"/></svg>`,
            leaf: `<svg stroke="#10b981" fill="rgba(16,185,129,0.15)" width="32" height="32" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`,
            crystal: `<svg stroke="${themeColor}" fill="rgba(245,158,11,0.15)" width="32" height="32" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13"/><path d="M13 3l3 6-4 13"/></svg>`
        };

        try {
            let data = parseYaml(source);
            if (!data) throw new Error("Empty YAML Data.");
            data = OrgHelperCalculator.calculate(data);

            let html = `
            <div style="position: relative; margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="display:flex; flex-direction:column;">
                        <div class="org-editable" data-type="root" data-key="title" data-input-type="text" data-raw-value="${data.title?.replace(/"/g, '&quot;') || ''}" title="Double-click to edit title" style="margin: 0; font-size: 24px; font-weight: 700; color: ${themeColor}; cursor: text; border-bottom: 2px dotted ${themeColor}; display: inline-block; width: max-content;">${data.title || 'Organic Helper'}</div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${data.type.replace('_', ' ')}</div>
                    </div>
                </div>
                <div style="height: 2px; background-color: ${themeColor}; margin-top: 12px; opacity: 0.5;"></div>
            </div>`;

            const formatNum = (num: any, decimals: number = 2) => {
                const n = Number(num);
                if (isNaN(n) || n === 0) return '-';
                return (n % 1 === 0) ? n.toString() : n.toFixed(decimals);
            };

            const makeEditableRoot = (key: string, val: any, inputType = 'number', unit = "") => {
                const displayVal = val !== undefined ? (inputType==='number' ? formatNum(val, 2) : val) : '-';
                const rawVal = val !== undefined && val !== null ? String(val).replace(/"/g, '&quot;') : "";
                return `<span class="org-editable" data-type="root" data-key="${key}" data-input-type="${inputType}" data-raw-value="${rawVal}" title="Double-click to edit" style="cursor: text; border-bottom: 2px dotted ${themeColor}; font-weight: 700; color: var(--text-normal); padding: 0 2px;">${displayVal}${unit}</span>`;
            };

            // ==========================================
            // 1. NMR YIELD
            // ==========================================
            if (data.type === 'nmr_yield') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px; display:flex; align-items:center; gap:6px;">${icons.nmrTube} Internal Standard</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Name:</span> ${makeEditableRoot('standard_name', data.standard_name, 'text')}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">MW (g/mol):</span> ${makeEditableRoot('standard_mw', data.standard_mw)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Mass added (mg):</span> ${makeEditableRoot('standard_mass_mg', data.standard_mass_mg)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Protons (N):</span> ${makeEditableRoot('standard_protons', data.standard_protons)}
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Integration (I):</span> ${makeEditableRoot('standard_integral', data.standard_integral)}
                        </div>
                    </div>

                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px; display:flex; align-items:center; gap:6px;">${icons.nmrTube} Target Product</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Theory Scale (mmol):</span> ${makeEditableRoot('theory_mmol', data.theory_mmol)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">MW (g/mol):</span> ${makeEditableRoot('product_mw', data.product_mw)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Protons (N):</span> ${makeEditableRoot('product_protons', data.product_protons)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Integration (I):</span> ${makeEditableRoot('product_integral', data.product_integral)}
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Calculated Amount</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.product_mmol ? data.product_mmol.toFixed(3) : '-'} <span style="font-size:14px; color:var(--text-muted); font-weight:500;">mmol</span> &nbsp;<span style="color:var(--background-modifier-border);">|</span>&nbsp; ${data.product_mass_mg ? data.product_mass_mg.toFixed(1) : '-'} <span style="font-size:14px; color:var(--text-muted); font-weight:500;">mg</span></div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">NMR Yield</div>
                        <div style="font-size:32px; font-weight:800; color:${data.yield_percent >= 80 ? 'var(--text-success)' : (data.yield_percent >= 40 ? 'var(--text-warning)' : 'var(--text-error)')};">${data.yield_percent ? data.yield_percent.toFixed(1) + '%' : '-'}</div>
                        <div style="width:100%; background:var(--background-modifier-border); height:6px; border-radius:3px; overflow:hidden; margin-top: 12px;">
                            <div style="width:${Math.min(data.yield_percent || 0, 100)}%; background:${data.yield_percent >= 80 ? 'var(--text-success)' : (data.yield_percent >= 40 ? 'var(--text-warning)' : 'var(--text-error)')}; height:100%; transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 2. FARADAIC EFFICIENCY
            // ==========================================
            else if (data.type === 'faradaic_efficiency') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Product Formed</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('product_mmol', data.product_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.zap}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Electrons (z)</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('electrons_z', data.electrons_z)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">e⁻</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.current}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Current</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('current_mA', data.current_mA)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mA</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center; position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.5;">${icons.clock}</div>
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Time</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('time_hours', data.time_hours)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">h</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Total Charge (Q)</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.total_coulombs ? data.total_coulombs.toFixed(1) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">C</span></div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Theoretical Max</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.theory_max_mmol ? data.theory_max_mmol.toFixed(3) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">mmol</span></div>
                    </div>
                    <div style="flex: 1.5; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Faradaic Efficiency</div>
                        <div style="font-size:32px; font-weight:800; color:${data.faradaic_efficiency >= 80 ? 'var(--text-success)' : (data.faradaic_efficiency >= 40 ? 'var(--text-warning)' : 'var(--text-error)')};">${data.faradaic_efficiency ? data.faradaic_efficiency.toFixed(1) + '%' : '-'}</div>
                        <div style="width:100%; background:var(--background-modifier-border); height:6px; border-radius:3px; overflow:hidden; margin-top: 12px;">
                            <div style="width:${Math.min(data.faradaic_efficiency || 0, 100)}%; background:${data.faradaic_efficiency >= 80 ? 'var(--text-success)' : (data.faradaic_efficiency >= 40 ? 'var(--text-warning)' : 'var(--text-error)')}; height:100%; transition:width 0.3s;"></div>
                        </div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 3. GREEN CHEMISTRY METRICS
            // ==========================================
            else if (data.type === 'green_metrics') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Total Reagents Mass</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('total_reagents_mass_g', data.total_reagents_mass_g)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">g</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Total Solvent Mass</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('total_solvent_mass_g', data.total_solvent_mass_g)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">g</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Product Mass</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('product_mass_g', data.product_mass_g)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">g</span></div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Total Reactants MW</div>
                        <div style="font-size:20px; font-weight:bold;">${makeEditableRoot('total_reactants_mw', data.total_reactants_mw)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">g/mol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Target Product MW</div>
                        <div style="font-size:20px; font-weight:bold;">${makeEditableRoot('target_product_mw', data.target_product_mw)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">g/mol</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid #10b981; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.1); position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.7;">${icons.leaf}</div>
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Atom Economy</div>
                        <div style="font-size:32px; font-weight:800; color:#10b981;">${data.atom_economy ? data.atom_economy.toFixed(1) + '%' : '-'}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid #10b981; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Process Mass Intensity</div>
                        <div style="font-size:32px; font-weight:800; color:var(--text-normal);">${data.pmi ? data.pmi.toFixed(2) : '-'}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid #10b981; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">E-Factor</div>
                        <div style="font-size:32px; font-weight:800; color:var(--text-normal);">${data.e_factor ? data.e_factor.toFixed(2) : '-'}</div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 4. RECRYSTALLIZATION
            // ==========================================
            else if (data.type === 'recrystallization') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Crude Mass</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('crude_mass_mg', data.crude_mass_mg)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mg</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Solvent Volume</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('solvent_vol_ml', data.solvent_vol_ml)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mL</span></div>
                        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${makeEditableRoot('solvent_name', data.solvent_name, 'text')}</div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Recovered Mass</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('recovered_mass_mg', data.recovered_mass_mg)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mg</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1); position:relative;">
                        <div style="position:absolute; top:10px; left:10px; opacity:0.7;">${icons.crystal}</div>
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Recovery</div>
                        <div style="font-size:32px; font-weight:800; color:${data.recovery_percent >= 70 ? 'var(--text-success)' : (data.recovery_percent >= 40 ? 'var(--text-warning)' : 'var(--text-error)')};">${data.recovery_percent ? data.recovery_percent.toFixed(1) + '%' : '-'}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Concentration</div>
                        <div style="font-size:32px; font-weight:800; color:var(--text-normal);">${data.concentration ? data.concentration.toFixed(1) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">mg/mL</span></div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 5. CATALYST METRICS (TON/TOF)
            // ==========================================
            else if (data.type === 'catalyst_metrics') {
                html += `
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Product Formed</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('product_mmol', data.product_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Catalyst Loading</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('catalyst_mmol', data.catalyst_mmol)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">mmol</span></div>
                    </div>
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px; text-align: center;">
                        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:600;">Time</div>
                        <div style="font-size:24px; font-weight:bold;">${makeEditableRoot('time_hours', data.time_hours)} <span style="font-size:12px; color:var(--text-muted); font-weight:normal;">h</span></div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Turnover Number (TON)</div>
                        <div style="font-size:32px; font-weight:800; color:var(--text-normal);">${data.ton ? data.ton.toLocaleString(undefined, {maximumFractionDigits: 1}) : '-'}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Turnover Frequency (TOF)</div>
                        <div style="font-size:32px; font-weight:800; color:${themeColor};">${data.tof ? data.tof.toLocaleString(undefined, {maximumFractionDigits: 2}) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">h⁻¹</span></div>
                    </div>
                </div>`;
            }

            // ==========================================
            // 6. TITRATION
            // ==========================================
            else if (data.type === 'titration') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--text-normal); font-size: 13px;">Titration Standard</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Name:</span> ${makeEditableRoot('standard_name', data.standard_name, 'text')}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">MW (g/mol):</span> ${makeEditableRoot('standard_mw', data.standard_mw)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Mass used (mg):</span> ${makeEditableRoot('standard_mass_mg', data.standard_mass_mg)}
                        </div>
                    </div>

                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--text-normal); font-size: 13px;">Titrant</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Reagent:</span> ${makeEditableRoot('titrant_name', data.titrant_name, 'text')}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Volume added (mL):</span> ${makeEditableRoot('titrant_vol_ml', data.titrant_vol_ml)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Stoichiometry Ratio:</span> ${makeEditableRoot('stoichiometry_ratio', data.stoichiometry_ratio)}
                        </div>
                    </div>
                </div>

                <div style="background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                    <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 8px; font-weight:700;">Calculated Molarity</div>
                    <div style="font-size:32px; font-weight:800; color:${themeColor};">${data.molarity ? data.molarity.toFixed(3) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">M</span></div>
                </div>`;
            }

            // ==========================================
            // 7. CHROMATOGRAPHY
            // ==========================================
            else if (data.type === 'chromatography') {
                html += `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px;">TLC Retention Factors</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Product Rf:</span> ${makeEditableRoot('rf_product', data.rf_product)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Closest Impurity Rf:</span> ${makeEditableRoot('rf_impurity', data.rf_impurity)}
                        </div>
                    </div>

                    <div style="background: ${bgSec}; border: 1px solid ${bdColor}; border-radius: 8px; padding: 15px;">
                        <h4 style="margin: 0 0 15px 0; color: var(--text-normal); font-size: 14px; display:flex; align-items:center; gap:6px;">${icons.column} Column Dimensions</h4>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Diameter (cm):</span> ${makeEditableRoot('column_diameter_cm', data.column_diameter_cm)}
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
                            <span style="color:var(--text-muted); font-weight:600;">Silica Height (cm):</span> ${makeEditableRoot('silica_height_cm', data.silica_height_cm)}
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 15px;">
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Separation (ΔCV)</div>
                        <div style="font-size:26px; font-weight:800; color:var(--text-normal);">${data.delta_cv ? data.delta_cv.toFixed(2) : '-'}</div>
                        <div style="font-size:12px; color:${data.delta_cv > 0.4 ? 'var(--text-success)' : (data.delta_cv > 0.2 ? 'var(--text-warning)' : 'var(--text-error)')}; font-weight:600; margin-top:8px;">${data.difficulty}</div>
                    </div>
                    <div style="flex: 1; background: var(--background-primary); border: 2px solid ${themeColor}; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.1);">
                        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; margin-bottom: 12px; font-weight:700;">Column Volume (CV)</div>
                        <div style="font-size:26px; font-weight:800; color:${themeColor};">${data.column_volume_ml ? data.column_volume_ml.toFixed(0) : '-'} <span style="font-size:16px; color:var(--text-muted); font-weight:500;">mL</span></div>
                    </div>
                </div>`;
            }

            html += `</div>`; // End main wrapper
            
            // --- EVENT LISTENERS ---
            const styleBlock = document.createElement("style");
            styleBlock.innerHTML = `.org-editable:hover { background-color: rgba(245, 158, 11, 0.1); border-radius: 4px; }`;
            wrapper.appendChild(styleBlock);

            const contentDiv = document.createElement("div");
            contentDiv.innerHTML = html;
            wrapper.appendChild(contentDiv);

            // Double-Click Inline Editing
            wrapper.addEventListener('dblclick', (e) => {
                let target = e.target as HTMLElement;
                while (target && target !== wrapper && !target.classList.contains('org-editable')) { target = target.parentElement as HTMLElement; }

                if (target && target.classList.contains('org-editable') && !target.querySelector('input')) {
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
                                
                                yamlObj = OrgHelperCalculator.calculate(yamlObj);
                                const newYaml = stringifyYaml(yamlObj);
                                view.editor.replaceRange(newYaml, {line: info.lineStart + 1, ch: 0}, {line: info.lineEnd, ch: 0});
                            } catch (err) { target.innerHTML = originalHTML; }
                        } else { target.innerHTML = originalHTML; }
                    };

                    input.onblur = finishEdit;
                    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); else if (ev.key === 'Escape') { target.innerHTML = originalHTML; } };
                }
            });

            // Action Bar (Excel Copy Output)
            const actionBar = wrapper.createDiv();
            Object.assign(actionBar.style, { position: "absolute", top: "15px", right: "15px", display: "flex", gap: "8px", zIndex: "10" });
            
            const createActionBarBtn = (text: string, onClick: () => void) => {
                const btn = actionBar.createDiv();
                btn.innerHTML = text; btn.style.cursor = "pointer";
                btn.style.fontSize = "11px"; btn.style.padding = "4px 10px"; btn.style.fontWeight = "600";
                btn.style.backgroundColor = "transparent"; btn.style.border = "1px solid var(--background-modifier-border)";
                btn.style.color = "var(--text-muted)"; btn.style.borderRadius = "4px";
                btn.onmouseover = () => { btn.style.borderColor = themeColor; btn.style.color = themeColor; };
                btn.onmouseout = () => { btn.style.borderColor = "var(--background-modifier-border)"; btn.style.color = "var(--text-muted)"; };
                btn.onclick = onClick; return btn;
            };

            createActionBarBtn("📋 Copy Data", () => {
                let txt = "";
                if (data.type === 'nmr_yield') {
                    txt = `Parameter\tValue\nInternal Standard\t${data.standard_name || '-'}\nStandard Mass (mg)\t${data.standard_mass_mg}\nTheory (mmol)\t${data.theory_mmol}\nCalculated Amount (mmol)\t${data.product_mmol?.toFixed(3)}\nCalculated Amount (mg)\t${data.product_mass_mg?.toFixed(1)}\nNMR Yield (%)\t${data.yield_percent?.toFixed(1)}\n`;
                } else if (data.type === 'faradaic_efficiency') {
                    txt = `Parameter\tValue\nProduct Formed (mmol)\t${data.product_mmol}\nElectrons (z)\t${data.electrons_z}\nCurrent (mA)\t${data.current_mA}\nTime (h)\t${data.time_hours}\nTotal Charge (C)\t${data.total_coulombs?.toFixed(1)}\nTheoretical Max (mmol)\t${data.theory_max_mmol?.toFixed(3)}\nFaradaic Efficiency (%)\t${data.faradaic_efficiency?.toFixed(1)}\n`;
                } else if (data.type === 'catalyst_metrics') {
                    txt = `Parameter\tValue\nProduct (mmol)\t${data.product_mmol}\nCatalyst (mmol)\t${data.catalyst_mmol}\nTime (h)\t${data.time_hours}\nTON\t${data.ton?.toFixed(1)}\nTOF (h-1)\t${data.tof?.toFixed(2)}\n`;
                } else if (data.type === 'titration') {
                    txt = `Parameter\tValue\nStandard\t${data.standard_name || '-'}\nStandard Mass (mg)\t${data.standard_mass_mg}\nTitrant\t${data.titrant_name || '-'}\nVolume (mL)\t${data.titrant_vol_ml}\nMolarity (M)\t${data.molarity?.toFixed(3)}\n`;
                } else if (data.type === 'chromatography') {
                    txt = `Parameter\tValue\nProduct Rf\t${data.rf_product}\nImpurity Rf\t${data.rf_impurity}\nDelta CV\t${data.delta_cv?.toFixed(2)}\nColumn Volume (mL)\t${data.column_volume_ml?.toFixed(0)}\n`;
                } else if (data.type === 'green_metrics') {
                    txt = `Parameter\tValue\nReagents Mass (g)\t${data.total_reagents_mass_g}\nSolvent Mass (g)\t${data.total_solvent_mass_g}\nProduct Mass (g)\t${data.product_mass_g}\nProcess Mass Intensity (PMI)\t${data.pmi?.toFixed(2)}\nE-Factor\t${data.e_factor?.toFixed(2)}\nAtom Economy (%)\t${data.atom_economy?.toFixed(1)}\n`;
                } else if (data.type === 'recrystallization') {
                    txt = `Parameter\tValue\nCrude Mass (mg)\t${data.crude_mass_mg}\nRecovered Mass (mg)\t${data.recovered_mass_mg}\nRecovery (%)\t${data.recovery_percent?.toFixed(1)}\n`;
                } else {
                    txt = JSON.stringify(data, null, 2);
                }
                navigator.clipboard.writeText(txt);
                new Notice("Data copied to clipboard (Excel ready)!");
            });

            return wrapper;

        } catch (err: any) {
            wrapper.innerHTML = `<div style="padding: 20px; color: var(--text-error); background: var(--background-secondary); border-radius: 8px;"><b>Organic Helper Error:</b><br>${err.message}</div>`;
            return wrapper;
        }
    }
}
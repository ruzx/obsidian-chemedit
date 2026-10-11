// ScriptStore.ts
import { App, Modal, Notice, requestUrl, TFile } from 'obsidian';
import type ChemEditPlugin from './main';

export class ScriptStoreModal extends Modal {
    plugin: ChemEditPlugin;

    constructor(app: App, plugin: ChemEditPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() { await this.renderStore(); }

    async renderStore() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "🧪 ChemEdit Script Store", attr: { style: "margin-bottom: 4px;" } });
        contentEl.createEl("p", { text: "Download community scripts to automate your chemistry workflows. Once installed, assign them to hotkeys in Obsidian Settings.", cls: "color-text-muted", attr: { style: "font-size: 13px; margin-top: 0; margin-bottom: 20px;" } });

        const listContainer = contentEl.createDiv({ attr: { style: "max-height: 50vh; overflow-y: auto; padding-right: 10px;" }});
        listContainer.innerHTML = "<span class='color-text-muted'><i>Loading available scripts... ⏳</i></span>";

        let scripts: any[] = [];

        try {
            const repoUrl = "https://raw.githubusercontent.com/katananananna/chemedit-scripts/main/manifest.json";
            const res = await requestUrl(repoUrl);
            if (res.status === 200) scripts = res.json; 
        } catch (e) {
            console.log("ChemEdit: Could not fetch remote scripts from GitHub. Using local fallbacks.");
        }

        if (scripts.length === 0) {
            
            const mathifyCode = [
                "if (!editor) return;",
                "const cursor = editor.getCursor();",
                "const line = editor.getLine(cursor.line);",
                "const beforeCursor = line.substring(0, cursor.ch);",
                "const words = beforeCursor.split(/\\s+/);",
                "const lastWord = words[words.length - 1];",
                "if (!lastWord || lastWord.length < 2) return;",
                "let tex = lastWord;",
                "tex = tex.replace(/(\\d*[+-])$/, '^{$1}');",
                "tex = tex.replace(/(\\d+)(?![+-])/g, '_{$1}');",
                "editor.replaceRange('$' + tex + '$ ', { line: cursor.line, ch: cursor.ch - lastWord.length }, { line: cursor.line, ch: cursor.ch });"
            ].join('\n');

            const fetchCode = [
                "if (!editor) return;",
                "const selection = editor.getSelection().trim();",
                "if (!selection) { new Notice('Please highlight a chemical name first!'); return; }",
                "new Notice('Fetching data for ' + selection + '...');",
                "try {",
                "    const url = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/' + encodeURIComponent(selection) + '/property/IsomericSMILES,CanonicalSMILES,MolecularWeight,MolecularFormula/JSON';",
                "    const res = await requestUrl(url);",
                "    if (res.status === 200) {",
                "        const p = res.json.PropertyTable.Properties[0];",
                "        const smiles = p.IsomericSMILES || p.CanonicalSMILES || '';",
                "        const text = '**' + selection + '** (Formula: ' + p.MolecularFormula + ', MW: ' + p.MolecularWeight + ')\\n```smiles\\n' + smiles + '\\n```\\n';",
                "        editor.replaceSelection(text);",
                "        new Notice('Data inserted!');",
                "    } else { new Notice('Compound not found.'); }",
                "} catch(e) { new Notice('API Error: ' + e.message); }"
            ].join('\n');

            // NEW OFFLINE SCRIPT: Properties Calculator
            const calcPropsCode = [
                "if (!editor) return;",
                "const smiles = editor.getSelection().trim();",
                "if (!smiles) { new Notice('Highlight a SMILES string first!'); return; }",
                "try {",
                "    const props = api.data.getProperties(smiles);", // Taps directly into your plugin's engine!
                "    if (props && props.mw > 0) {",
                "        const text = `\\n> [!info] Properties\\n> **Formula:** \${props.formula} | **MW:** \${props.mw.toFixed(2)} | **TPSA:** \${props.tpsa ? props.tpsa.toFixed(1) : '-'}`;",
                "        editor.replaceSelection(smiles + text);",
                "        new Notice('Calculated offline!');",
                "    } else {",
                "        new Notice('Invalid SMILES or cannot calculate.');",
                "    }",
                "} catch(e) { new Notice('Error: ' + e.message); }"
            ].join('\n');

            // NEW OFFLINE SCRIPT: Stoichiometry Table
            const stoichCode = [
                "if (!editor) return;",
                "const cursor = editor.getCursor();",
                "const table = `",
                "| Reagent | MW | Eq | mmol | mg | mL |",
                "| :--- | :--- | :--- | :--- | :--- | :--- |",
                "| SM 1 |  | 1.0 |  |  |  |",
                "| SM 2 |  |  |  |  |  |",
                "| Solvent | - | - | - | - |  |",
                "`;",
                "editor.replaceRange(table.trim() + '\\n', cursor);",
                "new Notice('Stoichiometry table inserted!');"
            ].join('\n');

            scripts = [
                {
                    name: "MathifyChem.js",
                    description: "Instantly formats chemical formulas (H2SO4 -> H₂SO₄) and ion charges. Type a formula, press your hotkey, and get perfect LaTeX.",
                    author: "ChemEdit",
                    code: mathifyCode
                },
                {
                    name: "FetchCompoundData.js",
                    description: "Highlight a chemical name in your note (e.g. 'Aspirin') and run this script. It fetches the SMILES, MW, and Formula from PubChem and inserts a structure block.",
                    author: "ChemEdit",
                    code: fetchCode
                },
                {
                    name: "CalculateProperties.js",
                    description: "[OFFLINE] Highlight a SMILES string and press your hotkey. Uses ChemEdit's internal engine to calculate the Formula, MW, and TPSA instantly without an internet connection.",
                    author: "ChemEdit",
                    code: calcPropsCode
                },
                {
                    name: "InsertStoichTable.js",
                    description: "[OFFLINE] Instantly inserts a clean Markdown stoichiometry table at your cursor.",
                    author: "ChemEdit",
                    code: stoichCode
                }
            ];
        }

        listContainer.empty();
        const scriptFolder = this.plugin.settings.scriptsFolder || "ChemEdit/Scripts";

        for (const script of scripts) {
            const item = listContainer.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; margin-bottom: 12px;" }});
            
            const info = item.createDiv({ attr: { style: "display: flex; flex-direction: column; gap: 4px; max-width: 70%;" }});
            info.createDiv({ text: script.name, attr: { style: "font-weight: 700; color: var(--text-accent); font-size: 14px;" }});
            info.createDiv({ text: script.description, attr: { style: "font-size: 12px; color: var(--text-normal); line-height: 1.4;" }});
            info.createDiv({ text: `By ${script.author}`, attr: { style: "font-size: 11px; color: var(--text-muted);" }});

            const btnWrap = item.createDiv({ attr: { style: "display: flex; gap: 8px; align-items: center;" }});
            const installBtn = btnWrap.createEl("button", { text: "Download", cls: "mod-cta", attr: { style: "font-size: 12px; height: 28px;" }});
            
            const filePath = `${scriptFolder}/${script.name}`;
            const isInstalled = await this.app.vault.adapter.exists(filePath);

            if (isInstalled) {
                installBtn.innerText = "🔄 Update";
                installBtn.removeClass("mod-cta");

                const deleteBtn = btnWrap.createEl("button", { text: "🗑️", attr: { title: "Delete Script", style: "background: transparent; border: 1px solid var(--background-modifier-border); box-shadow: none; font-size: 14px; padding: 4px 8px; height: 28px;" }});
                deleteBtn.onclick = async () => {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        await this.app.vault.delete(file);
                        await this.plugin.scriptEngine.loadScripts();
                        new Notice(`Deleted ${script.name}`);
                        this.renderStore();
                    }
                };
            }
            
            installBtn.onclick = async () => {
                installBtn.innerText = "⏳...";
                try {
                    if (!await this.app.vault.adapter.exists(scriptFolder)) await this.app.vault.createFolder(scriptFolder);
                    let codeToSave = script.code || "";
                    if (script.url) {
                        const raw = await requestUrl(script.url);
                        if (raw.status === 200) codeToSave = raw.text;
                    }

                    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
                    if (existingFile instanceof TFile) await this.app.vault.modify(existingFile, codeToSave);
                    else await this.app.vault.create(filePath, codeToSave);
                    
                    await this.plugin.scriptEngine.loadScripts();
                    new Notice(`${script.name} installed!`);
                    this.renderStore();
                } catch (e) {
                    installBtn.innerText = "❌ Error";
                }
            };
        }
    }
    
    onClose() { this.contentEl.empty(); }
}
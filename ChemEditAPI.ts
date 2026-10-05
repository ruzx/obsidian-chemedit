// ChemEditAPI.ts
import { App } from 'obsidian';
import { ChemDataEngine } from './ChemDataEngine';
import { getCompoundLibrary, addCompoundToLibrary, createNewElnExperiment } from './SharedEln';
import type ChemEditPlugin from './main';

export interface ChemEditAPI {
    openEditor: (initialData: string, format: string, onSave: (data: string) => void) => void;
    renderStructure: (data: string, width: number, height: number) => Promise<HTMLElement | null>;
    ketcher: {
        openEditor: (initialData: string, format: string, onSave: (data: string, isFile: boolean, format?: string) => void) => void;
        getHeadless: () => Promise<any>;
        convertFormat: (data: string, outputFormat: string) => Promise<string>;
    };
    data: {
        getProperties: (smilesOrMol: string) => { mw: number, formula: string } | null;
        isSubstructureMatch: (targetSmiles: string, querySmarts: string) => boolean;
        molToSmiles: (mol: string) => string;
    };
    library: {
        getCompounds: () => Promise<Array<{name: string, smiles: string}>>;
        addCompound: (name: string, smiles: string) => Promise<void>;
    };
    eln: { createExperiment: (code: string, targetFolder?: string) => Promise<void>; };
}

export function buildChemEditAPI(plugin: ChemEditPlugin): ChemEditAPI {
    const getKetcherSafely = async () => {
        if (!plugin.headlessKetcher) { plugin.bootHeadlessKetcher(); await new Promise(r => setTimeout(r, 1500)); }
        return plugin.headlessKetcher;
    };
    return {
        openEditor: (data, format, onSave) => plugin.openKetcherModal(data, format, onSave),
        renderStructure: async (data, width, height) => await plugin.renderMoleculeToPreview(data, 'smiles', false, width, height),
        ketcher: {
            openEditor: (data, format, onSave) => plugin.openKetcherModal(data, format, onSave),
            getHeadless: async () => await getKetcherSafely(),
            convertFormat: async (data, outputFormat) => {
                const k = await getKetcherSafely(); await k.setMolecule(data);
                if (outputFormat === 'svg') return await k.generateImage(await k.getKet(), { outputFormat: 'svg' });
                if (outputFormat === 'smiles') return await k.getSmiles(); return await k.getMolfile();
            }
        },
        data: {
            getProperties: (smiles) => ChemDataEngine.getPropertiesFromSmiles(smiles),
            isSubstructureMatch: (target, query) => ChemDataEngine.isSubstructureMatch(target, query),
            molToSmiles: (mol) => ChemDataEngine.molToSmiles(mol)
        },
        library: {
            getCompounds: async () => await getCompoundLibrary(plugin),
            addCompound: async (name, smiles) => await addCompoundToLibrary(plugin, name, smiles)
        },
        eln: {
            createExperiment: async (code, targetFolder) => await createNewElnExperiment(plugin.app, code, targetFolder || plugin.settings.elnDirectory || "/", plugin.settings.elnSections)
        }
    };
}
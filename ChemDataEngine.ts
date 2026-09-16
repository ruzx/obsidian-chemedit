// ChemDataEngine.ts
import * as OCL from 'openchemlib';

export class ChemDataEngine {
    
    static getPropertiesFromSmiles(smiles: string) {
        if (!OCL) return null;
        try {
            let cleanSmiles = smiles.split(' |')[0].trim();
            const s = cleanSmiles.includes('>>') ? cleanSmiles.split('>>')[1] : cleanSmiles;
            
            // OCL Bug #4 Patch: Strip directional stereo bonds before calculating properties 
            // so OpenChemLib doesn't add implicit hydrogens to conjugated rings.
            const sForMw = s.replace(/[\/\\]/g, '');
            
            const mol = OCL.Molecule.fromSmiles(sForMw);
            return ChemDataEngine.extractProps(mol);
        } catch (e) {
            return null; // Fails here if it hits complex transition metals like Pd/Fe
        }
    }

    static getPropertiesFromMolblock(molblock: string) {
        if (!OCL) return null;
        try {
            const mol = OCL.Molecule.fromMolfile(molblock);
            return ChemDataEngine.extractProps(mol);
        } catch (e) {
            return null;
        }
    }

    private static extractProps(mol: any) {
        const formulaObj = mol.getMolecularFormula();
        const props = new OCL.MoleculeProperties(mol);
        
        let alerts: string[] = [];
        // Gracefully handle if the Toxicity Predictor isn't bundled
        if ((OCL as any).ToxicityPredictor) {
            const toxicity = new (OCL as any).ToxicityPredictor();
            if (toxicity.assessRisk(mol, (OCL as any).ToxicityPredictor.TYPE_MUTAGENIC) > 0) alerts.push("Mutagenic");
            if (toxicity.assessRisk(mol, (OCL as any).ToxicityPredictor.TYPE_TUMORIGENIC) > 0) alerts.push("Tumorigenic");
            if (toxicity.assessRisk(mol, (OCL as any).ToxicityPredictor.TYPE_IRRITANT) > 0) alerts.push("Irritant");
            if (toxicity.assessRisk(mol, (OCL as any).ToxicityPredictor.TYPE_REPRODUCTIVE_EFFECTIVE) > 0) alerts.push("Reproductive");
        }

        return {
            mw: formulaObj.absoluteWeight,
            formula: formulaObj.formula,
            logp: props.logP,
            tpsa: props.polarSurfaceArea,
            hbd: props.hydrogenDonorCount,
            hba: props.hydrogenAcceptorCount,
            rotatableBonds: props.rotatableBondCount,
            alerts: alerts.length > 0 ? alerts.join(", ") : "None"
        };
    }

    static isSubstructureMatch(targetSmiles: string, querySmilesOrSmarts: string): boolean {
        if (!OCL) return false;
        try {
            if (!targetSmiles || !querySmilesOrSmarts) return false;
            const smilesList = targetSmiles.includes('>>') ? targetSmiles.split('>>').flatMap(s => s.split('.')) : targetSmiles.split('.');

            let queryMol;
            try { 
                const qForMatch = querySmilesOrSmarts.replace(/[\/\\]/g, '');
                queryMol = OCL.Molecule.fromSmiles(qForMatch); 
            } 
            catch(e) { queryMol = OCL.Molecule.fromSmarts(querySmilesOrSmarts); }
            
            queryMol.setFragment(true); 
            const searcher = new OCL.SSSearcher();
            searcher.setFragment(queryMol);

            for (let smi of smilesList) {
                if (!smi) continue;
                try {
                    const cleanSmi = smi.split(' |')[0].trim();
                    const sForMatch = cleanSmi.replace(/[\/\\]/g, '');
                    const targetMol = OCL.Molecule.fromSmiles(sForMatch);
                    searcher.setMolecule(targetMol);
                    if (searcher.isFragmentInMolecule()) return true;
                } catch(err) {}
            }
            return false;
        } catch (e) { return false; }
    }

    static molToSmiles(molBlock: string): string {
        if (!OCL) return "";
        try {
            const mol = OCL.Molecule.fromMolfile(molBlock);
            return mol.toIsomericSmiles();
        } catch (e) { return ""; }
    }
}
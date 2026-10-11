// tests/math.test.ts

// 1. MOCK OBSIDIAN FIRST
vi.mock('obsidian', () => {
    return {
        App: class {},
        Modal: class {},
        Notice: class {},
        MarkdownView: class {},
        TFile: class {},
        Menu: class {},
        FuzzySuggestModal: class {},
        requestUrl: vi.fn()
    };
});

// 2. IMPORT FROM OUR PLUGIN
import { fallbackMW } from '../SharedEln';

describe('Molecular Weight Calculator', () => {
    test('Calculates simple Molecular Weight correctly', () => {
        const water = fallbackMW('O');
        expect(water.mw).toBeGreaterThan(16);
        expect(water.mw).toBeLessThan(18.5);
        expect(water.formula).toBe('Est.');
    });

    test('Calculates complex Molecular Weight correctly', () => {
        const benzene = fallbackMW('c1ccccc1');
        expect(benzene.mw).toBeGreaterThan(78);
        expect(benzene.mw).toBeLessThan(80);
    });

    test('Returns 0 for unknown/empty structures', () => {
        const empty = fallbackMW('');
        expect(empty.mw).toBe(0);
        expect(empty.formula).toBe('Unknown');
    });
});
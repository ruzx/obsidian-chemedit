// tests/fileUtils.test.ts

// The extracted function that we want to test safely
function getUniqueFileName(baseName: string, existingFiles: string[]): string {
    let counter = 1;
    let finalFileName = baseName;
    const pathParts = baseName.split('/');
    const file = pathParts.pop() || baseName;
    const dir = pathParts.length > 0 ? pathParts.join('/') + '/' : '';

    while (existingFiles.includes(finalFileName)) {
        finalFileName = dir + file.replace(/\.([a-zA-Z0-9]+)$/, `-${counter}.$1`);
        counter++;
    }
    return finalFileName;
}

describe('File Utilities', () => {
    test('It should append a number if file exists', () => {
        const existing = ['molecule.mol', 'molecule-1.mol'];
        const result = getUniqueFileName('molecule.mol', existing);
        expect(result).toBe('molecule-2.mol');
    });

    test('It should handle paths correctly', () => {
        const existing = ['Folder/mol.mol'];
        const result = getUniqueFileName('Folder/mol.mol', existing);
        expect(result).toBe('Folder/mol-1.mol');
    });
});
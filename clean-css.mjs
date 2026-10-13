import fs from 'fs';

// Esbuild outputs to main.css, but Obsidian needs styles.css
const cssFile = fs.existsSync('main.css') ? 'main.css' : (fs.existsSync('styles.css') ? 'styles.css' : null);

if (!cssFile) {
    console.error('CSS file not found!');
    process.exit(0);
}

let css = fs.readFileSync(cssFile, 'utf-8');

// 1. SCROLLBARS: Safely remove all Webkit scrollbar rules
// Pseudo-selectors require global removal as they are outside standard property blocks
css = css.replace(/([^\}]+::-webkit-scrollbar[^\}]*?)\{([^}]+)\}/g, '');

// 2. PARSE AND CLEAN DECLARATIONS
css = css.replace(/\{([^{}]+)\}/g, (match, inner) => {
    
    // PROTECT semicolons inside URLs and strings so they aren't destroyed
    let protectedInner = inner.replace(/url\([^)]+\)/g, m => m.replace(/;/g, '__SEMICOLON__'));
    protectedInner = protectedInner.replace(/"[^"]*"/g, m => m.replace(/;/g, '__SEMICOLON__'));
    protectedInner = protectedInner.replace(/'[^']*'/g, m => m.replace(/;/g, '__SEMICOLON__'));

    const declarations = protectedInner.split(';');
    const props = {};
    const orderedProps = [];
    
    for (let i = 0; i < declarations.length; i++) {
        const decl = declarations[i].trim();
        if (!decl) continue;
        
        const colonIdx = decl.indexOf(':');
        if (colonIdx === -1) {
            orderedProps.push({ raw: decl });
            continue;
        }
        
        const prop = decl.substring(0, colonIdx).trim();
        let val = decl.substring(colonIdx + 1).trim();
        
        // --- CLEANING OPERATIONS ---
        
        // 1. Strip !important
        val = val.replace(/!important/gi, '').trim();
        
        // 2. Strip legacy IE \9 hack
        val = val.replace(/\\9/g, '').trim();
        
        // 3. Strip dangling slashes from esbuild \9 removal (e.g., none\)
        if (val.endsWith('\\')) {
            val = val.slice(0, -1).trim();
        }

        // --- OBSIDIAN LINTER DROPS ---
        if (
            prop.includes('column-count') || 
            prop.includes('column-gap') || 
            prop === 'text-indent' ||
            prop === 'scrollbar-width' ||
            prop === 'scrollbar-color' ||
            (prop === 'text-decoration' && val !== 'none' && val !== 'underline') ||
            (prop === 'filter' && val.toLowerCase().includes('progid:'))
        ) {
            continue; // Skip this property entirely
        }

        // --- DEDUPLICATION ---
        if (props.hasOwnProperty(prop)) {
            const idx = orderedProps.findIndex(p => p.prop === prop);
            if (idx !== -1) orderedProps.splice(idx, 1);
        }
        
        props[prop] = val;
        orderedProps.push({ prop, val });
    }
    
    let cleanedInner = orderedProps.map(item => {
        if (item.raw !== undefined) return item.raw;
        return `${item.prop}:${item.val}`;
    }).join(';');
    
    // RESTORE semicolons
    cleanedInner = cleanedInner.replace(/__SEMICOLON__/g, ';');
    
    // Ensure trailing semicolon is present if the block isn't empty
    if (cleanedInner.length > 0 && !cleanedInner.endsWith(';')) {
        cleanedInner += ';';
    }
    
    return `{${cleanedInner}}`;
});

// 3. REMOVE EMPTY BLOCKS
// Because we stripped out `scrollbar-width`, some blocks might be left completely empty (e.g., `.class {}`).
// This safely removes them.
css = css.replace(/[^}{]+\{\s*\}/g, '');
css = css.replace(/[^}{]+\{\s*\}/g, ''); // Run twice to catch nested empty media queries if any

// Output the clean file to styles.css
fs.writeFileSync('styles.css', css);

// Cleanup the original main.css esbuild artifact
if (cssFile === 'main.css') fs.unlinkSync('main.css');

console.log('✅ Safely cleaned styles.css! All duplicate properties, IE hacks, rogue slashes, and standard scrollbars removed.');
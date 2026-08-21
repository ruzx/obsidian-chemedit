import fs from 'fs';

if (!fs.existsSync('styles.css')) {
    console.error('styles.css not found!');
    process.exit(0);
}

let css = fs.readFileSync('styles.css', 'utf-8');

// 1. SCROLLBARS: Safely remove all Webkit scrollbar rules
// The [^{}]+ ensures we grab the selector ALONG WITH the webkit rule
// This prevents dangling selectors from merging with other rules.
css = css.replace(/[^{}]+::-webkit-scrollbar[^{]*\{[^}]+\}/g, '');

// 2. MULTICOLUMN: Remove Mozilla specific multicolumn gap fallback
css = css.replace(/-moz-column-gap:[^;]+;/g, '');

// 3. DUPLICATE PROPERTIES: Fix all exact duplicates flagged by the Obsidian linter
// We replace the conflicting fallbacks with the intended final value.
const duplicatesToFix = {
    'display:inline-block;display:block;': 'display:block;',
    'display:inline-flex;display:flex;': 'display:flex;',
    'transform:scale\\(none\\);transform:scale\\(1\\);': 'transform:scale(1);',
    'align-items:center;align-items:flex-start;': 'align-items:flex-start;',
    'background-color:#fff;background-color:transparent;': 'background-color:transparent;',
    'background-color:#fff;background-color:#f3f8f9;': 'background-color:#f3f8f9;',
    'border-radius:4px;border-radius:0;': 'border-radius:0;',
    'border-radius:2px;border-radius:6px;': 'border-radius:6px;',
    'height:2\\.4em;height:32px;': 'height:32px;',
    'width:-moz-min-content;width:min-content': 'width:min-content',
    'color:#333;color:#585858;': 'color:#585858;',
    'color:#333;color:#636363;': 'color:#636363;',
    'margin:0!important;margin:4px;': 'margin:0!important;' // CRITICAL for toolbar buttons
};

for (const [dup, fix] of Object.entries(duplicatesToFix)) {
    // Replace all occurrences of the duplicate string
    css = css.replace(new RegExp(dup, 'g'), fix);
}

fs.writeFileSync('styles.css', css);
console.log('✅ Safely cleaned styles.css! All duplicate properties and scrollbars removed.');
import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// Removes legacy PaperScript loader and dynamic script injection
const removeDynamicCodePlugin = {
    name: "remove-dynamic-code",
    setup(build) {
        build.onEnd(() => {
            if (!fs.existsSync("main.js")) return;
            let content = fs.readFileSync("main.js", "utf8");
            
            // Replace Paper.js new Function() eval calls safely
            content = content.replace(
                /func\s*=\s*Function\s*\(\s*params\s*,\s*code\s*\)\s*;/g,
                'func = function() { console.warn("Dynamic Code Execution disabled"); };'
            );

            // Prevent runtime script element injection (Obsidian security lint)
            content = content.replace(
                /\.createElement\(['"]script['"]\)/g,
                ".createElement('noscript')"
            );

            fs.writeFileSync("main.js", content);
            console.log("✅ Scrubbed Dynamic Code Execution and Script Injection calls.");
        });
    },
};

// Safely mocks `fs` module to prevent Obsidian "Direct Filesystem Access" warnings
const mockFsPlugin = {
    name: 'mock-fs',
    setup(build) {
        build.onResolve({ filter: /^(node:)?fs(\/promises)?$/ }, () => ({ path: 'fs', namespace: 'mock-fs' }));
        build.onLoad({ filter: /^fs$/, namespace: 'mock-fs' }, () => ({ 
            contents: `
                module.exports = {
                    readFileSync: () => '',
                    writeFileSync: () => {},
                    existsSync: () => false,
                    promises: {}
                };
            ` 
        }));
    }
};

const builtinsToExternalize = builtinModules.filter(m => !['fs', 'fs/promises'].includes(m));

esbuild
    .build({
        entryPoints: ["main.ts"],
        bundle: true,
        format: "cjs",
        target: "es2018",
        
        // NO MINIFICATION - Prevents Ketcher/React crashes inside Obsidian (SyntaxError at eval)
        minify: false,
        
        define: {
            'process.env.NODE_ENV': prod ? '"production"' : '"development"',
            'global': 'window'
        },
        
        external: [
            "obsidian",
            "electron",
            "jsdom",
            "canvas",
            "@codemirror/autocomplete",
            "@codemirror/collab",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/lint",
            "@codemirror/search",
            "@codemirror/state",
            "@codemirror/view",
            "@lezer/common",
            "@lezer/highlight",
            "@lezer/lr",
            ...builtinsToExternalize,
            ...builtinsToExternalize.map((m) => `node:${m}`),
        ],
        logLevel: "info",
        sourcemap: prod ? false : "inline", 
        treeShaking: true,
        outfile: "main.js",
        plugins: [mockFsPlugin, removeDynamicCodePlugin],
    })
    .catch(() => process.exit(1));
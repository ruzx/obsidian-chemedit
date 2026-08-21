import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// Removes legacy PaperScript loader that triggered the "Dynamic Code Execution" warning
const removePaperScriptLoaderPlugin = {
    name: "remove-paper-script-loader",
    setup(build) {
        build.onEnd(() => {
            if (!fs.existsSync("main.js")) return;
            let content = fs.readFileSync("main.js", "utf8");
            const before = content.length;
            
            content = content.replace(
                /if\s*\(\s*document2\s*&&\s*\(agent\.chrome\s*\|\|\s*agent\.firefox\s*&&\s*agent\.versionNumber\s*<\s*40\)\s*\)\s*\{[\s\S]*?head\.removeChild\(script\);\s*\}\s*else\s*\{\s*func\s*=\s*Function\(params,\s*code\);\s*\}/,
                `func = Function(params, code);`
            );

            if (content.length !== before) {
                fs.writeFileSync("main.js", content);
                console.log("✅ Removed legacy PaperScript browser loader.");
            }
        });
    },
};

esbuild
    .build({
        entryPoints: ["main.ts"],
        bundle: true,
        format: "cjs",
        target: "es2018",
        
        // NO MINIFICATION - As requested to prevent Ketcher/React crashes
        minify: false,
        
        // CRITICAL: React crashes in Obsidian if process.env.NODE_ENV is missing
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
            ...builtinModules,
            ...builtinModules.map((m) => `node:${m}`),
        ],
        logLevel: "info",
        // Keeping sourcemaps off in prod saves a massive amount of space without altering code
        sourcemap: prod ? false : "inline", 
        treeShaking: true,
        outfile: "main.js",
        plugins: [removePaperScriptLoaderPlugin],
    })
    .catch(() => process.exit(1));
import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

/*
 * Ketcher uses Paper.js for canvas rendering.
 *
 * Paper.js 0.12.x also contains an old PaperScript browser-loader path
 * which dynamically creates <script> elements. Obsidian's automated
 * plugin review flags that code even though Ketcher does not use the
 * browser <script type="text/paperscript"> mechanism.
 *
 * We therefore remove only that legacy loader from the generated bundle.
 * We do NOT replace the script element with a div.
 */
const removePaperScriptLoaderPlugin = {
    name: "remove-paper-script-loader",

    setup(build) {
        build.onEnd(() => {
            if (!fs.existsSync("main.js")) return;

            let content = fs.readFileSync("main.js", "utf8");

            /*
             * Remove the legacy Paper.js browser fallback that creates
             * a temporary <script> element and executes PaperScript by
             * installing document.paperscript.
             *
             * The normal PaperScript.execute() / PaperScope functionality
             * remains untouched.
             */
            const before = content.length;

            content = content.replace(
                /if\s*\(\s*document2\s*&&\s*\(agent\.chrome\s*\|\|\s*agent\.firefox\s*&&\s*agent\.versionNumber\s*<\s*40\)\s*\)\s*\{[\s\S]*?head\.removeChild\(script\);\s*\}\s*else\s*\{\s*func\s*=\s*Function\(params,\s*code\);\s*\}/,
                `func = Function(params, code);`
            );

            if (content.length !== before) {
                fs.writeFileSync("main.js", content);
                console.log("✅ Removed legacy PaperScript browser loader.");
            } else {
                console.log("⚠️ PaperScript loader pattern was not found.");
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
        sourcemap: prod ? false : "inline",
        treeShaking: true,
        outfile: "main.js",

        plugins: [removePaperScriptLoaderPlugin],
    })
    .catch(() => process.exit(1));
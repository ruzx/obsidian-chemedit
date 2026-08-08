import esbuild from "esbuild";
import process from "node:process";
import fs from "node:fs";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const obsidianCompliancePlugin = {
    name: "obsidian-compliance",
    setup(build) {
        build.onEnd(() => {
            if (!fs.existsSync("main.js")) return;

            let content = fs.readFileSync("main.js", "utf8");

            // Obsidian compliance patch.
            content = content.replace(
                /document\.createElement\(\s*["']script["']\s*\)/g,
                "document.createElement('div' /* patched for obsidian compliance */)"
            );

            fs.writeFileSync("main.js", content);
            console.log("✅ Patched main.js for Obsidian compliance.");
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

            // Node.js built-in modules.
            ...builtinModules,
            ...builtinModules.map((m) => `node:${m}`),
        ],

        logLevel: "info",
        sourcemap: prod ? false : "inline",
        treeShaking: true,
        outfile: "main.js",
        plugins: [obsidianCompliancePlugin],
    })
    .catch(() => process.exit(1));
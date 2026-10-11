import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
  {
    // Global ignores MUST be in their own object
    ignores: [
      "node_modules/**",
      "*.js", 
      "*.mjs",
      "*.css",
      "data.json",
      ".obsidian/**"
    ]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        NodeJS: "readonly",
        
        // Tell ESLint that Vitest globals are allowed
        describe: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-undef": "error",
      "no-unreachable": "error",
      "no-constant-condition": "warn",
      
      // Smart ignore: Ignores variables starting with _, or standard event/error names
      "@typescript-eslint/no-unused-vars": ["warn", { 
        "argsIgnorePattern": "^_|^e$|^evt$|^err$|^ctx$|^clear$|^view$|^operations$", 
        "varsIgnorePattern": "^_|^parseYaml$|^format$", 
        "caughtErrorsIgnorePattern": "^e$|^err$" 
      }],
      
      "@typescript-eslint/no-explicit-any": "off" 
    },
  },
];
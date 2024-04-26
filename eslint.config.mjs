import globals from "globals";
import pluginJs from "@eslint/js";
import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
// import tseslint from "typescript-eslint";


export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  js.configs.recommended,
  // ...tseslint.configs.recommended,
  {
    rules: {
      "indent": [
        "error",
        4,
        {
          "SwitchCase": 1
        }
      ],
      "no-console": "off",
      "no-unused-vars": [
        "error",
        {
          "ignoreRestSiblings": true,
          "argsIgnorePattern": "^_"
        }
      ],
      "no-var": "error",
      "no-trailing-spaces": "error",
      "prefer-const": "error",
      "quotes": [
        "error",
        "single",
        {
          "avoidEscape": true,
          "allowTemplateLiterals": true
        }
      ],
      "semi": [
        "error",
        "always"
      ]
    }
  },
  {
    ignores: ["admin/words.js", "/**/node_modules/*", "node_modules/", "eslint.config.mjs", "**/test/", "main.test.js"],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      parser: babelParser,
      sourceType: "module",
      ecmaVersion: 2020,
      parserOptions: {
        requireConfigFile: false,
        ecmaVersion: 2020,
        allowImportExportEverywhere: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: ["@babel/preset-env"]
        }
      }
    }
  }
];
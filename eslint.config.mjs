import globals from "globals";
import js from "@eslint/js";

export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  js.configs.recommended,
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
  }
];
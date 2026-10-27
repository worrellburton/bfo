// ESLint flat config (ESLint 9+). Runs with `npm run lint`.
//
// Needs these devDependencies: eslint, @eslint/js, typescript-eslint,
// eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals.
//
// Scope: correctness rules on, stylistic churn off. Rules that would fire
// hundreds of times across the existing codebase (`any`, non-null assertions,
// unused catch bindings) are warnings or off; fix them as files are touched.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "build/",
      "node_modules/",
      "ios/",
      "native/",
      ".react-router/",
      "generated/",
      "coverage/",
      ".vercel/",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Shared settings for every TS/JS file.
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
    },
    rules: {
      // Unused code is an error, but `_name` opts out and unused parameters
      // and catch bindings are left alone (hundreds of `catch (e) {}`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-unused-vars": "off",

      // Pervasive in this codebase; not worth a rewrite.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",

      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-useless-escape": "warn",
      "no-case-declarations": "warn",
      "no-control-regex": "warn",
      "no-constant-condition": ["warn", { checkLoops: false }],
      "no-prototype-builtins": "warn",
      "no-async-promise-executor": "warn",
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipJSXText: true }],
      // TypeScript already checks these better than ESLint's scope analysis.
      "no-undef": "off",
      "no-redeclare": "off",
    },
  },

  // React code (the SPA in app/).
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Route modules export loaders/meta/links beside the component.
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "meta",
            "links",
            "headers",
            "loader",
            "clientLoader",
            "action",
            "clientAction",
            "handle",
            "shouldRevalidate",
            "ErrorBoundary",
            "HydrateFallback",
            "Layout",
          ],
        },
      ],
    },
  },

  // Service worker.
  {
    files: ["public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  // Tests.
  {
    files: ["tests/**/*.ts", "**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);

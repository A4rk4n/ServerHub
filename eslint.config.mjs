import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);

// eslint-config-next ships `settings.react.version: "detect"`. Detection in
// eslint-plugin-react 7.37.5 (still its latest release) goes through
// `context.getFilename()`, which ESLint 10 removed, so every react/* rule
// throws before it can run. Resolving the installed React version here is
// exactly what "detect" would have computed, and it never enters the removed
// code path — so all react/* rules stay enabled rather than being switched off
// to buy a green run. Drop this once eslint-plugin-react ships ESLint 10
// support (jsx-eslint/eslint-plugin-react#4022).
const reactVersion = require("react/package.json").version;

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  {
    settings: { react: { version: reactVersion } },
  },
  {
    // eslint-config-next parses these extensions with Next's compiled
    // @babel/eslint-parser, whose scope manager predates ESLint 10 and fails
    // with "scopeManager.addGlobals is not a function". Everything matched
    // here is a plain Node script with no JSX, so the TypeScript parser —
    // already used for .ts/.tsx by the same config, and ESLint 10 ready —
    // parses them equivalently. Drop this once eslint-config-next ships an
    // ESLint 10 compatible parser.
    files: ["**/*.{js,jsx,mjs,mts,cts}"],
    languageOptions: { parser: tsParser },
  },
  {
    // Initial data loading and polling are intentional external synchronizations.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "drizzle/meta/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node ESM helpers (TypeScript files get these from @types/node instead).
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly", console: "readonly", URL: "readonly" },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);

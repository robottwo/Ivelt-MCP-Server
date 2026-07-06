// ESLint flat config: typescript-eslint recommended rules over src + tests,
// with Prettier handling formatting (eslint-config-prettier disables the
// stylistic rules that would fight it).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // The parsers intentionally return null/[] on bad input; empty catch
      // blocks with explanatory comments are part of that style.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow intentionally-unused parameters/vars when prefixed with _.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

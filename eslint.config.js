import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.wrangler/**", "**/*.gen.ts", "**/worker-configuration.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The core package must stay portable so Fiken can lift it into their own stack.
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["cloudflare:*", "@cloudflare/*", "agents", "agents/*", "wrangler"],
              message: "packages/core must not depend on Cloudflare. Define an interface and implement it in apps/cloudflare.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);

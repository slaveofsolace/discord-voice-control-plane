import js from "@eslint/js";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/.wrangler/**", "**/.runtime/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowBoolean: true, allowNumber: true }
      ],
      "security/detect-possible-timing-attacks": "off",
      "security/detect-object-injection": "off"
    }
  },
  {
    files: ["**/*.test.ts", "**/vitest.config.ts", "scripts/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked]
  },
  {
    files: ["packages/security/src/index.ts", "apps/voice-agent/src/managed-rooms.ts"],
    rules: {
      "no-control-regex": "off"
    }
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked]
  }
);

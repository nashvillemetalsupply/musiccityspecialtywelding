import { defineConfig, globalIgnores } from "eslint/config"
import { fixupConfigRules } from "@eslint/compat"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"
import requireSqlCast from "./scripts/eslint-rules/require-sql-cast.mjs"

export default defineConfig([
  ...fixupConfigRules([...nextVitals, ...nextTypeScript]),
  {
    plugins: {
      mcsw: { rules: { "require-sql-cast": requireSqlCast } },
    },
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "mcsw/require-sql-cast": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    ".backups/**",
    ".worktrees/**",
    "next-env.d.ts",
    "components/ui/**",
    "hooks/**",
    "scripts/fixtures/bundle-budget/**",
    "scripts/fixtures/sql-cast/**",
  ]),
])

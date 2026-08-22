import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // mobgov/ é o MVP em Python do MOBGOV, fora do app Next
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "mobgov/**"]),
]);

export default eslintConfig;

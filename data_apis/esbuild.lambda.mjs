/**
 * esbuild.lambda.mjs
 *
 * Bundles Lambda handlers into single self-contained JS files (CommonJS).
 * Copies non-bundleable static assets (swagger.json, mappings) alongside.
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {string} rel */
const root = (rel) => resolve(__dirname, rel);

const sharedConfig = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",          // Lambda nodejs20.x understands CJS; no .mjs wrapper needed
  sourcemap: false,
  minify: false,
  // Keep AWS SDK external — it is provided by the Lambda nodejs20.x runtime.
  // Remove or empty this list only if you want to fully bundle the SDK (larger ZIP).
  external: ["@aws-sdk/*"],
  // tsconfig.json has "baseUrl": "." which causes esbuild to resolve the bare
  // specifier "tsoa" to the local tsoa.json config file instead of the npm
  // package.  Explicitly alias it to the real package entry point.
  alias: {
    tsoa: resolve(__dirname, "node_modules/tsoa/dist/index.js"),
  },
};

// ── Build handlers ─────────────────────────────────────────────────────────
await Promise.all([
  build({
    ...sharedConfig,
    entryPoints: [root("src/lambda-api.ts")],
    outfile: root("dist-lambda/api/index.js"),
  }),
  build({
    ...sharedConfig,
    entryPoints: [root("src/lambda-worker.ts")],
    outfile: root("dist-lambda/worker/index.js"),
  }),
]);

// ── Copy static assets ────────────────────────────────────────────────────
// These files are read at runtime via readFileSync and cannot be inlined by esbuild.
const assets = [
  // swagger.json is read by app.ts on every cold start
  { src: "src/docs/swagger.json",         dest: "dist-lambda/api/src/docs/swagger.json" },
  // mapping JSONs are used by the normalizer registry
  { src: "src/mappings/esg_v1.json",      dest: "dist-lambda/api/src/mappings/esg_v1.json" },
  { src: "src/mappings/housing_v1.json",  dest: "dist-lambda/api/src/mappings/housing_v1.json" },
  { src: "src/mappings/esg_v1.json",      dest: "dist-lambda/worker/src/mappings/esg_v1.json" },
  { src: "src/mappings/housing_v1.json",  dest: "dist-lambda/worker/src/mappings/housing_v1.json" },
];

for (const { src, dest } of assets) {
  const srcPath = root(src);
  const destPath = root(dest);
  if (!existsSync(srcPath)) {
    console.warn(`[esbuild] WARNING: asset not found, skipping: ${src}`);
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}

console.log("[esbuild] Lambda bundles written to dist-lambda/");

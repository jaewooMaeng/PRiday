const esbuild = require("esbuild");

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const extensionConfig = {
  ...shared,
  platform: "node",
  format: "cjs",
  target: "node20",
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode", "web-tree-sitter"],
};

/** @type {import("esbuild").BuildOptions} */
const webviewConfig = {
  ...shared,
  platform: "browser",
  format: "iife",
  target: "es2020",
  entryPoints: ["webview-ui/src/index.tsx"],
  outfile: "webview-dist/bundle.js",
};

async function run() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log("watch mode started");
    return;
  }

  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

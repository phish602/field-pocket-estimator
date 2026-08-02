#!/usr/bin/env node
/*
 * ISO-15I -- TEST-ONLY build for the real-browser vault regression harness.
 *
 * Compiles src/lib/vaultBrowserRegression/browserEntry.js with the repository's
 * existing webpack and babel toolchain. No dependency is installed and no
 * Production entry is touched: the emitted asset is written to a caller-supplied
 * directory OUTSIDE the repository's Production build paths, and the Production
 * bundle (src/index.js -> src/App.js) never references any module compiled here.
 *
 * Usage: node scripts/vault-browser-regression/build-harness.js --out <dir>
 */

// babel-preset-react-app resolves its plugin set from the ambient environment,
// so the harness is compiled with the same production settings the Production
// bundle uses. This also keeps the test-only KDF and test-only override paths in
// vaultCrypto/vaultSession disabled inside the harness.
process.env.NODE_ENV = "production";
process.env.BABEL_ENV = "production";

const path = require("path");
const fs = require("fs");
const webpack = require("webpack");

function outputDirectory() {
  const index = process.argv.indexOf("--out");
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Usage: build-harness.js --out <absolute directory>");
  }
  const value = path.resolve(process.argv[index + 1]);
  if (value.startsWith(path.resolve(__dirname, "..", "..", "build"))
    || value.startsWith(path.resolve(__dirname, "..", "..", "public"))
    || value.startsWith(path.resolve(__dirname, "..", "..", "src"))) {
    throw new Error("Refusing to emit the harness into a Production build path.");
  }
  return value;
}

const repositoryRoot = path.resolve(__dirname, "..", "..");
const outputPath = outputDirectory();
fs.mkdirSync(outputPath, { recursive: true });

fs.copyFileSync(path.join(__dirname, "harness.html"), path.join(outputPath, "index.html"));

const compiler = webpack({
  mode: "production",
  devtool: false,
  entry: path.join(repositoryRoot, "src", "lib", "vaultBrowserRegression", "browserEntry.js"),
  output: {
    path: outputPath,
    filename: "vault-browser-harness.js",
    clean: false,
  },
  resolve: { extensions: [".js", ".mjs", ".json"] },
  module: {
    rules: [{
      test: /\.js$/,
      include: path.join(repositoryRoot, "src"),
      use: {
        loader: require.resolve("babel-loader"),
        options: {
          presets: [[require.resolve("babel-preset-react-app"), { runtime: "automatic" }]],
          babelrc: false,
          configFile: false,
          cacheDirectory: false,
          compact: false,
        },
      },
    }],
  },
  plugins: [
    new webpack.DefinePlugin({ "process.env.PUBLIC_URL": JSON.stringify("") }),
  ],
  performance: false,
  optimization: { minimize: false },
  stats: "errors-warnings",
});

compiler.run((error, stats) => {
  if (error) {
    console.error("HARNESS_BUILD_ERROR", error.message);
    process.exit(1);
  }
  const info = stats.toJson({ errors: true, warnings: true });
  if (stats.hasErrors()) {
    info.errors.forEach((entry) => console.error("HARNESS_BUILD_ERROR", entry.message));
    process.exit(1);
  }
  info.warnings.forEach((entry) => console.warn("HARNESS_BUILD_WARNING", entry.message));
  console.log(`HARNESS_BUILD_OK ${path.join(outputPath, "vault-browser-harness.js")}`);
  compiler.close(() => {});
});

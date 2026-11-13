import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/molkky-fun/" : "/",
  plugins: [react(), {
    name: "molkky-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = ["index.html", ...Object.keys(bundle).filter((file) => file !== "index.html"),
        "manifest.webmanifest", "icons/logo.svg", "icons/wordmark.svg", "icons/icon-192.png", "icons/icon-512.png",
        "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
      const hash = createHash("sha256");
      for (const output of Object.values(bundle)) {
        hash.update(output.type === "chunk" ? output.code : output.source);
      }
      for (const file of files.filter((file) => !bundle[file])) {
        if (file !== "index.html") hash.update(readFileSync(`public/${file}`));
      }
      const source = readFileSync("scripts/sw.js", "utf8")
        .replace("__VERSION__", hash.digest("hex").slice(0, 16))
        .replace("__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  }],
});

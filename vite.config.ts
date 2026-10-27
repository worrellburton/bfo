import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Vendor libraries that get their own, stably named chunk. Everything else
// from node_modules stays with whichever route pulls it in.
const VENDOR_CHUNKS: Array<[name: string, packages: string[]]> = [
  // Loaded on every page: one long-cached chunk for the framework.
  ["react", ["react", "react-dom", "scheduler", "react-router"]],
  // PDF generation, reached only through dynamic import() when a document is
  // built (app/paperwork-generate.ts, app/closing-docs.ts, routes/contract-pdf).
  ["pdf-lib", ["pdf-lib", "@pdf-lib", "pako"]],
  ["jspdf", ["jspdf", "fflate", "fast-png"]],
  ["html2canvas", ["html2canvas"]],
  ["canvg", ["canvg", "rgbcolor", "stackblur-canvas", "svg-pathdata"]],
  // Mail HTML sanitizer (routes/inbox).
  ["dompurify", ["dompurify"]],
];

function vendorChunk(id: string): string | undefined {
  // Vite's virtual helpers (module preload, CommonJS interop) are imported by
  // almost every chunk; keep them with the framework so no route ends up
  // statically depending on a PDF library's chunk just to get a helper. The
  // per-module CommonJS proxies ("\0/.../pako/index.js?commonjs-proxy") stay
  // with the package they wrap, which the node_modules match below handles.
  if (id.startsWith("\0") && !id.includes("?commonjs")) return "react";
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
  if (!m) return;
  const pkg = m[1];
  for (const [name, packages] of VENDOR_CHUNKS) {
    if (packages.some((p) => pkg === p || pkg.startsWith(`${p}/`))) return name;
  }
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  // vitest: the repo's own tests only (Claude Code worktrees under .claude/ carry copies).
  test: { exclude: ["**/node_modules/**", "**/build/**", "**/.claude/**", "**/ios/**", "**/native/**"] },
  build: {
    // Vite's default "assets" folder shares its URL with the /assets
    // (Entities) route: once a chunk named index.* landed in it, the CDN
    // served that script as the folder's index at /assets.
    assetsDir: "static",
    rollupOptions: {
      output: {
        manualChunks(id) {
          return vendorChunk(id);
        },
      },
    },
  },
});

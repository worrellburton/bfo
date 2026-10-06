import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  build: {
    // Vite's default "assets" folder shares its URL with the /assets
    // (Entities) route: once a chunk named index.* landed in it, the CDN
    // served that script as the folder's index at /assets.
    assetsDir: "static",
  },
});

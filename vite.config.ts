import { defineConfig, loadEnv } from "vite";
import path from "path";
import { photoUploadPlugin } from "./server/photoUpload.ts";

export default defineConfig(({ mode }) => {
  // "" prefix loads every variable, including the secret Supabase key (server-side only)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [photoUploadPlugin(env)],
    resolve: {
      alias: {
        kalidokit: path.resolve(import.meta.dirname, "node_modules/kalidokit/dist/kalidokit.es.js"),
      },
    },
  };
});

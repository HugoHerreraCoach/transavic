import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de FUNCIONES PURAS (chatbot, reportes).
//
// Por qué solo funciones puras: el problema histórico de este repo es que
// `@neondatabase/serverless` no corre en la Mac con Node 26 (gotcha #13), así que
// cualquier test que importe el driver muere antes de empezar. Todo lo que está
// bajo test acá NO importa `neon()` — por eso corre en cualquier lado, incluido CI.
//
// El alias `@` replica el de tsconfig: sin él, cualquier módulo que importe
// "@/lib/..." falla al resolverse dentro de vitest.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

import { defineConfig } from "vitest/config";

// Tests de FUNCIONES PURAS del chatbot (saneo, prompt, carta, fallback).
//
// Por qué solo funciones puras: el problema histórico de este repo es que
// `@neondatabase/serverless` no corre en la Mac con Node 26 (gotcha #13), así que
// cualquier test que importe el driver muere antes de empezar. Todo lo que está
// bajo test acá NO importa `neon()` — por eso corre en cualquier lado, incluido CI.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

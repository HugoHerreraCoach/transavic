import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes que NO deben ser bundleados por webpack — se cargan en runtime
  // desde node_modules. Necesario para módulos CJS pesados o con bindings
  // nativos que webpack mal-bundlea (archiver / node-forge / xml-crypto SUNAT).
  serverExternalPackages: ["archiver", "node-forge", "xml-crypto"],
};

export default nextConfig;

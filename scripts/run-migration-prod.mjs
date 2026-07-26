// scripts/run-migration-prod.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Cargar configs de producción
dotenv.config({ path: ".env.production.local" });
dotenv.config({ path: ".env.produccion.local" });

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL de producción no encontrada en .env.production.local o .env.produccion.local.");
  process.exit(1);
}

// Ojo: sanitizar logs para no pintar la clave de producción en la terminal
const urlOculta = dbUrl.replace(/:([^:@]+)@/, ":******@");
console.log(`Conectando a base de datos de producción: ${urlOculta}`);

const sql = neon(dbUrl);

async function ejecutarSQLFile(filePath) {
  const fullPath = path.resolve(filePath);
  console.log(`Ejecutando archivo de migración: ${fullPath}`);
  const sqlContent = fs.readFileSync(fullPath, "utf-8");
  
  const cleanedSql = sqlContent
    .split("\n")
    .filter(line => !line.trim().startsWith("--"))
    .join("\n");

  const queries = cleanedSql
    .split(";")
    .map(q => q.trim())
    .filter(q => q.length > 0);

  for (const q of queries) {
    console.log(`Ejecutando: ${q}`);
    await sql.query(q);
  }
}

async function main() {
  console.log("Iniciando ejecución de migraciones en base de datos de producción...");
  
  // 1. Crear tabla de ajustes
  await ejecutarSQLFile("scripts/migrate-ajustes-cuadre-2026-07-26.sql");
  
  // 2. Agregar campos de sexo macho/hembra
  await ejecutarSQLFile("scripts/migrate-rendimiento-sexo-2026-07-26.sql");
  
  console.log("¡Todas las migraciones se han ejecutado con éxito en producción!");
}

main().catch(err => {
  console.error("Error ejecutando migración en producción:", err);
  process.exit(1);
});

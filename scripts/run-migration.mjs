// scripts/run-migration.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL no encontrada.");
  process.exit(1);
}

const sql = neon(dbUrl);

async function main() {
  const sqlPath = path.resolve("scripts/migrate-rendimiento-sexo-2026-07-26.sql");
  console.log(`Leyendo migración desde: ${sqlPath}`);
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");

  console.log("Ejecutando sentencias SQL...");
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
  console.log("¡Migración ejecutada con éxito en la base de datos!");
}

main().catch(err => {
  console.error("Error al ejecutar migración:", err);
  process.exit(1);
});

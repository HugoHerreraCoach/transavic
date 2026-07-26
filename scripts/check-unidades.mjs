// scripts/check-unidades.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const unidades = await sql`
    SELECT DISTINCT unidad FROM pedido_items
  `;
  console.log("Unidades en pedido_items (local):", unidades);
}

main().catch(console.error);

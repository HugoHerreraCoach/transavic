// src/app/api/parametros-negocio/lista/route.ts
//
// Agrega UNA opción a una de las listas de `settings.parametros_negocio`
// (categorías de gasto, tipos de documento de compra) sin salir de la pantalla
// donde se está usando.
//
// Por qué no se reusa POST /api/settings (6 ago 2026):
//   1. Ese endpoint es admin-only, y quien carga gastos/compras también incluye
//      al rol `produccion`. Crear una categoría que falta no es "cambiar la
//      configuración del negocio": es destrabar el trabajo del momento.
//   2. Ese endpoint REESCRIBE la clave entera con lo que le manda el cliente. Si
//      el formulario de gasto mandara el objeto completo que leyó al montar,
//      pisaría los umbrales que otro admin esté editando en /configuracion.
//      Acá el read-modify-write pasa en el SERVIDOR, contra el valor vigente
//      (mismo molde que api/despacho/bloquear-ruta).
//
// QUITAR o RENOMBRAR sigue siendo admin, en /dashboard/configuracion: borrar una
// opción afecta el catálogo entero y no es la acción del momento.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  agregarALista,
  leerParametrosNegocio,
  LISTAS_AMPLIABLES,
  MAX_LARGO_OPCION,
} from "@/lib/parametros-negocio";

export const dynamic = "force-dynamic";

const AgregarSchema = z.object({
  lista: z.enum(LISTAS_AMPLIABLES),
  // El largo fino y el trim los decide `agregarALista` (una sola fuente, con
  // tests); acá solo se corta lo absurdo antes de tocar la DB.
  valor: z.string().min(1).max(MAX_LARGO_OPCION * 4),
});

export async function POST(request: Request) {
  const session = await auth();
  // Los mismos roles que pueden registrar el gasto o la compra.
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    const parsed = AgregarSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const { lista, valor } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const parametros = await leerParametrosNegocio(sql);

    const resultado = agregarALista(parametros[lista], valor);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }

    // Si ya existía no se escribe nada: se devuelve la que hay y la UI la
    // selecciona. Escribir igual solo generaría updates inútiles.
    if (!resultado.yaExistia) {
      const nuevos = { ...parametros, [lista]: resultado.lista };
      await sql`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('parametros_negocio', ${JSON.stringify(nuevos)}::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE
          SET value = ${JSON.stringify(nuevos)}::jsonb, updated_at = NOW()
      `;
    }

    return NextResponse.json({
      lista: resultado.lista,
      valor: resultado.canonico,
      ya_existia: resultado.yaExistia,
    });
  } catch (error) {
    console.error("Error agregando opción a parametros_negocio:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

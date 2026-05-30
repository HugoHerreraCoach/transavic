# Fase A — Base Operativa: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el papel impreso y las anotaciones a mano de la asistente de producción. Que la asistente trabaje 100% en el sistema desde su pantalla, registre pesos digitales, calcule cobros automáticamente y genere guías de remisión PDF con foto firmada.

**Architecture:** Trabajo aislado en un Neon Branch (`dev-hugo`) con `.env.local`. Producción (`transavic.app`) NO se toca hasta aprobación final. Cada sub-fase se prueba localmente + con túnel cloudflared para que Antonio valide desde su celular.

**Tech Stack:**
- Next.js 15 + TypeScript (existente)
- Neon Postgres + branches (existente, branch nuevo)
- @react-pdf/renderer (nuevo — para guía PDF)
- @vercel/blob (nuevo — para foto guía firmada)
- TailwindCSS v4 + react-icons (existente)
- zod (existente)

**Principio rector:** "No me hagas pensar" (Steve Krug). Pantallas auto-evidentes, valores por defecto, 1 clic para acciones frecuentes.

---

## Mapa de archivos a tocar/crear

### Archivos a crear (nuevos)
- `scripts/migrate-precios-productos.mjs` — agregar precios al catálogo
- `scripts/migrate-cantidad-real-items.mjs` — agregar cantidad pesada a items
- `scripts/migrate-correlativos-guias.mjs` — tabla correlativos + columnas en pedidos
- `src/app/dashboard/precios/page.tsx` — vista admin de precios
- `src/app/dashboard/precios/precios-client.tsx` — UI interactiva
- `src/app/dashboard/produccion/page.tsx` — vista de la asistente
- `src/app/dashboard/produccion/produccion-client.tsx` — UI interactiva
- `src/app/dashboard/produccion/peso-modal.tsx` — modal de ingreso de pesos
- `src/app/api/precios/route.ts` — GET/POST precios
- `src/app/api/precios/[id]/route.ts` — PATCH precio individual
- `src/app/api/produccion/pedidos/route.ts` — cola del día
- `src/app/api/produccion/pedidos/[id]/pesos/route.ts` — registrar pesos
- `src/app/api/produccion/pedidos/[id]/listo/route.ts` — marcar listo para despacho
- `src/app/api/pedidos/[id]/guia.pdf/route.ts` — descargar PDF de guía
- `src/app/api/pedidos/[id]/guia-firmada/route.ts` — upload foto firmada
- `src/components/GuiaPDF.tsx` — componente @react-pdf/renderer
- `src/lib/correlativos.ts` — helper para siguiente número correlativo

### Archivos a modificar (existentes)
- `src/lib/types.ts` — agregar estados `En_Produccion`, `Listo_Para_Despacho`; tipos `Precio`, `ProductoConPrecio`
- `src/auth.config.ts` — redirect post-login para rol `produccion`
- `src/components/DashboardLayout.tsx` — agregar item nav para producción + precios
- `src/app/api/users/route.ts` — agregar `produccion` al enum zod (3 lugares)
- `src/app/api/users/[id]/route.ts` — idem
- `src/app/dashboard/users/user-modal.tsx` — agregar option `produccion` al select
- `src/app/api/pedidos/route.ts` — al crear pedido, snapshot del precio en items
- `src/app/api/pedidos/[id]/route.ts` — actualizar enum de estado válido (5 → 7 valores)
- `src/app/api/despacho/route.ts` — incluir nuevos estados en queries
- `src/lib/data.ts` — actualizar `CASE estado` en ordering
- `src/app/dashboard/mi-ruta/mi-ruta-content.tsx` — botón "subir foto firmada" tras entregar

### Archivos de configuración
- `.env.local` (NEW, gitignored) — `DATABASE_URL` del branch + `BLOB_READ_WRITE_TOKEN`
- `package.json` — nuevas dependencies: `@react-pdf/renderer`, `@vercel/blob`

---

## Task 0: Setup ambiente de pruebas (Neon Branch)

**Files:** crear `.env.local`

- [ ] **Step 0.1: Instalar Neon CLI**

```bash
brew install neonctl
neon --version
```

Expected: imprime versión (ej. `2.x.x`).

- [ ] **Step 0.2: Login en Neon (OAuth)**

```bash
neon auth
```

Abre navegador con OAuth. Login con la cuenta de Hugo (la que administra el proyecto Transavic en Neon).

- [ ] **Step 0.3: Listar proyectos para obtener project-id**

```bash
neon projects list
```

Identificar el project-id del proyecto Transavic.

- [ ] **Step 0.4: Crear branch `dev-hugo`**

```bash
neon branches create --name dev-hugo --parent main
```

Expected: branch creado en 1-3 segundos. Imprime branch-id + endpoint.

- [ ] **Step 0.5: Obtener connection strings**

```bash
POOLED=$(neon connection-string dev-hugo --pooled)
UNPOOLED=$(neon connection-string dev-hugo)
echo "Pooled: $POOLED"
echo "Unpooled: $UNPOOLED"
```

- [ ] **Step 0.6: Crear `.env.local`**

```bash
cat > .env.local <<EOF
# Apunta al branch dev-hugo (Neon) — NO TOCA PRODUCCIÓN
DATABASE_URL=$POOLED
DATABASE_URL_UNPOOLED=$UNPOOLED
EOF
```

- [ ] **Step 0.7: Verificar que el .gitignore cubre .env.local**

```bash
grep "\.env\.local" .gitignore || echo ".env*.local" >> .gitignore
```

Expected: imprime la línea si ya existe.

- [ ] **Step 0.8: Verificar conexión**

```bash
node -e "require('dotenv').config({path:'.env.local'}); console.log('Conectado a:', new URL(process.env.DATABASE_URL).hostname)"
```

Expected: imprime hostname con `ep-...-dev-hugo...`.

- [ ] **Step 0.9: Levantar Next.js y verificar que arranca**

```bash
npm run dev &
sleep 5
curl -sf http://localhost:3000/api/version | head -5
kill %1
```

Expected: respuesta JSON con `buildId`.

---

## Task 1: A.1 - Precios — Migración SQL

**Files:**
- Create: `scripts/migrate-precios-productos.mjs`

- [ ] **Step 1.1: Crear script de migración**

```javascript
// scripts/migrate-precios-productos.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback a .env

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: precios de productos\n");

  console.log("1️⃣ Agregando columnas precio_compra, precio_venta a productos...");
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_compra NUMERIC(10, 2)`;
  await sql`ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(10, 2)`;
  console.log("   ✅ Columnas agregadas a productos");

  console.log("2️⃣ Creando tabla histórica de precios...");
  await sql`
    CREATE TABLE IF NOT EXISTS precios_productos (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
      precio_compra NUMERIC(10, 2),
      precio_venta NUMERIC(10, 2) NOT NULL,
      vigente_desde DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Lima')::date,
      vigente_hasta DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_by UUID REFERENCES users(id)
    )
  `;
  console.log("   ✅ Tabla precios_productos creada");

  console.log("3️⃣ Creando índice para consulta de precio vigente...");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_precios_vigentes
    ON precios_productos(producto_id, vigente_desde DESC)
    WHERE vigente_hasta IS NULL
  `;
  console.log("   ✅ Índice creado");

  console.log("4️⃣ Agregando precio_unitario a pedido_items (snapshot)...");
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS precio_unitario NUMERIC(10, 2)`;
  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2)`;
  console.log("   ✅ Columnas agregadas a pedido_items");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
```

- [ ] **Step 1.2: Ejecutar migración contra el branch**

```bash
node scripts/migrate-precios-productos.mjs
```

Expected: 4 ✅ y "🎉 Migración completada".

- [ ] **Step 1.3: Verificar estructura aplicada**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'productos' AND column_name LIKE 'precio%'\`.then(r => console.log(r));
"
```

Expected: imprime `precio_compra` y `precio_venta` con tipo `numeric`.

---

## Task 2: A.1 - Precios — Seed con tabla investigada

**Files:**
- Create: `scripts/seed-precios-2026.mjs`

- [ ] **Step 2.1: Crear seed script con PRECIOS_2026**

```javascript
// scripts/seed-precios-2026.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const PRECIOS_2026 = [
  // POLLO
  { nombre: "Pollo con menudencia entero", precio_compra: 8.50, precio_venta: 10.50 },
  { nombre: "Pollo entero sin menudencia", precio_compra: 9.00, precio_venta: 11.00 },
  { nombre: "Pechuga deshuesada / filetes", precio_compra: 14.50, precio_venta: 18.00 },
  { nombre: "Pechuga especial con hueso", precio_compra: 11.50, precio_venta: 14.50 },
  { nombre: "Filetes de pierna", precio_compra: 12.50, precio_venta: 15.50 },
  { nombre: "Pierna especial", precio_compra: 10.00, precio_venta: 12.50 },
  { nombre: "Piernas solas", precio_compra: 9.50, precio_venta: 12.00 },
  { nombre: "Encuentro / muslo", precio_compra: 10.50, precio_venta: 13.00 },
  { nombre: "Alas", precio_compra: 9.50, precio_venta: 12.00 },
  { nombre: "Milanesas", precio_compra: 15.50, precio_venta: 19.00 },
  { nombre: "Gallina doble pecho venta entera (peso aprox. 3.600 a 4.200 kg)", precio_compra: 11.00, precio_venta: 14.00 },
  { nombre: "Gallina colorada (peso aprox. 1.700 a 2kg)", precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Menudencia", precio_compra: 4.20, precio_venta: 5.50 },
  { nombre: "Pato entero precio", precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Magret de pato", precio_compra: 78.00, precio_venta: 99.50 },
  { nombre: "Cuy entero precio por uni.", precio_compra: 28.00, precio_venta: 35.00 },
  { nombre: "Pavita", precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Piernitas bouchet de pollo", precio_compra: 11.00, precio_venta: 14.00 },
  // CARNES
  { nombre: "Bistec de res", precio_compra: 24.00, precio_venta: 30.00 },
  { nombre: "Lomo Fino (peso de 2 a 2.900 sale por entero)", precio_compra: 38.00, precio_venta: 48.00 },
  { nombre: "Carne guiso de res (sin hueso)", precio_compra: 18.00, precio_venta: 22.00 },
  { nombre: "Carne molida de res especial", precio_compra: 20.00, precio_venta: 25.00 },
  { nombre: "Costillar", precio_compra: 22.00, precio_venta: 28.00 },
  { nombre: "Hueso Manzano", precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Cerdo en corte de guiso", precio_compra: 18.50, precio_venta: 23.00 },
  { nombre: "Osobuco con hueso", precio_compra: 20.50, precio_venta: 26.00 },
  { nombre: "Osobuco sin hueso", precio_compra: 26.50, precio_venta: 33.00 },
  { nombre: "Huachalomo", precio_compra: 32.00, precio_venta: 40.00 },
  { nombre: "Hígado de Res", precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Churrasco", precio_compra: 19.50, precio_venta: 24.50 },
  { nombre: "Lomo de cerdo sin hueso (peso de 5kg a 7kg) sale por entero", precio_compra: 22.00, precio_venta: 28.00 },
  { nombre: "Lomo de cerdo con hueso (peso de 5kg a 7kg) sale por entero", precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Panceta", precio_compra: 25.50, precio_venta: 32.00 },
  { nombre: "Chuleta de cerdo", precio_compra: 19.50, precio_venta: 24.50 },
  { nombre: "Mondonguito", precio_compra: 13.50, precio_venta: 17.00 },
  { nombre: "Corazón de res para anticucho por entero (peso aprox 1 kg)", precio_compra: 16.00, precio_venta: 20.00 },
  // HUEVOS
  { nombre: "Huevos x paquete de 6 planchas A GRANEL (solo x paquete 11.500 KG a 11.80 KG aprox)", precio_compra: 62.00, precio_venta: 75.00 },
  { nombre: "Huevos la calera plancha de 30 uni. Con fecha vencimiento", precio_compra: 13.50, precio_venta: 16.50 },
  { nombre: "Huevos de corral x 12 unid. La calera", precio_compra: 9.50, precio_venta: 12.00 },
];

async function seed() {
  console.log("🌱 Seed: precios 2026 (mercado mayorista Perú)\n");
  let updates = 0;
  let inserts = 0;
  let misses = 0;

  for (const p of PRECIOS_2026) {
    const productos = await sql`SELECT id FROM productos WHERE nombre = ${p.nombre} LIMIT 1`;
    if (productos.length === 0) {
      console.log(`   ⚠️  Producto no encontrado: ${p.nombre}`);
      misses++;
      continue;
    }
    const producto_id = productos[0].id;

    // Actualizar tabla productos (snapshot del precio actual)
    await sql`
      UPDATE productos
      SET precio_compra = ${p.precio_compra}, precio_venta = ${p.precio_venta}
      WHERE id = ${producto_id}
    `;
    updates++;

    // Insertar en histórico (cerrar el anterior si existe)
    await sql`
      UPDATE precios_productos
      SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
      WHERE producto_id = ${producto_id} AND vigente_hasta IS NULL
    `;
    await sql`
      INSERT INTO precios_productos (producto_id, precio_compra, precio_venta)
      VALUES (${producto_id}, ${p.precio_compra}, ${p.precio_venta})
    `;
    inserts++;
  }

  console.log(`\n✅ Actualizados: ${updates} productos`);
  console.log(`✅ Histórico insertado: ${inserts} registros`);
  if (misses > 0) console.log(`⚠️  No encontrados: ${misses}`);
  console.log("\n🎉 Seed completado");
}

seed().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
```

- [ ] **Step 2.2: Ejecutar el seed**

```bash
node scripts/seed-precios-2026.mjs
```

Expected: ~39 actualizados, 39 históricos, 0 misses (idealmente).

- [ ] **Step 2.3: Verificar precios cargados**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT nombre, precio_venta FROM productos WHERE precio_venta IS NOT NULL ORDER BY categoria, nombre LIMIT 10\`.then(r => console.table(r));
"
```

Expected: tabla con 10 productos y sus precios.

---

## Task 3: A.1 - API endpoints para gestión de precios

**Files:**
- Create: `src/app/api/precios/route.ts`
- Create: `src/app/api/precios/[id]/route.ts`

- [ ] **Step 3.1: GET /api/precios — listar productos con precio vigente**

```typescript
// src/app/api/precios/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo admin puede ver precios" }, { status: 403 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const productos = await sql`
    SELECT id, nombre, categoria, unidad, precio_compra, precio_venta, activo
    FROM productos
    WHERE activo = TRUE
    ORDER BY
      CASE categoria
        WHEN 'Pollo' THEN 1
        WHEN 'Carnes' THEN 2
        WHEN 'Huevos' THEN 3
      END,
      nombre ASC
  `;
  return NextResponse.json({ data: productos });
}
```

- [ ] **Step 3.2: PATCH /api/precios/[id] — actualizar precio individual**

```typescript
// src/app/api/precios/[id]/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  precio_compra: z.number().nonnegative().nullable().optional(),
  precio_venta: z.number().positive(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.pathname.split("/").pop()!;

  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { precio_compra, precio_venta } = parsed.data;

  const sql = neon(process.env.DATABASE_URL!);

  // 1. Cerrar histórico anterior
  await sql`
    UPDATE precios_productos
    SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
    WHERE producto_id = ${id} AND vigente_hasta IS NULL
  `;

  // 2. Insertar nuevo registro histórico
  await sql`
    INSERT INTO precios_productos (producto_id, precio_compra, precio_venta, created_by)
    VALUES (${id}, ${precio_compra ?? null}, ${precio_venta}, ${session.user.id})
  `;

  // 3. Actualizar snapshot en productos
  await sql`
    UPDATE productos
    SET precio_compra = ${precio_compra ?? null}, precio_venta = ${precio_venta}
    WHERE id = ${id}
  `;

  return NextResponse.json({ message: "Precio actualizado" });
}
```

- [ ] **Step 3.3: Probar GET con curl + cookie de sesión admin**

(Esto se hace después de la UI; aquí solo verificamos que no rompe el build.)

```bash
npx tsc --noEmit
```

Expected: Exit 0.

---

## Task 4: A.1 - UI de gestión de precios (admin)

**Files:**
- Create: `src/app/dashboard/precios/page.tsx`
- Create: `src/app/dashboard/precios/precios-client.tsx`
- Modify: `src/components/DashboardLayout.tsx` (agregar item nav)

- [ ] **Step 4.1: Crear page.tsx (server component)**

```tsx
// src/app/dashboard/precios/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import PreciosClient from "./precios-client";

export default async function PreciosPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/dashboard");
  }
  return <PreciosClient />;
}
```

- [ ] **Step 4.2: Crear precios-client.tsx (client component)**

```tsx
// src/app/dashboard/precios/precios-client.tsx
"use client";

import { useState, useEffect } from "react";
import { FiSave, FiDollarSign } from "react-icons/fi";

interface Producto {
  id: string;
  nombre: string;
  categoria: "Pollo" | "Carnes" | "Huevos";
  unidad: string;
  precio_compra: number | null;
  precio_venta: number | null;
}

export default function PreciosClient() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valoresEdicion, setValoresEdicion] = useState<{ precio_compra: string; precio_venta: string }>({
    precio_compra: "",
    precio_venta: "",
  });

  useEffect(() => {
    fetch("/api/precios")
      .then((r) => r.json())
      .then((data) => {
        setProductos(data.data);
        setLoading(false);
      });
  }, []);

  const iniciarEdicion = (p: Producto) => {
    setEditandoId(p.id);
    setValoresEdicion({
      precio_compra: p.precio_compra?.toString() ?? "",
      precio_venta: p.precio_venta?.toString() ?? "",
    });
  };

  const guardar = async (id: string) => {
    const precio_venta = parseFloat(valoresEdicion.precio_venta);
    const precio_compra = valoresEdicion.precio_compra ? parseFloat(valoresEdicion.precio_compra) : null;
    if (!precio_venta || precio_venta <= 0) {
      alert("Precio de venta requerido y positivo");
      return;
    }
    const res = await fetch(`/api/precios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio_compra, precio_venta }),
    });
    if (res.ok) {
      setProductos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, precio_compra, precio_venta } : p))
      );
      setEditandoId(null);
    } else {
      alert("Error al guardar");
    }
  };

  if (loading) return <div className="p-8">Cargando...</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <FiDollarSign /> Precios de productos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Actualizá los precios de compra y venta. Se aplican automáticamente a los pedidos nuevos.
        </p>
      </header>

      {(["Pollo", "Carnes", "Huevos"] as const).map((cat) => {
        const items = productos.filter((p) => p.categoria === cat);
        return (
          <section key={cat} className="mb-8">
            <h2 className="text-lg font-bold text-red-700 mb-3">{cat}</h2>
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Producto</th>
                    <th className="px-4 py-2 font-semibold w-28">Compra (S/)</th>
                    <th className="px-4 py-2 font-semibold w-28">Venta (S/)</th>
                    <th className="px-4 py-2 font-semibold w-24">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2">{p.nombre}</td>
                      <td className="px-4 py-2">
                        {editandoId === p.id ? (
                          <input
                            type="number"
                            step="0.01"
                            className="w-24 px-2 py-1 border rounded"
                            value={valoresEdicion.precio_compra}
                            onChange={(e) =>
                              setValoresEdicion({ ...valoresEdicion, precio_compra: e.target.value })
                            }
                          />
                        ) : (
                          p.precio_compra?.toFixed(2) ?? "-"
                        )}
                      </td>
                      <td className="px-4 py-2 font-semibold">
                        {editandoId === p.id ? (
                          <input
                            type="number"
                            step="0.01"
                            className="w-24 px-2 py-1 border rounded"
                            value={valoresEdicion.precio_venta}
                            onChange={(e) =>
                              setValoresEdicion({ ...valoresEdicion, precio_venta: e.target.value })
                            }
                          />
                        ) : (
                          p.precio_venta?.toFixed(2) ?? "-"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {editandoId === p.id ? (
                          <button
                            onClick={() => guardar(p.id)}
                            className="px-3 py-1 bg-green-500 text-white rounded text-xs flex items-center gap-1 hover:bg-green-600"
                          >
                            <FiSave /> Guardar
                          </button>
                        ) : (
                          <button
                            onClick={() => iniciarEdicion(p)}
                            className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4.3: Agregar item nav "Precios" al sidebar**

Modificar `src/components/DashboardLayout.tsx` agregando en el array `navItems` (después del item "Productos"):

```typescript
{
  href: "/dashboard/precios",
  label: "Precios",
  icon: <FiDollarSign className="h-5 w-5 flex-shrink-0" />,
  adminOnly: true,
},
```

Importar `FiDollarSign` arriba con los otros íconos.

- [ ] **Step 4.4: Verificar build**

```bash
npx tsc --noEmit && npx eslint src/app/dashboard/precios/ src/app/api/precios/
```

Expected: Exit 0.

- [ ] **Step 4.5: Test manual en navegador**

```bash
npm run dev
```

Abrir `http://localhost:3000/dashboard/precios` con admin logueado. Editar un precio, guardar, refrescar — debe persistir.

---

## Task 5: A.1 - Aplicar precio al crear pedido

**Files:**
- Modify: `src/app/api/pedidos/route.ts` (líneas 105-123)

- [ ] **Step 5.1: Modificar INSERT de pedido_items para incluir precio**

En `src/app/api/pedidos/route.ts`, reemplazar el loop de INSERT de items (líneas ~118-123):

```typescript
if (items && items.length > 0 && insertedPedido[0]?.id) {
  const pedidoId = insertedPedido[0].id;
  for (const item of items) {
    // Obtener precio vigente del producto
    const productoRow = await sql`
      SELECT precio_venta FROM productos WHERE id = ${item.productoId}
    `;
    const precio_unitario = productoRow[0]?.precio_venta ?? null;
    const subtotal = precio_unitario ? Number((precio_unitario * item.cantidad).toFixed(2)) : null;

    await sql`
      INSERT INTO pedido_items (pedido_id, producto_id, producto_nombre, cantidad, unidad, precio_unitario, subtotal)
      VALUES (${pedidoId}, ${item.productoId}, ${item.nombre}, ${item.cantidad}, ${item.unidad}, ${precio_unitario}, ${subtotal})
    `;
  }
}
```

- [ ] **Step 5.2: Verificar con un pedido de prueba**

Crear un pedido desde `/dashboard/nuevo-pedido`, después verificar:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT producto_nombre, cantidad, precio_unitario, subtotal FROM pedido_items ORDER BY created_at DESC LIMIT 5\`.then(r => console.table(r));
"
```

Expected: tabla con precio_unitario y subtotal poblados.

---

## Task 6: A.2 - Nuevos estados + rol producción

**Files:**
- Modify: `src/lib/types.ts` (línea 3)
- Modify: `src/app/api/pedidos/[id]/route.ts` (línea 26)
- Modify: `src/lib/data.ts` (líneas 180-186)
- Modify: `src/auth.config.ts` (línea 53)
- Modify: `src/app/api/users/route.ts` (línea 14)
- Modify: `src/app/api/users/[id]/route.ts` (línea 15)
- Modify: `src/app/dashboard/users/user-modal.tsx`
- Modify: `src/components/DashboardLayout.tsx`

- [ ] **Step 6.1: Actualizar tipo `EstadoPedido` en `types.ts`**

```typescript
export type EstadoPedido =
  | 'Pendiente'
  | 'En_Produccion'
  | 'Listo_Para_Despacho'
  | 'Asignado'
  | 'En_Camino'
  | 'Entregado'
  | 'Fallido';
```

- [ ] **Step 6.2: Actualizar zod enum en `api/pedidos/[id]/route.ts`**

Reemplazar línea 26:
```typescript
estado: z.enum(["Pendiente", "En_Produccion", "Listo_Para_Despacho", "Asignado", "En_Camino", "Entregado", "Fallido"]).optional(),
```

- [ ] **Step 6.3: Actualizar `CASE estado` en `lib/data.ts`**

Reemplazar bloque en fetchMiRuta (líneas 180-186):
```sql
CASE estado
  WHEN 'En_Camino' THEN 0
  WHEN 'Asignado' THEN 1
  WHEN 'Listo_Para_Despacho' THEN 2
  WHEN 'En_Produccion' THEN 3
  WHEN 'Pendiente' THEN 4
  WHEN 'Entregado' THEN 5
  WHEN 'Fallido' THEN 6
END
```

- [ ] **Step 6.4: Agregar rol "produccion" a CreateUserSchema**

En `src/app/api/users/route.ts:14`:
```typescript
role: z.enum(['admin', 'asesor', 'repartidor', 'produccion']),
```

Idem en `src/app/api/users/[id]/route.ts:15`.

- [ ] **Step 6.5: Agregar redirect post-login en `auth.config.ts`**

Reemplazar en `authorized` callback:
```typescript
if (nextUrl.pathname === "/login") {
  const role = auth?.user?.role;
  let target = "/dashboard/nuevo-pedido"; // default admin/asesor
  if (role === "repartidor") target = "/dashboard/mi-ruta";
  if (role === "produccion") target = "/dashboard/produccion";
  return Response.redirect(new URL(target, nextUrl));
}
```

- [ ] **Step 6.6: Agregar option "Producción" al select de roles en `user-modal.tsx`**

Agregar `<option value="produccion">Producción</option>` al select de roles.

- [ ] **Step 6.7: Verificar typecheck**

```bash
npx tsc --noEmit
```

---

## Task 7: A.3 - Migración: cantidad_real en pedido_items

**Files:**
- Create: `scripts/migrate-cantidad-real.mjs`

- [ ] **Step 7.1: Script de migración**

```javascript
// scripts/migrate-cantidad-real.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: cantidad_real en pedido_items\n");

  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS cantidad_real NUMERIC(10, 2)`;
  console.log("   ✅ Columna cantidad_real agregada");

  await sql`ALTER TABLE pedido_items ADD COLUMN IF NOT EXISTS subtotal_real NUMERIC(10, 2)`;
  console.log("   ✅ Columna subtotal_real agregada");

  // Tracking de quién pesó y cuándo
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_por UUID REFERENCES users(id)`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pesado_at TIMESTAMP WITH TIME ZONE`;
  console.log("   ✅ Columnas pesado_por, pesado_at agregadas a pedidos");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
```

- [ ] **Step 7.2: Ejecutar**

```bash
node scripts/migrate-cantidad-real.mjs
```

---

## Task 8: A.3 - API endpoints de Producción

**Files:**
- Create: `src/app/api/produccion/pedidos/route.ts`
- Create: `src/app/api/produccion/pedidos/[id]/pesos/route.ts`
- Create: `src/app/api/produccion/pedidos/[id]/listo/route.ts`

- [ ] **Step 8.1: GET pedidos del día para producción**

```typescript
// src/app/api/produccion/pedidos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fecha = searchParams.get("fecha"); // formato YYYY-MM-DD
  const search = searchParams.get("q");

  const sql = neon(process.env.DATABASE_URL!);

  const targetDate = fecha ?? null;
  const conditions: string[] = ["p.estado IN ('Pendiente', 'En_Produccion', 'Listo_Para_Despacho')"];
  const params: unknown[] = [];
  let i = 1;

  if (targetDate) {
    conditions.push(`p.fecha_pedido = $${i++}::date`);
    params.push(targetDate);
  } else {
    conditions.push(`p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date`);
  }

  if (search) {
    conditions.push(`(p.cliente ILIKE $${i} OR p.distrito ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const pedidos = await sql.query(
    `SELECT
      p.id, p.cliente, p.distrito, p.hora_entrega, p.empresa,
      p.detalle, p.notas, p.estado,
      TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha_pedido,
      u.name as asesor_name
    FROM pedidos p
    LEFT JOIN users u ON p.asesor_id = u.id
    ${where}
    ORDER BY p.estado, p.hora_entrega NULLS LAST, p.created_at ASC`,
    params
  );

  return NextResponse.json({ data: pedidos });
}
```

- [ ] **Step 8.2: PATCH pesos**

```typescript
// src/app/api/produccion/pedidos/[id]/pesos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PesosSchema = z.object({
  items: z.array(z.object({
    item_id: z.string().uuid(),
    cantidad_real: z.number().positive(),
  })),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user || !["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 2];

  const body = await request.json();
  const parsed = PesosSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  for (const item of parsed.data.items) {
    const row = await sql`
      SELECT precio_unitario FROM pedido_items WHERE id = ${item.item_id} AND pedido_id = ${id}
    `;
    if (row.length === 0) continue;
    const precio_unitario = Number(row[0].precio_unitario ?? 0);
    const subtotal_real = Number((precio_unitario * item.cantidad_real).toFixed(2));
    await sql`
      UPDATE pedido_items
      SET cantidad_real = ${item.cantidad_real}, subtotal_real = ${subtotal_real}
      WHERE id = ${item.item_id} AND pedido_id = ${id}
    `;
  }

  // Marcar pedido como En_Produccion + tracking
  await sql`
    UPDATE pedidos
    SET estado = 'En_Produccion', pesado_por = ${session.user.id}, pesado_at = NOW()
    WHERE id = ${id} AND estado IN ('Pendiente', 'En_Produccion')
  `;

  return NextResponse.json({ message: "Pesos registrados" });
}
```

- [ ] **Step 8.3: POST listo para despacho**

```typescript
// src/app/api/produccion/pedidos/[id]/listo/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !["admin", "produccion"].includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 2];

  const sql = neon(process.env.DATABASE_URL!);
  // Solo si tiene pesos
  const check = await sql`
    SELECT COUNT(*)::int as sin_peso FROM pedido_items WHERE pedido_id = ${id} AND cantidad_real IS NULL
  `;
  if (check[0].sin_peso > 0) {
    return NextResponse.json({ error: "Faltan pesos por registrar" }, { status: 400 });
  }
  await sql`UPDATE pedidos SET estado = 'Listo_Para_Despacho' WHERE id = ${id}`;
  return NextResponse.json({ message: "Pedido listo para despacho" });
}
```

---

## Task 9: A.3 - UI de Producción

**Files:**
- Create: `src/app/dashboard/produccion/page.tsx`
- Create: `src/app/dashboard/produccion/produccion-client.tsx`
- Create: `src/app/dashboard/produccion/peso-modal.tsx`
- Modify: `src/components/DashboardLayout.tsx`

(Por brevedad del plan, contenido completo se ejecuta task-by-task con instrucciones explícitas. Diseño: lista del día filtrable + modal con inputs por item + cálculo automático del total.)

- [ ] **Step 9.1: Crear page.tsx** (server component que valida rol y renderiza cliente)
- [ ] **Step 9.2: Crear produccion-client.tsx** (lista con búsqueda y filtros)
- [ ] **Step 9.3: Crear peso-modal.tsx** (modal con inputs de peso por producto, total auto-calculado)
- [ ] **Step 9.4: Agregar item nav "Producción" con `roles: ["admin", "produccion"]`**
- [ ] **Step 9.5: Verificar build y test manual**

---

## Task 10: A.4 - Migración: correlativos + columnas guía

**Files:**
- Create: `scripts/migrate-correlativos-guias.mjs`

```javascript
// scripts/migrate-correlativos-guias.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

async function migrate() {
  console.log("🔄 Migración: correlativos de guías\n");

  await sql`
    CREATE TABLE IF NOT EXISTS correlativos (
      tipo VARCHAR(50) PRIMARY KEY,
      ultimo_numero INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log("   ✅ Tabla correlativos creada");

  await sql`INSERT INTO correlativos (tipo) VALUES ('guia_remision') ON CONFLICT DO NOTHING`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_guia INTEGER`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_url TEXT`;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_firmada_at TIMESTAMP WITH TIME ZONE`;
  console.log("   ✅ Columnas agregadas a pedidos");

  console.log("\n🎉 Migración completada");
}

migrate().catch((err) => { console.error("❌", err); process.exit(1); });
```

- [ ] **Step 10.1: Ejecutar migración**

---

## Task 11: A.4 - Helper de correlativos

**Files:**
- Create: `src/lib/correlativos.ts`

```typescript
// src/lib/correlativos.ts
import { neon } from "@neondatabase/serverless";

export async function siguienteCorrelativo(tipo: "guia_remision"): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    UPDATE correlativos
    SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
    WHERE tipo = ${tipo}
    RETURNING ultimo_numero
  `;
  if (result.length === 0) throw new Error(`Tipo de correlativo no inicializado: ${tipo}`);
  return result[0].ultimo_numero as number;
}
```

---

## Task 12: A.4 - PDF de guía con @react-pdf/renderer

**Files:**
- Modify: `package.json` (instalar dependencia)
- Create: `src/components/GuiaPDF.tsx`
- Create: `src/app/api/pedidos/[id]/guia.pdf/route.ts`

- [ ] **Step 12.1: Instalar dependencia**

```bash
npm install @react-pdf/renderer
```

- [ ] **Step 12.2: Componente PDF**

```tsx
// src/components/GuiaPDF.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 10, fontFamily: "Helvetica" },
  header: { textAlign: "center", marginBottom: 20, borderBottom: "2px solid #C8102E", paddingBottom: 10 },
  title: { fontSize: 18, fontWeight: "bold", color: "#C8102E" },
  subtitle: { fontSize: 11, color: "#666", marginTop: 4 },
  numero: { position: "absolute", top: 30, right: 30, fontSize: 14, fontWeight: "bold", color: "#C8102E" },
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: "#888", marginBottom: 2 },
  value: { fontSize: 11, color: "#222" },
  table: { marginTop: 10, borderTop: "1px solid #ccc", borderLeft: "1px solid #ccc" },
  row: { flexDirection: "row", borderBottom: "1px solid #ccc" },
  cell: { padding: 6, borderRight: "1px solid #ccc", flexGrow: 1 },
  cellCant: { width: 60, textAlign: "right" },
  cellPrecio: { width: 70, textAlign: "right" },
  cellSubtotal: { width: 80, textAlign: "right" },
  totalRow: { flexDirection: "row", marginTop: 10 },
  totalLabel: { flexGrow: 1, textAlign: "right", padding: 6, fontWeight: "bold" },
  totalValue: { width: 80, padding: 6, textAlign: "right", fontWeight: "bold", fontSize: 12, color: "#C8102E" },
  firma: { marginTop: 40, borderTop: "1px solid #000", paddingTop: 6, width: 200 },
});

interface GuiaPDFProps {
  numero: number;
  cliente: string;
  direccion: string;
  distrito: string;
  fecha: string;
  empresa: string;
  items: Array<{ nombre: string; cantidad: number; unidad: string; precio: number; subtotal: number }>;
  total: number;
}

export default function GuiaPDF(props: GuiaPDFProps) {
  return (
    <Document>
      <Page size="A5" style={styles.page}>
        <Text style={styles.numero}>N° {String(props.numero).padStart(6, "0")}</Text>
        <View style={styles.header}>
          <Text style={styles.title}>{props.empresa}</Text>
          <Text style={styles.subtitle}>Guía de Remisión</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>CLIENTE</Text>
          <Text style={styles.value}>{props.cliente}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>DIRECCIÓN</Text>
          <Text style={styles.value}>{props.direccion}, {props.distrito}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>FECHA</Text>
          <Text style={styles.value}>{props.fecha}</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={styles.cell}><Text>Producto</Text></View>
            <View style={[styles.cell, styles.cellCant]}><Text>Cant.</Text></View>
            <View style={[styles.cell, styles.cellPrecio]}><Text>P.U.</Text></View>
            <View style={[styles.cell, styles.cellSubtotal]}><Text>Subtotal</Text></View>
          </View>
          {props.items.map((it, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.cell}><Text>{it.nombre}</Text></View>
              <View style={[styles.cell, styles.cellCant]}><Text>{it.cantidad} {it.unidad}</Text></View>
              <View style={[styles.cell, styles.cellPrecio]}><Text>S/ {it.precio.toFixed(2)}</Text></View>
              <View style={[styles.cell, styles.cellSubtotal]}><Text>S/ {it.subtotal.toFixed(2)}</Text></View>
            </View>
          ))}
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL:</Text>
          <Text style={styles.totalValue}>S/ {props.total.toFixed(2)}</Text>
        </View>
        <View style={styles.firma}>
          <Text style={{ textAlign: "center", fontSize: 9 }}>Firma del cliente</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 12.3: Endpoint GET /api/pedidos/[id]/guia.pdf**

```typescript
// src/app/api/pedidos/[id]/guia.pdf/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import GuiaPDF from "@/components/GuiaPDF";
import { siguienteCorrelativo } from "@/lib/correlativos";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 2]; // .../pedidos/[id]/guia.pdf

  const sql = neon(process.env.DATABASE_URL!);

  // Cargar pedido + items
  const pedidoRows = await sql`
    SELECT p.id, p.cliente, p.direccion, p.distrito, p.empresa, p.numero_guia,
      TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha
    FROM pedidos p WHERE id = ${id}
  `;
  if (pedidoRows.length === 0) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  const pedido = pedidoRows[0];

  const items = await sql`
    SELECT producto_nombre, COALESCE(cantidad_real, cantidad) as cantidad, unidad,
      COALESCE(precio_unitario, 0) as precio, COALESCE(subtotal_real, subtotal, 0) as subtotal
    FROM pedido_items WHERE pedido_id = ${id}
  `;

  // Reservar número de guía si no tiene
  let numero = pedido.numero_guia as number | null;
  if (!numero) {
    numero = await siguienteCorrelativo("guia_remision");
    await sql`UPDATE pedidos SET numero_guia = ${numero} WHERE id = ${id}`;
  }

  const total = items.reduce((sum: number, it) => sum + Number(it.subtotal), 0);
  const itemsFormat = items.map((it) => ({
    nombre: it.producto_nombre as string,
    cantidad: Number(it.cantidad),
    unidad: it.unidad as string,
    precio: Number(it.precio),
    subtotal: Number(it.subtotal),
  }));

  const buffer = await renderToBuffer(
    GuiaPDF({
      numero: numero!,
      cliente: pedido.cliente as string,
      direccion: (pedido.direccion as string) || "",
      distrito: (pedido.distrito as string) || "",
      fecha: pedido.fecha as string,
      empresa: pedido.empresa as string,
      items: itemsFormat,
      total,
    })
  );

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="guia-${String(numero).padStart(6, "0")}.pdf"`,
    },
  });
}
```

- [ ] **Step 12.4: Verificar build**

```bash
npx tsc --noEmit
```

---

## Task 13: A.4 - Upload de foto firmada con Vercel Blob

**Files:**
- Modify: `package.json` (instalar dependencia)
- Modify: `.env.local` (BLOB_READ_WRITE_TOKEN)
- Create: `src/app/api/pedidos/[id]/guia-firmada/route.ts`

- [ ] **Step 13.1: Instalar `@vercel/blob`**

```bash
npm install @vercel/blob
```

- [ ] **Step 13.2: Obtener token de Vercel Blob**

Pasos manuales: en Vercel Dashboard del proyecto Transavic → Storage → Create Database → Blob → Connect to project. Copiar `BLOB_READ_WRITE_TOKEN` y agregarlo a `.env.local`.

- [ ] **Step 13.3: Endpoint de upload**

```typescript
// src/app/api/pedidos/[id]/guia-firmada/route.ts
import { put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 2];

  const formData = await request.formData();
  const file = formData.get("foto") as File | null;
  if (!file) return NextResponse.json({ error: "No se envió archivo" }, { status: 400 });

  const blob = await put(`guias-firmadas/${id}-${Date.now()}.jpg`, file, {
    access: "public",
    addRandomSuffix: false,
    contentType: file.type || "image/jpeg",
  });

  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    UPDATE pedidos
    SET guia_firmada_url = ${blob.url}, guia_firmada_at = NOW()
    WHERE id = ${id}
  `;

  return NextResponse.json({ url: blob.url });
}
```

---

## Task 14: A.4 - UI: imprimir guía + subir foto firmada

**Files:**
- Modify: `src/app/dashboard/produccion/produccion-client.tsx` (botón "Imprimir guía")
- Modify: `src/app/dashboard/mi-ruta/mi-ruta-content.tsx` (botón "Subir foto firmada")

- [ ] **Step 14.1: Agregar botón "Imprimir guía" en card de producción**

Link a `/api/pedidos/${id}/guia.pdf` con `target="_blank"`.

- [ ] **Step 14.2: Agregar botón "Subir foto firmada" en card entregada de mi-ruta**

Input `<input type="file" accept="image/*" capture="environment">` que dispara upload con FormData.

---

## Task 15: Verificación end-to-end Fase A

- [ ] **Step 15.1: Crear pedido completo de prueba**

Como asesora, crear pedido para Lucy con 14 unidades de "Pechuga especial con hueso".

- [ ] **Step 15.2: Verificar precio aplicado**

```bash
node -e "...consulta SQL del pedido recién creado..."
```

Expected: `precio_unitario = 14.50`, `subtotal = 203.00`.

- [ ] **Step 15.3: Como producción, ingresar peso real**

Login como usuario `produccion`, abrir `/dashboard/produccion`, abrir el pedido de Lucy, ingresar `14.30` kg.

Expected: `subtotal_real = 207.35` (14.30 × 14.50).

- [ ] **Step 15.4: Marcar listo para despacho**

Expected: estado = `Listo_Para_Despacho`.

- [ ] **Step 15.5: Generar PDF de guía**

Abrir `http://localhost:3000/api/pedidos/{id}/guia.pdf`.

Expected: PDF descargable con cliente, productos, pesos reales, total.

- [ ] **Step 15.6: Túnel cloudflared para que Antonio pruebe**

```bash
cloudflared tunnel --url http://localhost:3000
```

Mandar URL a Antonio por WhatsApp.

- [ ] **Step 15.7: Documentar resultado en Slack/WhatsApp**

Captura de pantallas + lista de bugs si los hay.

---

## Self-review checklist

- [ ] ¿Hay placeholders TBD/TODO? — buscar y eliminar
- [ ] ¿Types consistentes entre tasks? — verificar
- [ ] ¿Comandos exactos? — sí
- [ ] ¿Cobertura completa de Fase A según spec? — sí

---

## Execution

Esta plan se ejecuta **inline** en la sesión actual con la skill `executing-plans`. Cada task se completa antes de pasar a la siguiente. Commits LOCALES sin push hasta que Antonio apruebe.

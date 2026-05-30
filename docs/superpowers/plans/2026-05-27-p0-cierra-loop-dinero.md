# P0 — Cierra el loop del dinero (audit 2026-05-27) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cierra el loop Pedido → Factura → Cobranza → Cliente: toda factura crea cobranza por default (toggle "ya cobrado" para opt-out), el modal de cobranza manual autocompleta cliente + permite linkear factura, el modal de compartir ticket no se corta y queda con X siempre visible, y `/comprobantes` exporta Excel para el contador.

**Architecture:** 4 cambios independientes (P0.3 → P0.1 → P0.4 → P0.2, ascendente en complejidad). Cada uno toca pocos archivos. P0.2 incluye migración SQL nueva (`facturas` ↔ clientes/comprobantes). P0.4 incluye nueva dep `xlsx`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Neon Postgres (vía `@neondatabase/serverless` HTTP + `psql` para migraciones por gotcha #13), Tailwind, react-icons, zod, NextAuth. Verificación: `npx tsc --noEmit` + `npx eslint <file>`. Sin framework de tests; verificación visual en navegador opcional.

**Constraints (del spec):**
- **NO tocar** módulo SUNAT (xml-builder/xml-signer/soap-client/index.ts) — BETA-validado.
- **NO commits** — Hugo decide cuándo commitear. Cada tarea termina con `tsc` + `eslint`.
- Todo local en **dev-hugo** (`.env.local` apunta a `ep-super-violet-adyp68ne`).
- Migraciones: SQL aplicado vía `psql "$DATABASE_URL" -f scripts/<file>.sql` (NUNCA con scripts node por gotcha #13).

---

## File Structure

| P0 | Archivos |
|---|---|
| **P0.3** Modal share fix | M `src/app/dashboard/ticket-share-modal.tsx` |
| **P0.1** Toggle "ya cobrado" + Contado→cobranza | M `src/app/api/comprobantes/emitir-manual/route.ts`, M `src/app/dashboard/comprobantes/nuevo/emitir-client.tsx` |
| **P0.4** Excel export | (install `xlsx`), C `src/app/api/comprobantes/export-xlsx/route.ts`, M `src/app/dashboard/comprobantes/comprobantes-client.tsx` |
| **P0.2** Cobranza manual autocomplete | C `scripts/migrate-factura-vinculo.sql`, M `src/app/api/facturas/route.ts`, M `src/app/api/comprobantes/route.ts` (filtro `cliente_doc_num`), M `src/app/dashboard/cobranzas/cobranzas-client.tsx` |

---

## Task 1 — P0.3 Modal compartir ticket: max-h + scroll + X siempre visible

**Files:** Modify `src/app/dashboard/ticket-share-modal.tsx`

**Bug:** El card `<div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative p-6">` no tiene `max-h` ni `overflow-y-auto`. En pantallas chicas o tickets largos, la imagen se corta y el botón X (absolute top-4 right-4) puede quedar fuera del viewport.

**Fix:** card con `max-h-[90vh] overflow-y-auto`, X dentro de un header `sticky top-0` (siempre visible al scrollear).

- [ ] **Step 1: Leer el bloque actual del modal (líneas 142-176) para confirmar anchors**

Run: `sed -n '140,180p' src/app/dashboard/ticket-share-modal.tsx`

Expected: ver el bloque `<div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative p-6">` con `<button onClick={onClose}>` absolute top-4 right-4 y `<h2>Compartir Ticket</h2>` adentro.

- [ ] **Step 2: Aplicar Edit (single anchor, single replacement)**

Edit `src/app/dashboard/ticket-share-modal.tsx`:

**old_string:**
```tsx
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">
            <FiX size={24} />
        </button>

        <div className="fixed top-0 left-[-9999px] z-[-1]">
```

**new_string:**
```tsx
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
        {/* Header sticky: el botón X queda SIEMPRE visible aunque el contenido haga scroll. */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">Compartir Ticket</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-500 hover:text-gray-800">
            <FiX size={24} />
          </button>
        </div>
        <div className="px-6 pb-6 pt-4">

        <div className="fixed top-0 left-[-9999px] z-[-1]">
```

- [ ] **Step 3: Eliminar el `<h2>` duplicado que quedó en el cuerpo (ya está en el header sticky)**

Edit `src/app/dashboard/ticket-share-modal.tsx`:

**old_string:**
```tsx
        <h2 className="text-xl font-bold text-gray-800 mb-4">Compartir Ticket</h2>

        <div className="min-h-[300px] flex justify-center items-center">
```

**new_string:**
```tsx
        <div className="min-h-[300px] flex justify-center items-center">
```

- [ ] **Step 4: Cerrar el nuevo `<div className="px-6 pb-6 pt-4">` antes del cierre del card**

Edit `src/app/dashboard/ticket-share-modal.tsx`:

**old_string:**
```tsx
        {!cargando && imagenBlob && (
            <div className="mt-6 flex flex-col sm:flex-row gap-4">
              <button onClick={descargarImagen} className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center"> <FiDownload className="mr-2" /> Descargar </button>
              <button onClick={compartirImagen} disabled={!navigator.share} className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400"> <FiShare2 className="mr-2" /> WhatsApp </button>
            </div>
        )}
      </div>
    </div>
  );
}
```

**new_string:**
```tsx
        {!cargando && imagenBlob && (
            <div className="mt-6 flex flex-col sm:flex-row gap-4">
              <button onClick={descargarImagen} className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center"> <FiDownload className="mr-2" /> Descargar </button>
              <button onClick={compartirImagen} disabled={!navigator.share} className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400"> <FiShare2 className="mr-2" /> WhatsApp </button>
            </div>
        )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verificar tsc + eslint**

Run:
```bash
npx tsc --noEmit 2>&1 | head
npx eslint src/app/dashboard/ticket-share-modal.tsx 2>&1 | tail -5
```

Expected: tsc sin output (clean) + eslint solo warnings preexistentes (no errors).

---

## Task 2 — P0.1 Toggle "Ya cobrado" + factura Contado → cobranza por default

**Files:**
- Modify `src/app/api/comprobantes/emitir-manual/route.ts` (zod schema + lógica de creación de cobranza)
- Modify `src/app/dashboard/comprobantes/nuevo/emitir-client.tsx` (state `yaCobrado` + checkbox + send)

**Cambio semántico:** Hoy solo se crea cobranza si `formaPago === "Credito"`. Cambio a: **factura (tipo 01) crea cobranza por default sea Contado o Crédito**, salvo que el usuario marque "ya cobrado". Boletas (03) NO crean cobranza (cash de mostrador). Para Contado, plazoDias=0 → vencimiento=hoy.

- [ ] **Step 1: Backend — extender el zod schema con `yaCobrado`**

Edit `src/app/api/comprobantes/emitir-manual/route.ts`:

**old_string:**
```ts
  // Forma de pago: "Credito" genera una cobranza automática (factura en /cobranzas).
  formaPago: z.enum(["Contado", "Credito"]).default("Contado"),
  plazoDias: z.number().int().min(0).max(120).default(0),
});
```

**new_string:**
```ts
  // Forma de pago: "Credito" genera una cobranza automática (factura en /cobranzas).
  formaPago: z.enum(["Contado", "Credito"]).default("Contado"),
  plazoDias: z.number().int().min(0).max(120).default(0),
  // Para FACTURAS contado: si el usuario lo marca, NO crea cobranza (cash de mano).
  // Default false = se crea cobranza también para contado (refleja realidad del negocio
  // Transavic: la mayoría son "contado" pero el cliente paga después).
  yaCobrado: z.boolean().default(false),
});
```

- [ ] **Step 2: Backend — cambiar la condición que crea la cobranza**

Edit `src/app/api/comprobantes/emitir-manual/route.ts`:

**old_string:**
```ts
    // Si la venta es a CRÉDITO y el comprobante se emitió OK (aceptado, o pendiente
    // de envío por falta de certificado), genera el registro de cobranza. NO se crea
    // si fue rechazado o erró: así no se registra deuda de una venta cuyo comprobante
    // no es válido, ni se duplica al reintentar. No debe romper la respuesta si falla.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    if (parsed.data.formaPago === "Credito" && resultado.serieNumero && emisionOk) {
      try {
        await crearFacturaStandalone({
          clienteNombre: clienteFinal.razonSocial,
          asesorId: session.user.role === "asesor" ? session.user.id : null,
          monto: totalConIgv,
          plazoDias: parsed.data.plazoDias,
          numeroComprobante: resultado.serieNumero,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }
```

**new_string:**
```ts
    // Regla del negocio: por defecto TODA factura (tipo 01) crea una cobranza, sea
    // Contado o Crédito, porque en Transavic la mayoría se emite "Contado" pero el
    // cliente paga después. Excepción: el usuario marca `yaCobrado` (cash de mano)
    // → no se crea cobranza. Boletas (tipo 03) NUNCA crean cobranza (consumidor cash).
    // Solo se crea si SUNAT aceptó (o el comprobante quedó pendiente por falta de cert);
    // si fue rechazado/erró, no registramos deuda inválida ni duplicamos al reintentar.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    const facturaContadoSinCobrar =
      parsed.data.tipo === "01" && !esCredito && !parsed.data.yaCobrado;
    const debeCrearCobranza =
      resultado.serieNumero && emisionOk && (esCredito || facturaContadoSinCobrar);

    if (debeCrearCobranza) {
      try {
        await crearFacturaStandalone({
          clienteNombre: clienteFinal.razonSocial,
          asesorId: session.user.role === "asesor" ? session.user.id : null,
          monto: totalConIgv,
          // Contado-sin-cobrar → vencimiento = hoy (plazo 0). Crédito → plazo del form.
          plazoDias: esCredito ? parsed.data.plazoDias : 0,
          numeroComprobante: resultado.serieNumero,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }
```

- [ ] **Step 3: Frontend — agregar state `yaCobrado` (cerca de `formaPago`)**

Edit `src/app/dashboard/comprobantes/nuevo/emitir-client.tsx`:

**old_string:**
```tsx
  const [formaPago, setFormaPago] = useState<FormaPago>("Contado");
```

**new_string:**
```tsx
  const [formaPago, setFormaPago] = useState<FormaPago>("Contado");
  // Solo aplica a FACTURAS contado: si está true, NO se crea cobranza al emitir.
  const [yaCobrado, setYaCobrado] = useState<boolean>(false);
```

- [ ] **Step 4: Frontend — mostrar checkbox cuando tipo=Factura + formaPago=Contado, debajo del bloque Crédito**

Read first: `sed -n '516,525p' src/app/dashboard/comprobantes/nuevo/emitir-client.tsx` para confirmar el helper text de Crédito (línea ~517-521).

Edit `src/app/dashboard/comprobantes/nuevo/emitir-client.tsx`:

**old_string:**
```tsx
                {formaPago === "Credito" && (
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    El cliente paga hasta el{" "}
                    <strong>{formatFechaLegible(fechaVenc)}</strong> ({diasHasta(fechaVenc)}{" "}
                    día(s)). Genera una cobranza en <strong>Cobranzas</strong> con ese
                    vencimiento.
                  </p>
                )}
```

**new_string:**
```tsx
                {formaPago === "Credito" && (
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    El cliente paga hasta el{" "}
                    <strong>{formatFechaLegible(fechaVenc)}</strong> ({diasHasta(fechaVenc)}{" "}
                    día(s)). Genera una cobranza en <strong>Cobranzas</strong> con ese
                    vencimiento.
                  </p>
                )}
                {/* Para FACTURAS al CONTADO: por default igual crea cobranza (Transavic
                    en la práctica "contado = cliente paga después"). Si fue cash de mano,
                    el usuario marca este checkbox y no se crea cobranza. */}
                {tipo === "01" && formaPago === "Contado" && (
                  <label className="mt-2 flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={yaCobrado}
                      onChange={(e) => setYaCobrado(e.target.checked)}
                      className="mt-0.5 accent-red-600"
                    />
                    <span>
                      <strong>El cliente ya pagó al instante</strong> (no crear cobranza
                      pendiente). Si no marcás esto, se crea una cobranza con vencimiento{" "}
                      <strong>hoy</strong> — útil cuando "contado" en realidad significa "te
                      cobro después".
                    </span>
                  </label>
                )}
```

- [ ] **Step 5: Frontend — enviar `yaCobrado` en el POST**

Edit `src/app/dashboard/comprobantes/nuevo/emitir-client.tsx`:

**old_string:**
```tsx
          formaPago,
          plazoDias: formaPago === "Credito" ? diasHasta(fechaVenc) : 0,
        }),
```

**new_string:**
```tsx
          formaPago,
          plazoDias: formaPago === "Credito" ? diasHasta(fechaVenc) : 0,
          yaCobrado: tipo === "01" && formaPago === "Contado" ? yaCobrado : false,
        }),
```

- [ ] **Step 6: Verificar tsc + lint**

Run:
```bash
npx tsc --noEmit 2>&1 | head
npx eslint src/app/api/comprobantes/emitir-manual/route.ts src/app/dashboard/comprobantes/nuevo/emitir-client.tsx 2>&1 | tail -5
```

Expected: tsc clean; eslint solo warnings preexistentes.

---

## Task 3 — P0.4 Excel export en /comprobantes

**Files:**
- (install) dep `xlsx`
- Create `src/app/api/comprobantes/export-xlsx/route.ts`
- Modify `src/app/dashboard/comprobantes/comprobantes-client.tsx` (botón en header)

**Decisión de lib:** `xlsx` (SheetJS) — estándar, sin deps nativas, server-side OK.

- [ ] **Step 1: Verificar si `xlsx` está instalado**

Run: `grep -E '"(xlsx|exceljs)"' package.json || echo "ninguno instalado"`

Expected: probablemente "ninguno instalado" → instalar en el siguiente paso.

- [ ] **Step 2: Instalar `xlsx`**

Run: `npm install xlsx`

Expected: agrega `xlsx` a dependencies. Si ya está, salta el paso.

- [ ] **Step 3: Crear el endpoint `/api/comprobantes/export-xlsx/route.ts`**

Write `src/app/api/comprobantes/export-xlsx/route.ts`:

```ts
// src/app/api/comprobantes/export-xlsx/route.ts
// Exporta los comprobantes filtrados como .xlsx (para el contador). Respeta los
// mismos filtros que GET /api/comprobantes (tipo, empresa) + tipo/empresa/estado.
// Scope por rol: admin ve todo; asesor solo los de sus pedidos.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo"); // "01" | "03" | "07" | null
  const empresa = searchParams.get("empresa"); // "transavic" | "avicola" | null

  const sql = neon(process.env.DATABASE_URL!);

  // Mismo patrón que GET /api/comprobantes: query dinámica con tagged template.
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (role === "asesor") {
    conditions.push(
      `c.pedido_id IN (SELECT id FROM pedidos WHERE asesor_id = $${i++})`
    );
    params.push(userId);
  }
  if (tipo && (tipo === "01" || tipo === "03" || tipo === "07" || tipo === "08")) {
    conditions.push(`c.tipo = $${i++}`);
    params.push(tipo);
  }
  if (empresa && (empresa === "transavic" || empresa === "avicola")) {
    conditions.push(`c.empresa = $${i++}`);
    params.push(empresa);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = (await sql.query(
    `SELECT c.serie_numero, c.tipo, c.empresa, c.cliente_doc_tipo, c.cliente_doc_num,
            c.cliente_razon_social, c.monto_subtotal, c.monto_igv, c.monto_total,
            c.estado, c.mensaje_sunat, c.created_at, c.forma_pago, c.fecha_vencimiento
     FROM comprobantes c
     ${where}
     ORDER BY c.created_at DESC
     LIMIT 5000`,
    params
  )) as Array<{
    serie_numero: string;
    tipo: string;
    empresa: string;
    cliente_doc_tipo: string | null;
    cliente_doc_num: string | null;
    cliente_razon_social: string | null;
    monto_subtotal: string | number;
    monto_igv: string | number;
    monto_total: string | number;
    estado: string;
    mensaje_sunat: string | null;
    created_at: string | Date;
    forma_pago: string | null;
    fecha_vencimiento: string | Date | null;
  }>;

  const tipoLabel = (t: string) =>
    t === "01" ? "Factura" : t === "03" ? "Boleta" : t === "07" ? "Nota de Crédito" : t;
  const empresaLabel = (e: string) =>
    e === "transavic" ? "Transavic" : e === "avicola" ? "Avícola de Tony" : e;
  const fmtFecha = (v: string | Date | null) => {
    if (!v) return "";
    const d = typeof v === "string" ? new Date(v) : v;
    return new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  };
  const fmtFechaSolo = (v: string | Date | null) => {
    if (!v) return "";
    if (typeof v === "string") return v.slice(0, 10);
    return v.toISOString().slice(0, 10);
  };

  // Columnas pensadas para el contador (orden + nombres claros).
  const data = rows.map((r) => ({
    "Fecha emisión": fmtFecha(r.created_at),
    "Serie-Número": r.serie_numero,
    "Tipo": tipoLabel(r.tipo),
    "Empresa": empresaLabel(r.empresa),
    "Cliente": r.cliente_razon_social ?? "",
    "Doc. cliente": r.cliente_doc_num ?? "",
    "Subtotal (S/)": Number(r.monto_subtotal),
    "IGV (S/)": Number(r.monto_igv),
    "Total (S/)": Number(r.monto_total),
    "Forma de pago": r.forma_pago ?? "Contado",
    "Vencimiento": fmtFechaSolo(r.fecha_vencimiento),
    "Estado SUNAT": r.estado,
    "Mensaje SUNAT": r.mensaje_sunat ?? "",
  }));

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(data);
  // Anchos de columna razonables.
  sheet["!cols"] = [
    { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 36 },
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 48 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Comprobantes");

  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const hoy = new Date().toISOString().slice(0, 10);
  const filename = `comprobantes-${hoy}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  });
}
```

- [ ] **Step 4: Frontend — agregar import del ícono + botón en el header**

Edit `src/app/dashboard/comprobantes/comprobantes-client.tsx` (import):

**old_string:**
```tsx
  FiFileMinus,
  FiSlash,
  FiCheckCircle,
} from "react-icons/fi";
```

**new_string:**
```tsx
  FiFileMinus,
  FiSlash,
  FiCheckCircle,
  FiFile,
} from "react-icons/fi";
```

- [ ] **Step 5: Frontend — agregar el botón "Exportar Excel" en el header (junto a "Resumen diario")**

Read first: `grep -n "Resumen diario" src/app/dashboard/comprobantes/comprobantes-client.tsx | head` para localizar el botón Resumen.

Edit `src/app/dashboard/comprobantes/comprobantes-client.tsx`:

**old_string:**
```tsx
            <button
              onClick={() => setModalResumen(true)}
              title="Resumen diario de boletas (SUNAT)"
```

**new_string:**
```tsx
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (filtroTipo !== "all") params.set("tipo", filtroTipo);
                if (filtroEmpresa !== "all") params.set("empresa", filtroEmpresa);
                window.location.assign(
                  `/api/comprobantes/export-xlsx?${params.toString()}`
                );
              }}
              title="Exportar a Excel (respeta los filtros activos)"
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-sm font-medium"
            >
              <FiFile className="h-4 w-4" /> Excel
            </button>
            <button
              onClick={() => setModalResumen(true)}
              title="Resumen diario de boletas (SUNAT)"
```

- [ ] **Step 6: Verificar tsc + eslint + smoke test del endpoint**

Run:
```bash
npx tsc --noEmit 2>&1 | head
npx eslint "src/app/api/comprobantes/export-xlsx/route.ts" "src/app/dashboard/comprobantes/comprobantes-client.tsx" 2>&1 | tail -5
```

Expected: tsc clean; eslint clean (puede haber warning si `FiFile` está sin usar en otros lados — no aplica).

Smoke test (opcional, requiere sesión activa en el navegador):

Run: `curl -I -b "<cookie>" "http://localhost:3000/api/comprobantes/export-xlsx?tipo=01"` o abrir directamente desde el botón en la UI logueada.

Expected: HTTP 200 + Content-Type application/vnd.openxmlformats... + attachment.

---

## Task 4 — P0.2 Cobranza manual: autocomplete clientes + selector de factura existente

**Files:**
- Create `scripts/migrate-factura-vinculo.sql`
- Modify `src/app/api/facturas/route.ts` (POST: aceptar `cliente_id` + `comprobante_id` opcionales)
- Modify `src/app/api/comprobantes/route.ts` (GET: filtro opcional `?cliente_doc_num=`)
- Modify `src/app/dashboard/cobranzas/cobranzas-client.tsx` (modal nuevo)

**Subtareas:** 4.1 migración SQL → 4.2 API facturas POST → 4.3 API comprobantes GET filtro → 4.4 frontend modal.

### Task 4.1 — Migración SQL: vínculos opcionales en `facturas`

- [ ] **Step 1: Crear el archivo de migración**

Write `scripts/migrate-factura-vinculo.sql`:

```sql
-- scripts/migrate-factura-vinculo.sql
-- Vincula opcionalmente cada registro de la tabla `facturas` (cobranzas) con un
-- cliente y/o un comprobante emitido. Permite que la "Cobranza manual"
-- autocomplete del catálogo de clientes y del listado de facturas/boletas ya
-- emitidas — sin romper el flujo actual (ambas columnas son NULL-ables y caen
-- a SET NULL si se borra el referenciado).
--
-- Aplicar (NUNCA con scripts node, gotcha #13 Node 26):
--   psql "$DATABASE_URL" -f scripts/migrate-factura-vinculo.sql
-- Solo dev-hugo. Producción NO se toca.

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS cliente_id UUID NULL REFERENCES clientes(id) ON DELETE SET NULL;

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS comprobante_id UUID NULL REFERENCES comprobantes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_cliente_id ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_comprobante_id ON facturas(comprobante_id);
```

- [ ] **Step 2: Aplicar la migración a dev-hugo + verificar columnas**

Run:
```bash
DBURL="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"'\''')"
echo "Host:" && echo "$DBURL" | sed -E 's#.*@([^/]+)/.*#\1#'
psql "$DBURL" -f scripts/migrate-factura-vinculo.sql
psql "$DBURL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='facturas' AND column_name IN ('cliente_id','comprobante_id') ORDER BY column_name;"
```

Expected: host `ep-super-violet-adyp68ne-pooler...` (dev-hugo, NO producción). Output del SELECT: 2 filas (`cliente_id uuid`, `comprobante_id uuid`).

### Task 4.2 — API `/api/facturas` POST: aceptar `cliente_id` + `comprobante_id`

- [ ] **Step 1: Localizar el POST handler y su zod schema actual**

Run: `sed -n '1,40p' src/app/api/facturas/route.ts` y `grep -nE "POST|z\.object|crearFacturaStandalone|cliente_id|comprobante_id" src/app/api/facturas/route.ts`

Expected: ver dónde está el `export async function POST` y el zod schema actual (acepta `clienteNombre`, `monto`, `plazoDias`, `numeroComprobante?`, etc.).

- [ ] **Step 2: Extender el schema POST + persistir las columnas nuevas**

Edit `src/app/api/facturas/route.ts` (basado en el anchor del schema actual):

**old anchor (zod schema del POST):** locate el bloque `const PostSchema = z.object({ ... })` o similar; agregar:
```ts
  cliente_id: z.string().uuid().optional().nullable(),
  comprobante_id: z.string().uuid().optional().nullable(),
```

**old anchor (UPDATE/INSERT que crea la factura):** localizar la query que inserta (puede estar dentro del POST handler o llamar `crearFacturaStandalone`).

Si llama a `crearFacturaStandalone` (lib/cobranzas.ts), extender esa función para aceptar `clienteId?: string` y `comprobanteId?: string` y persistirlos. Si no llama y hace el INSERT inline, agregar los campos al INSERT:

```ts
// Si el INSERT actual es:
//   INSERT INTO facturas (cliente_nombre, monto, fecha_emision, fecha_vencimiento,
//                         numero_comprobante, asesor_id)
// → extenderlo a:
//   INSERT INTO facturas (cliente_nombre, monto, fecha_emision, fecha_vencimiento,
//                         numero_comprobante, asesor_id, cliente_id, comprobante_id)
//   VALUES (..., ${parsed.data.cliente_id ?? null}, ${parsed.data.comprobante_id ?? null})
```

Importante: si decide cambiar `crearFacturaStandalone`, hacerlo de forma **backward-compatible** (clienteId/comprobanteId opcionales con default undefined). El caller existente en `emitir-manual/route.ts` no debe romperse.

- [ ] **Step 3: Verificar tsc + eslint**

Run: `npx tsc --noEmit 2>&1 | head && npx eslint src/app/api/facturas/route.ts src/lib/cobranzas.ts 2>&1 | tail -5`

Expected: tsc clean, eslint sin errores nuevos.

### Task 4.3 — API `/api/comprobantes` GET: filtro `?cliente_doc_num=`

- [ ] **Step 1: Localizar el bloque de filtros del GET**

Run: `grep -nE "searchParams|tipo|empresa|conditions.push" src/app/api/comprobantes/route.ts | head -15`

Expected: ver el bloque que arma `conditions` (similar al patrón usado en export-xlsx).

- [ ] **Step 2: Agregar el filtro `cliente_doc_num`**

Edit `src/app/api/comprobantes/route.ts`:

**old_string (después del filtro de empresa):**
```ts
    if (empresa && (empresa === "transavic" || empresa === "avicola")) {
      conditions.push(`c.empresa = $${i++}`);
      params.push(empresa);
    }
```

**new_string:**
```ts
    if (empresa && (empresa === "transavic" || empresa === "avicola")) {
      conditions.push(`c.empresa = $${i++}`);
      params.push(empresa);
    }
    // Filtro por doc del cliente — usado por el modal "Cobranza manual" para
    // mostrar SOLO las facturas/boletas emitidas a ese cliente.
    const clienteDocNum = searchParams.get("cliente_doc_num")?.trim();
    if (clienteDocNum && /^\d{8,11}$/.test(clienteDocNum)) {
      conditions.push(`c.cliente_doc_num = $${i++}`);
      params.push(clienteDocNum);
    }
```

- [ ] **Step 3: Verificar tsc + eslint**

Run: `npx tsc --noEmit 2>&1 | head && npx eslint src/app/api/comprobantes/route.ts 2>&1 | tail -5`

Expected: tsc/eslint clean.

### Task 4.4 — Frontend: modal "Cobranza manual" con autocomplete + selector de factura

- [ ] **Step 1: Leer el modal actual + estados**

Run: `grep -nE "useState|modalManual|clienteNombre|/api/facturas|onSubmit|cobranza manual" src/app/dashboard/cobranzas/cobranzas-client.tsx | head -25`

Expected: ver el state actual del modal (probablemente `{ clienteNombre, monto, plazoDias, notas }`) y el handler que hace POST a `/api/facturas`.

- [ ] **Step 2: Agregar tipos + estados para autocomplete clientes y facturas seleccionables**

Edit `src/app/dashboard/cobranzas/cobranzas-client.tsx`:

Cerca de los otros `useState` del modal, agregar:

```tsx
  // Autocomplete del cliente: sugerencias dinámicas desde /api/clientes?q=
  const [sugerenciasCliente, setSugerenciasCliente] = useState<
    Array<{ id: string; nombre: string; ruc_dni: string | null }>
  >([]);
  const [clienteIdSel, setClienteIdSel] = useState<string | null>(null);
  // Facturas emitidas para el cliente seleccionado (selector opcional)
  const [facturasCliente, setFacturasCliente] = useState<
    Array<{ id: string; serie_numero: string; monto_total: number; tipo: string }>
  >([]);
  const [comprobanteIdSel, setComprobanteIdSel] = useState<string | null>(null);
```

- [ ] **Step 3: Agregar el efecto de búsqueda debounced de clientes (300ms)**

Edit el componente para agregar (cerca de otros useEffect):

```tsx
  // Debounce búsqueda de clientes mientras el usuario tipea en el modal.
  useEffect(() => {
    if (!modalManualAbierto) return; // solo activo con modal abierto
    const q = (clienteNombre ?? "").trim();
    if (q.length < 2) {
      setSugerenciasCliente([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(q)}&limit=10`);
        if (!res.ok) return;
        const json = await res.json();
        // /api/clientes devuelve {data: Cliente[], ...}; ajustar al shape real.
        const arr = (json.data ?? json) as Array<{
          id: string;
          nombre: string;
          ruc_dni: string | null;
        }>;
        setSugerenciasCliente(arr.slice(0, 10));
      } catch {
        /* silencioso */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clienteNombre, modalManualAbierto]);
```

(Si el nombre del state que abre el modal es diferente, ajustarlo. Si el campo actual no se llama `clienteNombre`, usar el nombre real.)

- [ ] **Step 4: Cuando se selecciona un cliente, traer sus facturas pendientes**

Agregar otro useEffect:

```tsx
  // Cuando se elige un cliente con doc, traer sus facturas emitidas (tipo 01)
  // para poder vincular esta cobranza a una factura existente.
  useEffect(() => {
    const sel = sugerenciasCliente.find((s) => s.id === clienteIdSel);
    const doc = sel?.ruc_dni?.trim();
    if (!clienteIdSel || !doc) {
      setFacturasCliente([]);
      setComprobanteIdSel(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/comprobantes?tipo=01&cliente_doc_num=${encodeURIComponent(doc)}`
        );
        if (!res.ok) return;
        const json = await res.json();
        const arr = (json.data ?? json) as Array<{
          id: string;
          serie_numero: string;
          monto_total: string | number;
          tipo: string;
        }>;
        setFacturasCliente(
          arr.map((c) => ({
            id: c.id,
            serie_numero: c.serie_numero,
            monto_total: Number(c.monto_total),
            tipo: c.tipo,
          }))
        );
      } catch {
        setFacturasCliente([]);
      }
    })();
  }, [clienteIdSel, sugerenciasCliente]);
```

- [ ] **Step 5: Reemplazar el input de cliente y agregar selector de factura**

Localizar el `<input>` del cliente actual y reemplazarlo. Patrón:

```tsx
<div>
  <label className="text-xs font-semibold text-gray-500 uppercase">Cliente</label>
  <input
    type="text"
    list="cobranza-clientes"
    value={clienteNombre}
    onChange={(e) => {
      setClienteNombre(e.target.value);
      // Si el texto coincide exacto con una sugerencia → guardamos id
      const match = sugerenciasCliente.find(
        (s) => s.nombre.toLowerCase() === e.target.value.trim().toLowerCase()
      );
      setClienteIdSel(match?.id ?? null);
    }}
    placeholder="Buscá un cliente guardado o escribí uno nuevo"
    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
  />
  <datalist id="cobranza-clientes">
    {sugerenciasCliente.map((s) => (
      <option key={s.id} value={s.nombre}>
        {s.ruc_dni ? `${s.ruc_dni} · ` : ""}
        {s.nombre}
      </option>
    ))}
  </datalist>
  {clienteIdSel && (
    <p className="text-[11px] text-green-700 mt-1">
      ✓ Cliente guardado seleccionado (se vincula a su perfil)
    </p>
  )}
</div>

{/* Selector opcional: factura existente a la que esta cobranza corresponde */}
{facturasCliente.length > 0 && (
  <div>
    <label className="text-xs font-semibold text-gray-500 uppercase">
      Factura existente (opcional)
    </label>
    <select
      value={comprobanteIdSel ?? ""}
      onChange={(e) => {
        const id = e.target.value || null;
        setComprobanteIdSel(id);
        // Autopobla el monto desde la factura elegida.
        const f = facturasCliente.find((x) => x.id === id);
        if (f) setMonto(f.monto_total);
      }}
      className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500"
    >
      <option value="">— Cobranza sin vincular —</option>
      {facturasCliente.map((f) => (
        <option key={f.id} value={f.id}>
          {f.serie_numero} · S/ {f.monto_total.toFixed(2)}
        </option>
      ))}
    </select>
    <p className="text-[11px] text-gray-500 mt-1">
      Si elegís una factura, vinculamos esta cobranza y autollenamos el monto.
    </p>
  </div>
)}
```

(Adaptar el nombre del state `setMonto` al real del modal — puede llamarse `setMontoNuevo` o similar.)

- [ ] **Step 6: Enviar `cliente_id` + `comprobante_id` en el POST a `/api/facturas`**

Localizar el `onSubmit`/handler que hace `fetch("/api/facturas", { method: "POST", body: JSON.stringify({ ... }) })` y agregar los nuevos campos:

```tsx
body: JSON.stringify({
  clienteNombre, // existente
  monto,
  plazoDias,
  notas,
  cliente_id: clienteIdSel,
  comprobante_id: comprobanteIdSel,
}),
```

Y al cerrar/limpiar el modal, resetear los nuevos states:

```tsx
setClienteIdSel(null);
setComprobanteIdSel(null);
setSugerenciasCliente([]);
setFacturasCliente([]);
```

- [ ] **Step 7: Verificar tsc + eslint**

Run:
```bash
npx tsc --noEmit 2>&1 | head
npx eslint src/app/dashboard/cobranzas/cobranzas-client.tsx 2>&1 | tail -10
```

Expected: tsc clean; eslint sin errores (puede haber un warning si dejé useEffect deps faltantes — agregar comentario eslint-disable apropiado si toca).

---

## Self-Review (post-plan)

**Spec coverage:**
- ✅ P0.1 (toggle + Contado→cobranza) → Task 2.
- ✅ P0.2 (cobranza manual autocomplete + factura selector) → Task 4 (4.1-4.4).
- ✅ P0.3 (modal share fix) → Task 1.
- ✅ P0.4 (Excel) → Task 3.
- ✅ Restricción "no tocar SUNAT" — ningún task toca xml-builder/signer/soap-client/index.ts.
- ✅ Restricción "migraciones via psql" — Task 4.1 lo enfatiza.
- ✅ Restricción "no commits" — cada task termina en `tsc/eslint`, ningún `git commit`.

**Placeholder scan:** Sin "TBD" ni "fill in"; cada Edit muestra código completo; un Edit en Task 4.2 deja flexibilidad para detectar si la lógica está inline o en `crearFacturaStandalone` (necesario porque depende del estado real del archivo) — pero indica EXACTAMENTE qué hacer en cada caso.

**Type consistency:**
- `yaCobrado: boolean` consistente entre schema backend y POST frontend.
- `cliente_id?: string (UUID)`, `comprobante_id?: string (UUID)` consistentes entre migración SQL, schema zod, INSERT, frontend POST.
- `formaPago === "Credito"` (con C mayúscula) consistente — sin variantes.

## Post-Implementation Notes

Después de ejecutar las 4 tareas:
1. Refrescar dev (`npm run dev`) — hot-reload aplica.
2. Smoke test manual: emitir una factura Contado sin marcar "ya cobrado" → verificar que aparece en `/cobranzas`.
3. Modal manual: tipear cliente → ver sugerencias; elegir uno → ver sus facturas; elegir factura → ver monto autollenado.
4. Probar el botón Excel en `/comprobantes` — debe bajar `comprobantes-YYYY-MM-DD.xlsx`.
5. Compartir un pedido → confirmar que el modal cierra (X) y muestra imagen completa en pantallas chicas.

Hugo decide cuándo commitear (`git add -p` recomendado para revisar cambio por cambio).

# Optimización de Menú + Catálogo + IA — Plan de Implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** Reducir y ordenar el menú lateral (15→~11 ítems agrupados), fusionar Productos+Precios en una sección "Catálogo", y sacar la IA del menú integrándola de forma contextual + un botón flotante — todo local en `dev-hugo`, sin tocar producción.

**Architecture:** Refactor de UI sobre Next.js 15 App Router. Fase 1 consolida rutas reutilizando los componentes cliente existentes (pestañas) y agrupa el menú con un campo `group` en `navItems`. Fase 2 crea un hub de Reportes y mueve los insights de IA a widgets contextuales + un panel flotante. Sin cambios de base de datos.

**Tech Stack:** Next.js 15 (App Router, Server Components), TypeScript strict, TailwindCSS v4, react-icons/fi, Neon Postgres (sin ORM).

**Verificación (este repo NO tiene test runner):** cada tarea se valida con:
1. `npx tsc --noEmit` → exit 0, sin errores.
2. `npm run lint` → sin *errors* (warnings preexistentes OK).
3. Revisión manual en el navegador (dev server en `http://localhost:3000`, sesión admin).

**Regla de oro:** todo en `dev-hugo` + `.env.local`. NO commitear sin que Hugo lo pida. NO tocar producción.

---

## Estructura de archivos

**Fase 1 — crear:**
- `src/app/dashboard/catalogo/page.tsx` — server component (valida admin) que renderiza el cliente de catálogo.
- `src/app/dashboard/catalogo/catalogo-client.tsx` — wrapper con 2 pestañas (Productos | Precios) que reutiliza `ProductosClient` y `PreciosClient`.
- `src/components/FloatingAssistant.tsx` — botón flotante 💡 (Fase 1: link a `/asistente-ia`; Fase 2: panel real).

**Fase 1 — modificar:**
- `src/components/DashboardLayout.tsx` — agregar `group` a `navItems`, render agrupado en ambos sidebars, reemplazar Productos+Precios por "Catálogo", quitar "Asistente IA". Montar `FloatingAssistant`.
- `src/app/dashboard/productos/page.tsx` — redirect a `/dashboard/catalogo`.
- `src/app/dashboard/precios/page.tsx` — redirect a `/dashboard/catalogo`.

**Fase 2 — crear:**
- `src/app/dashboard/reportes/page.tsx` + `reportes-client.tsx` — hub con pestañas (Gerencial | Analítica | Resumen).
- `src/components/InsightCard.tsx` — tarjeta de insight reutilizable (contextual).

**Fase 2 — modificar:**
- `DashboardLayout.tsx` — Reportes pasa de 3 ítems a 1.
- `src/app/dashboard/{panel-gerencial,analytics,resumen}/page.tsx` — redirects al hub.
- `FloatingAssistant.tsx` — upgrade a panel con insights/chat scoped.
- Secciones que reciben insights embebidos (Reportes admin, Mis Metas asesora).

---

# FASE 1 — Catálogo + Menú agrupado + IA fuera del menú

### Task 1: Página "Catálogo" con pestañas (fusiona Productos + Precios)

**Files:**
- Create: `src/app/dashboard/catalogo/page.tsx`
- Create: `src/app/dashboard/catalogo/catalogo-client.tsx`

Diseño: reutilizar los componentes existentes `ProductosClient` (gestión nombre/categoría/unidad + alta/baja) y `PreciosClient` (edición precio_compra/precio_venta + margen) como contenido de 2 pestañas. Cero reescritura de tablas → riesgo mínimo. (La fusión "inline" en una sola tabla queda como mejora opcional posterior.)

- [ ] **Step 1: Crear la página server (valida admin)**

`src/app/dashboard/catalogo/page.tsx`:
```tsx
// src/app/dashboard/catalogo/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CatalogoClient from "./catalogo-client";

export default async function CatalogoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");
  return <CatalogoClient />;
}
```

- [ ] **Step 2: Crear el wrapper de pestañas**

`src/app/dashboard/catalogo/catalogo-client.tsx`:
```tsx
// src/app/dashboard/catalogo/catalogo-client.tsx
"use client";

import { useState } from "react";
import { FiBox, FiTag } from "react-icons/fi";
import ProductosClient from "../productos/productos-client";
import PreciosClient from "../precios/precios-client";

type Tab = "productos" | "precios";

export default function CatalogoClient() {
  const [tab, setTab] = useState<Tab>("productos");

  return (
    <div>
      <div className="px-4 sm:px-6 lg:px-8 pt-4">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo</h1>
        <p className="text-sm text-gray-500 mb-4">Productos y precios en un solo lugar.</p>
        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setTab("productos")}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              tab === "productos"
                ? "border-red-600 text-red-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <FiBox /> Productos
          </button>
          <button
            onClick={() => setTab("precios")}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              tab === "precios"
                ? "border-red-600 text-red-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <FiTag /> Precios
          </button>
        </div>
      </div>
      <div>{tab === "productos" ? <ProductosClient /> : <PreciosClient />}</div>
    </div>
  );
}
```

> Nota: `ProductosClient` y `PreciosClient` se exportan `default` desde sus archivos actuales — verificar el import al implementar. Si alguno tiene padding/título propio que choque, ajustar el wrapper (no los componentes).

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, sin errores.

- [ ] **Step 4: Verificar en navegador**

Navegar a `http://localhost:3000/dashboard/catalogo`. Esperado: pestañas "Productos" y "Precios"; cambiar entre ellas muestra cada tabla; editar un producto y un precio funciona igual que antes.

- [ ] **Step 5: Commit** (solo si Hugo lo pide)

```bash
git add src/app/dashboard/catalogo
git commit -m "feat(catalogo): fusiona productos y precios en una seccion con pestañas"
```

---

### Task 2: Redirects de las rutas viejas

**Files:**
- Modify: `src/app/dashboard/productos/page.tsx`
- Modify: `src/app/dashboard/precios/page.tsx`

Mantener funcionando bookmarks/links viejos: `/dashboard/productos` y `/dashboard/precios` redirigen a `/dashboard/catalogo`. (Los componentes cliente NO se borran — se siguen usando dentro de Catálogo.)

- [ ] **Step 1: Redirect en productos/page.tsx**

Reemplazar el contenido de `src/app/dashboard/productos/page.tsx` por:
```tsx
// src/app/dashboard/productos/page.tsx
import { redirect } from "next/navigation";
export default function ProductosRedirect() {
  redirect("/dashboard/catalogo");
}
```

- [ ] **Step 2: Redirect en precios/page.tsx**

Reemplazar el contenido de `src/app/dashboard/precios/page.tsx` por:
```tsx
// src/app/dashboard/precios/page.tsx
import { redirect } from "next/navigation";
export default function PreciosRedirect() {
  redirect("/dashboard/catalogo");
}
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` (exit 0). En navegador: ir a `/dashboard/productos` → redirige a `/dashboard/catalogo`. Igual con `/dashboard/precios`.

- [ ] **Step 4: Commit** (si Hugo lo pide)

```bash
git add src/app/dashboard/productos/page.tsx src/app/dashboard/precios/page.tsx
git commit -m "feat(catalogo): redirige rutas viejas de productos y precios al catalogo"
```

---

### Task 3: Botón flotante de IA (preserva acceso al sacarla del menú)

**Files:**
- Create: `src/components/FloatingAssistant.tsx`
- Modify: `src/components/DashboardLayout.tsx` (montar el botón)

Para no perder acceso a la IA cuando se quita del menú (Task 4), agregar un botón flotante 💡. En Fase 1 solo navega a `/asistente-ia`; en Fase 2 se convierte en panel real. Solo visible para admin y asesor (los roles que hoy ven Asistente IA).

- [ ] **Step 1: Crear el componente**

`src/components/FloatingAssistant.tsx`:
```tsx
// src/components/FloatingAssistant.tsx
"use client";

import Link from "next/link";
import { FiZap } from "react-icons/fi";

/** Botón flotante de acceso a la IA. Fase 1: link a /asistente-ia.
 *  Fase 2: se reemplaza por un panel contextual con insights + chat. */
export default function FloatingAssistant({ role }: { role: string }) {
  if (role !== "admin" && role !== "asesor") return null;
  return (
    <Link
      href="/dashboard/asistente-ia"
      title="Asistente IA"
      aria-label="Abrir Asistente IA"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-red-600 text-white shadow-lg hover:bg-red-700 transition-colors"
    >
      <FiZap className="h-5 w-5" />
      <span className="hidden sm:inline text-sm font-medium">Asistente IA</span>
    </Link>
  );
}
```

- [ ] **Step 2: Montar en DashboardLayout**

En `src/components/DashboardLayout.tsx`: importar el componente y renderizarlo dentro del contenedor raíz (junto a `{children}`). Importar arriba:
```tsx
import FloatingAssistant from "./FloatingAssistant";
```
Y antes del cierre del `<div className="min-h-screen bg-gray-50">` (al final del JSX), agregar:
```tsx
      <FloatingAssistant role={userRole} />
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` (exit 0). En navegador (admin): aparece el botón 💡 abajo a la derecha en todas las páginas; clic → va a `/dashboard/asistente-ia`.

- [ ] **Step 4: Commit** (si Hugo lo pide)

```bash
git add src/components/FloatingAssistant.tsx src/components/DashboardLayout.tsx
git commit -m "feat(ia): boton flotante de acceso al asistente"
```

---

### Task 4: Menú lateral agrupado + Catálogo + IA fuera

**Files:**
- Modify: `src/components/DashboardLayout.tsx`

Agregar un campo `group?: string` a cada item de `navItems`. Reemplazar los dos ítems "Productos" y "Precios" por un único "Catálogo" (`href: "/dashboard/catalogo"`). Quitar el ítem "Asistente IA". Renderizar agrupado con encabezados en AMBOS sidebars (móvil ~líneas 211-237 y el bloque equivalente del desktop).

Grupos y orden: **Operación** → **Comercial** → **Reportes** → **Configuración**. (Mi Ruta del repartidor queda sin grupo → se renderiza sin encabezado.)

- [ ] **Step 1: Agregar `group` al tipo y a cada navItem**

En la interfaz del item (donde están `href/label/icon/adminOnly`) agregar:
```tsx
  group?: string;
```
Asignar grupos (mantener `icon`, `roles`, `adminOnly` existentes):
- Mi Ruta → (sin group)
- Producción, Despacho, Nuevo Pedido, Lista de Pedidos → `group: "Operación"`
- Clientes, Cobranzas, Comprobantes, Mis Metas → `group: "Comercial"`
- Panel Gerencial, Analítica, Resumen Diario → `group: "Reportes"`
- Usuarios → `group: "Configuración"`

- [ ] **Step 2: Reemplazar Productos + Precios por Catálogo**

Borrar los dos objetos `{ href: "/dashboard/productos", ... }` y `{ href: "/dashboard/precios", ... }` y poner UNO:
```tsx
  {
    href: "/dashboard/catalogo",
    label: "Catálogo",
    icon: <FiBox className="h-5 w-5 flex-shrink-0" />,
    adminOnly: true,
    group: "Configuración",
  },
```
(El icono `FiBox` ya se importa; `FiTag` queda sin uso — quitarlo del import para no dejar warning de lint.)

- [ ] **Step 3: Quitar el ítem "Asistente IA"**

Borrar el objeto `{ href: "/dashboard/asistente-ia", label: "Asistente IA", ... }` de `navItems`. (La página `/dashboard/asistente-ia` sigue existiendo; se accede por el botón flotante de Task 3.) Quitar `FiZap` del import de `DashboardLayout` si quedó sin uso.

- [ ] **Step 4: Render agrupado (helper)**

Antes del `return` del componente, construir los grupos a partir de `filteredNavItems`:
```tsx
  const GROUP_ORDER = ["Operación", "Comercial", "Reportes", "Configuración"];
  const sinGrupo = filteredNavItems.filter((i) => !i.group);
  const grupos = GROUP_ORDER
    .map((g) => ({ nombre: g, items: filteredNavItems.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);
```

- [ ] **Step 5: Renderizar grupos en ambos sidebars**

Crear un helper de render reutilizable (función dentro del componente que recibe `onNavigate?: () => void` para cerrar el menú móvil):
```tsx
  const renderNav = (onNavigate?: () => void) => (
    <>
      {sinGrupo.map((item) => renderLink(item, onNavigate))}
      {grupos.map((g) => (
        <div key={g.nombre} className="pt-3">
          <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {g.nombre}
          </p>
          {g.items.map((item) => renderLink(item, onNavigate))}
        </div>
      ))}
    </>
  );
```
Donde `renderLink(item, onNavigate)` es la extracción del `<Link>` que hoy se repite (mismo className activo/inactivo). Definirlo una vez y usarlo en móvil y desktop. Reemplazar el `filteredNavItems.map(...)` del sidebar móvil por `{renderNav(() => setMobileOpen(false))}` y el del desktop por `{renderNav()}`.

> DRY: hoy el `<Link>` está duplicado en móvil y desktop. Extraer `renderLink` elimina la duplicación.

- [ ] **Step 6: Verificar typecheck + lint**

Run: `npx tsc --noEmit` (exit 0) y `npm run lint` (sin errors).

- [ ] **Step 7: Verificar en navegador**

Como admin: el menú muestra encabezados Operación / Comercial / Reportes / Configuración; "Catálogo" aparece (no Productos ni Precios sueltos); NO aparece "Asistente IA". Como asesor: ve sus grupos (Operación parcial, Comercial) sin secciones de admin. Probar móvil (abrir/cerrar menú).

- [ ] **Step 8: Commit** (si Hugo lo pide)

```bash
git add src/components/DashboardLayout.tsx
git commit -m "feat(menu): agrupa navegacion, fusiona catalogo y saca IA del menu"
```

---

## Checkpoint Fase 1

Al terminar Tasks 1-4: el menú está agrupado y más corto, Productos+Precios es "Catálogo", y la IA salió del menú pero sigue accesible por el botón flotante. **Revisar con Hugo en el navegador antes de Fase 2.**

---

# FASE 2 — Hub de Reportes + IA integrada (outline, se detalla al iniciarla)

> Esta fase se expande a tareas completas (con código) cuando Fase 1 esté validada, porque depende de explorar a fondo `panel-gerencial`, `analytics`, `resumen`, `asistente-ia-client.tsx` e `insights.ts`. Se deja el diseño y los archivos.

### Task 5: Hub de Reportes con pestañas
- Create `src/app/dashboard/reportes/page.tsx` + `reportes-client.tsx` (mismo patrón de pestañas que Catálogo: Gerencial | Analítica | Resumen, reutilizando los componentes cliente de cada página actual).
- Modify `DashboardLayout.tsx`: el grupo "Reportes" pasa de 3 ítems a 1 (`/dashboard/reportes`).
- Redirects en `panel-gerencial/page.tsx`, `analytics/page.tsx`, `resumen/page.tsx` → `/dashboard/reportes`.
- Verificación: tsc + lint + navegador (3 pestañas funcionan, scoping admin intacto).

### Task 6: Insights de IA contextuales (`InsightCard`)
- Create `src/components/InsightCard.tsx` (tarjeta reutilizable: título, contenido, estado de carga).
- Reutilizar `src/lib/insights.ts` (8 insights, scoped admin/asesora — NO romper el privacy boundary ni el cache key por scope).
- Embeber: insights admin en el hub de Reportes; insights de asesora en `/dashboard/mis-metas`. Las queries de asesora siguen filtrando por `asesor_id = session.user.id`.
- Verificación: tsc + lint + navegador (admin ve sus insights en Reportes; asesora ve los suyos en Mis Metas; no se cruzan datos).

### Task 7: Asistente flotante con panel
- Modify `FloatingAssistant.tsx`: en vez de link, abre un panel lateral/modal con insights scoped + (opcional) campo de pregunta que llama a `/api/asistente-ia`. Context-aware del rol.
- La página `/dashboard/asistente-ia` puede quedar como fallback o eliminarse (decidir al implementar).
- Verificación: tsc + lint + navegador (panel abre/cierra, muestra insights del rol correcto).

---

## Self-Review (hecho)

**Cobertura del spec:**
- 1a fusionar productos+precios → Task 1 + 2 ✓
- 1b reorganizar menú en grupos → Task 4 ✓
- 1c sacar IA del menú → Task 4 (quita ítem) + Task 3 (preserva acceso) ✓
- 2a hub de reportes → Task 5 ✓ (outline)
- 2b IA híbrida (contextual + flotante, scoped) → Tasks 6 + 7 ✓ (outline)

**Decisiones de diseño documentadas:**
- Catálogo = pestañas reutilizando componentes (bajo riesgo) en vez de reescribir tabla inline. Inline = mejora opcional futura.
- IA fuera del menú PERO con botón flotante desde Fase 1 para no perder acceso entre fases.
- Rutas viejas redirigen (no se rompen bookmarks).
- Sin cambios de DB. Verificación = tsc + lint + navegador (no hay test runner).

**Riesgos:** bajo. Todo es UI/rutas; los componentes de datos (ProductosClient, PreciosClient, páginas de reportes) se reutilizan tal cual. El scoping de IA (privacy) se preserva explícitamente en Task 6.

// src/lib/vistas.ts
// Catálogo de "vistas" (secciones) del dashboard y la lógica de qué puede abrir un
// usuario con `users.vistas_permitidas` (Fase 2 de roles flexibles).
//
// `key` = el href EXACTO del ítem del sidebar. MANTENER EN SYNC con `navItems` de
// src/components/DashboardLayout.tsx (misma key = misma sección). Si un usuario tiene
// vistas_permitidas != null, solo ve/abre estas secciones (siempre dentro de lo que su
// rol ya permite). NULL = sin restricción.

export type VistaCatalogo = { key: string; label: string; grupo: string };

// Orden de grupos para el checklist del modal (mismo que GROUP_ORDER del sidebar).
export const GRUPOS_VISTAS = [
  "🛵 Ventas Ejecutivas",
  "🏪 Venta en Campo",
  "🏭 Venta en Planta",
  "Producción & Compras",
  "Finanzas",
  "Reportes & Análisis",
  "Configuración",
] as const;

export const CATALOGO_VISTAS: VistaCatalogo[] = [
  // 🛵 Ventas Ejecutivas
  { key: "/dashboard/nuevo-pedido", label: "Nuevo Pedido", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard", label: "Lista de Pedidos", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/mi-dia", label: "Mi Día", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/clientes", label: "Clientes", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/crm-leads", label: "CRM Leads", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/despacho", label: "Despacho", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/cobranzas", label: "Cobranzas", grupo: "🛵 Ventas Ejecutivas" },
  { key: "/dashboard/comprobantes/ejecutivas", label: "Comprobantes (Ejecutivas)", grupo: "🛵 Ventas Ejecutivas" },

  // 🏪 Venta en Campo
  { key: "/dashboard/clientes-avicola", label: "Vender en Campo", grupo: "🏪 Venta en Campo" },
  { key: "/dashboard/clientes-avicola/ventas", label: "Ventas en Campo", grupo: "🏪 Venta en Campo" },
  { key: "/dashboard/clientes-avicola/comprobantes", label: "Comprobantes de Campo", grupo: "🏪 Venta en Campo" },
  { key: "/dashboard/clientes-avicola/liquidacion", label: "Liquidación del día", grupo: "🏪 Venta en Campo" },
  { key: "/dashboard/clientes-avicola/panel", label: "Panel Campo", grupo: "🏪 Venta en Campo" },

  // 🏭 Venta en Planta
  { key: "/dashboard/pos-planta", label: "Venta Rápida (POS)", grupo: "🏭 Venta en Planta" },
  { key: "/dashboard/pos-planta/ventas", label: "Ventas de Planta", grupo: "🏭 Venta en Planta" },
  { key: "/dashboard/clientes-planta", label: "Clientes Planta", grupo: "🏭 Venta en Planta" },
  { key: "/dashboard/cobranzas-planta", label: "Cobranzas Planta", grupo: "🏭 Venta en Planta" },

  // Producción & Compras
  { key: "/dashboard/resumen", label: "Resumen a Preparar", grupo: "Producción & Compras" },
  { key: "/dashboard/produccion", label: "Producción", grupo: "Producción & Compras" },
  { key: "/dashboard/produccion/mermas", label: "Calculadora Mermas", grupo: "Producción & Compras" },
  { key: "/dashboard/inventario", label: "Inventario Flex", grupo: "Producción & Compras" },
  { key: "/dashboard/compras", label: "Compras", grupo: "Producción & Compras" },
  { key: "/dashboard/proveedores", label: "Proveedores", grupo: "Producción & Compras" },
  { key: "/dashboard/prestamos", label: "Préstamos", grupo: "Producción & Compras" },

  // Finanzas
  { key: "/dashboard/caja-diaria", label: "Caja Diaria", grupo: "Finanzas" },
  { key: "/dashboard/gastos", label: "Gastos", grupo: "Finanzas" },
  { key: "/dashboard/comprobantes", label: "Comprobantes (todos)", grupo: "Finanzas" },
  { key: "/dashboard/cuentas-por-pagar", label: "Cuentas por Pagar", grupo: "Finanzas" },
  { key: "/dashboard/cuentas", label: "Cuentas Bancarias", grupo: "Finanzas" },

  // Reportes & Análisis
  { key: "/dashboard/ventas-generales", label: "Ventas Generales", grupo: "Reportes & Análisis" },
  { key: "/dashboard/mis-metas", label: "Mis Metas", grupo: "Reportes & Análisis" },
  { key: "/dashboard/reportes", label: "Reportes", grupo: "Reportes & Análisis" },
  { key: "/dashboard/rentabilidad", label: "Rentabilidad Real", grupo: "Reportes & Análisis" },
  { key: "/dashboard/consolidado", label: "Consolidado", grupo: "Reportes & Análisis" },

  // Configuración
  { key: "/dashboard/catalogo", label: "Catálogo", grupo: "Configuración" },
  { key: "/dashboard/autorizaciones", label: "Autorizaciones", grupo: "Configuración" },
  { key: "/dashboard/comunicados", label: "Comunicados", grupo: "Configuración" },
  { key: "/dashboard/incentivos", label: "Incentivos", grupo: "Configuración" },
  { key: "/dashboard/users", label: "Usuarios", grupo: "Configuración" },
  { key: "/dashboard/configuracion", label: "Configuración", grupo: "Configuración" },
];

const KEYS_VALIDAS = new Set(CATALOGO_VISTAS.map((v) => v.key));

/**
 * Limpia una lista de vistas dejando solo keys válidas del catálogo, sin duplicados.
 * Devuelve NULL si queda vacía (anti-lockout: nunca se guarda un usuario sin ninguna
 * vista; NULL = sin restricción).
 */
export function sanearVistas(vistas: unknown): string[] | null {
  if (!Array.isArray(vistas)) return null;
  const limpias = [
    ...new Set(
      vistas.filter((v): v is string => typeof v === "string" && KEYS_VALIDAS.has(v))
    ),
  ];
  return limpias.length > 0 ? limpias : null;
}

/**
 * ¿Un usuario con estas `vistas` puede abrir este `pathname`?
 * - null / [] → sin restricción (true).
 * - Se busca la entrada del catálogo que "gobierna" el path: exacta para `/dashboard`
 *   y por prefijo (la más larga/específica) para el resto. Si la sección gobernante
 *   está en `vistas` → permite; si está catalogada pero no permitida → bloquea; si
 *   no matchea ninguna del catálogo (detalle/utilitaria) → permite (hereda de su sección).
 */
export function rutaPermitidaPorVistas(
  pathname: string,
  vistas: string[] | null | undefined
): boolean {
  if (!vistas || vistas.length === 0) return true;
  let gobernante: string | null = null;
  for (const { key } of CATALOGO_VISTAS) {
    const matchea =
      key === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === key || pathname.startsWith(key + "/");
    if (matchea && (gobernante === null || key.length > gobernante.length)) {
      gobernante = key;
    }
  }
  if (gobernante === null) return true;
  return vistas.includes(gobernante);
}

/** Primera vista permitida del catálogo (destino de redirección). */
export function primeraVistaPermitida(vistas: string[] | null | undefined): string {
  if (!vistas || vistas.length === 0) return "/dashboard";
  const primera = CATALOGO_VISTAS.find((v) => vistas.includes(v.key));
  return primera ? primera.key : "/dashboard";
}

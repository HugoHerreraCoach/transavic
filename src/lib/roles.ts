// src/lib/roles.ts
// Página de "inicio" de cada rol y control de permisos granulares (RBAC ligero).

export type Role = "admin" | "asesor" | "repartidor" | "produccion" | "facturacion";

export const PERMISSIONS = {
  CAN_MANAGE_USERS: ["admin"],
  CAN_MANAGE_PRODUCTS: ["admin"],
  CAN_MANAGE_PRICES: ["admin"],
  CAN_VIEW_ALL_ORDERS: ["admin", "facturacion"],
  CAN_VIEW_OWN_ORDERS: ["asesor"],
  CAN_MANAGE_PURCHASES: ["admin", "produccion"], // Compras y mermas
  CAN_MANAGE_CASH: ["admin", "facturacion"], // Caja y gastos
  CAN_MANAGE_BILLING: ["admin", "facturacion"],
  CAN_VIEW_REPORTS: ["admin", "facturacion"],
  CAN_DELIVER: ["repartidor"],
  CAN_WEIGH: ["produccion", "admin"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function homeForRole(role?: string | null): string {
  if (role === "repartidor") return "/dashboard/mi-ruta";
  if (role === "produccion") return "/dashboard/produccion";
  if (role === "facturacion") return "/dashboard/facturacion";
  // admin y asesor arrancan en la lista/operación
  return "/dashboard";
}

// src/lib/roles.ts
// Página de "inicio" de cada rol. Se usa para redirigir cuando un usuario entra
// (por URL) a una vista que NO le corresponde, mandándolo a SU pantalla.
// Evita además loops de redirección (no mandar a una vista que el rol no puede ver).

export function homeForRole(role?: string | null): string {
  if (role === "repartidor") return "/dashboard/mi-ruta";
  if (role === "produccion") return "/dashboard/produccion";
  // admin y asesor arrancan en la lista/operación
  return "/dashboard";
}

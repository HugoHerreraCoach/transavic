// src/app/api/auth/logout/route.ts
import { authSignOut } from "@/auth";

export const dynamic = "force-dynamic";

// Usamos una función GET porque accederemos a esta ruta con un simple enlace
export async function GET() {
  await authSignOut({
    redirectTo: "/", // Al cerrar sesión, redirige a la página principal
  });
}

import { authSignOut } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Usamos una función GET porque accederemos a esta ruta con un simple enlace
export async function GET() {
  await authSignOut({
    redirect: false, // Evitamos que NextAuth intente resolver la URL absoluta
  });
  redirect("/login"); // Redirigimos usando la utilidad nativa de Next.js
}

import { authSignOut } from "@/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

// Usamos una función GET porque accederemos a esta ruta con un simple enlace
export async function GET() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") || headersList.get("host") || "app.transavic.com";
  const protocol = host.includes("localhost") ? "http" : "https";
  const absoluteRedirectUrl = `${protocol}://${host}/login`;

  await authSignOut({
    redirectTo: absoluteRedirectUrl,
  });
}

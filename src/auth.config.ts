// src/auth.config.ts

import type { NextAuthConfig } from "next-auth";
import { primeraVistaPermitida, rutaPermitidaPorVistas } from "@/lib/vistas";

declare module "next-auth" {
  interface User {
    name?: string;
    role?: string;
    solo_lectura?: boolean;
    vistas_permitidas?: string[] | null;
  }

  interface Session {
    user: {
      role: string;
      id: string;
      name: string;
      solo_lectura?: boolean;
      vistas_permitidas?: string[] | null;
    };
  }
}

// Métodos HTTP que NO modifican datos: son los únicos permitidos a un usuario de
// solo lectura. Cualquier otro (POST/PATCH/PUT/DELETE) se rechaza en el middleware.
const METODOS_LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // This callback adds the role to the JWT
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.name = user.name;
        token.solo_lectura = user.solo_lectura ?? false;
        token.vistas_permitidas = user.vistas_permitidas ?? null;
      }
      return token;
    },
    // This callback adds the role to the session, making it available in the client
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.name = token.name as string;
        session.user.solo_lectura = Boolean(token.solo_lectura);
        session.user.vistas_permitidas =
          (token.vistas_permitidas as string[] | null) ?? null;
      }
      return session;
    },
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const isLoggedIn = !!auth?.user;

      // Los endpoints propios de NextAuth (login/logout) SIEMPRE pasan: si el candado
      // de solo lectura los bloqueara, el observador no podría cerrar sesión.
      if (nextUrl.pathname.startsWith("/api/auth")) return true;

      // Candado de solo lectura: un usuario con la bandera solo puede hacer lecturas.
      // Cubre las ~106 rutas /api de escritura y los Server Actions (POST a /dashboard)
      // en un único punto, sin tocar cada endpoint.
      if (auth?.user?.solo_lectura && !METODOS_LECTURA.has(request.method)) {
        return Response.json(
          { error: "Tu usuario es de solo lectura: no puede crear ni modificar información." },
          { status: 403 }
        );
      }

      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");

      if (isOnDashboard) {
        if (!isLoggedIn) return false; // Redirect unauthenticated users to login page
        // Gate de vistas: si el usuario está limitado a ciertas secciones y esta
        // página no está entre ellas, se lo lleva a su primera vista permitida.
        // Solo para navegación (GET); las escrituras ya las cubre el candado anterior.
        const vistas = auth?.user?.vistas_permitidas;
        if (
          request.method === "GET" &&
          !rutaPermitidaPorVistas(nextUrl.pathname, vistas)
        ) {
          return Response.redirect(new URL(primeraVistaPermitida(vistas), nextUrl));
        }
        return true;
      } else if (isLoggedIn) {
        // Redirect logged-in users from /login to appropriate dashboard page
        if (nextUrl.pathname === "/login") {
          const role = auth?.user?.role;
          let target = "/dashboard/nuevo-pedido"; // admin / asesor por defecto
          if (role === "repartidor") target = "/dashboard/mi-ruta";
          if (role === "produccion") target = "/dashboard/produccion";
          // Usuario limitado a ciertas vistas: si el destino por rol no está permitido,
          // se lo manda directo a su primera vista permitida (evita un doble redirect).
          const vistas = auth?.user?.vistas_permitidas;
          if (!rutaPermitidaPorVistas(target, vistas)) {
            target = primeraVistaPermitida(vistas);
          }
          return Response.redirect(new URL(target, nextUrl));
        }
      }
      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;

// src/auth.config.ts
import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');

      if (isOnDashboard) {
        if (isLoggedIn) return true; // Si está en el dashboard y logueado, permite el acceso
        return false; // Si está en el dashboard y no logueado, redirige al login
      } else if (isLoggedIn) {
        // Si ya está logueado y intenta ir a /login, lo redirigimos al dashboard
        if (nextUrl.pathname === '/login') {
            return Response.redirect(new URL('/dashboard', nextUrl));
        }
      }
      return true; // Para todas las demás rutas, permite el acceso
    },
  },
  providers: [],
} satisfies NextAuthConfig;
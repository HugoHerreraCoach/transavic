// src/middleware.ts
import NextAuth from 'next-auth';
import { authConfig } from './auth.config'; 

export default NextAuth(authConfig).auth;

export const config = {
  // Corre en todo (incluido /api, para el candado de "solo lectura") EXCEPTO los
  // endpoints propios de NextAuth (/api/auth: login/logout) y los estáticos. Así el
  // flujo de autenticación queda intacto y el logout del observador nunca se bloquea.
  matcher: ['/((?!api/auth|_next/static|_next/image|.*\\.png$).*)'],
};
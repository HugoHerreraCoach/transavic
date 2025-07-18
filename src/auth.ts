// src/auth.ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from './auth.config';

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export const { auth, signIn, signOut: authSignOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        console.log('--- INICIANDO DEPURACIÓN DE LOGIN ---');
        console.log(`Usuario desde .env: "${ADMIN_USER}"`);
        console.log(`Contraseña desde .env: "${ADMIN_PASSWORD}"`);

        if (!ADMIN_USER || !ADMIN_PASSWORD) {
          console.error("Error: Credenciales de admin no están en el archivo .env");
          return null;
        }

        const parsedCredentials = z
          .object({ email: z.string(), password: z.string() })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          console.log(`Usuario desde formulario: "${email}"`);
          console.log(`Contraseña desde formulario: "${password}"`);

          const usersMatch = email === ADMIN_USER;
          const passwordsMatch = password === ADMIN_PASSWORD;

          console.log('¿Coinciden los usuarios?:', usersMatch);
          console.log('¿Coinciden las contraseñas?:', passwordsMatch);

          if (usersMatch && passwordsMatch) {
            console.log('✅ ¡Login Exitoso! Debería redirigir.');
            return { id: "1", name: "Admin", email: email };
          }
        }
        console.log('❌ Login Fallido.');
        console.log('------------------------------------');
        return null;
      },
    }),
  ],
});
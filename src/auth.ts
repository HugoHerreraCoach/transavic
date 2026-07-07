// src/auth.ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from './auth.config';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcrypt';

async function getUser(name: string) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const user = await sql`SELECT * FROM users WHERE name = ${name}`;
    return user[0];
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export const { auth, signIn, signOut: authSignOut } = NextAuth({
  ...authConfig,
  // Multi-dominio (app.transavic.com + transavic.vercel.app durante la transición):
  // NextAuth deriva la URL base del host de CADA request (x-forwarded-host de Vercel)
  // en vez de una AUTH_URL fija. Por eso AUTH_URL ya NO se define en Vercel.
  // Seguro en Vercel: solo enruta dominios configurados del proyecto.
  trustHost: true,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ name: z.string(), password: z.string() })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { name, password } = parsedCredentials.data;
          const user = await getUser(name);
          if (!user) return null;

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) return user;
        }

        return null;
      },
    }),
  ],
});
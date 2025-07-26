// src/lib/actions.ts
'use server';

import { signIn, authSignOut } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return 'Credenciales inválidas.';
    }
    throw error;
  }
  redirect('/dashboard');
}

/**
 * Maneja el cierre de sesión y redirige al usuario a la página de login.
 */
export async function doLogout() {
  await authSignOut({ redirectTo: '/login' });
}
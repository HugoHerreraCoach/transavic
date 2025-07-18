// src/lib/actions.ts
'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation'; // Importamos la función redirect

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    // Le decimos a signIn que NO redirija. Su única tarea es validar.
    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirect: false, // <-- CAMBIO CLAVE
    });

  } catch (error) {
    // Si hay un error, NextAuth lo lanzará.
    // El único error esperado aquí es el de credenciales inválidas.
    if (error instanceof AuthError && error.type === 'CredentialsSignin') {
      return 'Credenciales inválidas.';
    }
    // Para cualquier otro error inesperado (problemas de red, etc.), lo lanzamos.
    throw error;
  }

  // Si el bloque try se completa sin errores, significa que el login fue exitoso.
  // Ahora nosotros tomamos el control y forzamos la redirección.
  redirect('/dashboard'); // <-- CAMBIO CLAVE
}
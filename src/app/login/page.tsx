// src/app/login/page.tsx
'use client'; 

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { authenticate } from '@/lib/actions';
import { FiLogIn, FiArrowLeft } from 'react-icons/fi';
import Link from 'next/link';

function LoginButton() {
    const { pending } = useFormStatus();
    return (
        <button
            className="mt-4 w-full flex items-center justify-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 cursor-pointer"
            aria-disabled={pending}
        >
            <FiLogIn className="mr-2" />
            {pending ? 'Iniciando sesión...' : 'Iniciar Sesión'}
        </button>
    );
}

export default function LoginPage() {
    const [errorMessage, dispatch] = useActionState(authenticate, undefined);

    return (
        <main className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
            <div className="relative w-full max-w-[400px]">
                <div className="flex flex-col space-y-3.5 p-6 bg-white rounded-lg shadow-md border border-gray-200">
                    <h1 className="text-2xl font-bold text-gray-900 text-center">Acceso al Panel</h1>

                    <form action={dispatch} className="space-y-3">
                        <div className="flex-1 rounded-lg px-6 pb-4 pt-8">
                            <label className="mb-3 mt-5 block text-xs font-medium text-gray-900" htmlFor="name">
                                Usuario
                            </label>
                            <input
                                className="peer block w-full rounded-md border border-gray-200 py-[9px] px-3 text-sm outline-2 text-black placeholder:text-gray-500"
                                id="name"
                                type="text"
                                name="name"
                                placeholder="Ingresa tu usuario"
                                required
                            />
                            <label className="mb-3 mt-5 block text-xs font-medium text-gray-900" htmlFor="password">
                                Contraseña
                            </label>
                            <input
                                className="peer block w-full rounded-md border border-gray-200 py-[9px] px-3 text-sm outline-2 text-black placeholder:text-gray-500"
                                id="password"
                                type="password"
                                name="password"
                                placeholder="Ingresa tu contraseña"
                                required
                            />
                            <LoginButton />

                            {errorMessage && (
                                <div className="flex items-center justify-center mt-4">
                                    <p className="text-sm text-red-500">{errorMessage}</p>
                                </div>
                            )}
                        </div>
                    </form>
                </div>
                
                {/* Botón para volver a la página principal */}
                <div className="mt-6 text-center">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <FiArrowLeft className="h-4 w-4" />
                        Volver al Generador de Pedidos
                    </Link>
                </div>
            </div>
        </main>
    );
}
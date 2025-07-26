// src/app/dashboard/users/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { neon } from '@neondatabase/serverless';
import { User } from "@/lib/types";
import UsersClientPage from "./users-client";
import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';

// Función para obtener los usuarios directamente en el servidor
async function getUsers(): Promise<User[]> {
    try {
        const connectionString = process.env.DATABASE_URL!;
        const sql = neon(connectionString);
        const data = await sql`SELECT id, name, role FROM users ORDER BY name ASC`;
        return data as User[];
    } catch (error) {
        console.error("Database Error:", error);
        return [];
    }
}

export default async function Page() {
    const session = await auth();

    if (session?.user?.role !== 'admin') {
        redirect('/dashboard');
    }

    const users = await getUsers();

    return (
        // ✅ CAMBIO AQUÍ: Añadimos un contenedor con padding y ancho máximo
        <div className="w-full max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <h1 className="text-3xl font-bold text-gray-900">Gestión de Usuarios</h1>
                <Link href="/dashboard" className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                    <FiArrowLeft className="mr-2 h-5 w-5" />
                    Regresar al Dashboard
                </Link>
            </div>
            <UsersClientPage initialUsers={users} />
        </div>
    );
}
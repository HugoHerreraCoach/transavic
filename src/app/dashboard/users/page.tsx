// src/app/dashboard/users/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { neon } from '@neondatabase/serverless';
import { User } from "@/lib/types";
import UsersClientPage from "./users-client";

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
        <div className="bg-gray-50 min-h-screen">
            <div className="w-full max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Usuarios</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Quién accede al sistema y con qué permisos.
                    </p>
                </header>
                <UsersClientPage initialUsers={users} />
            </div>
        </div>
    );
}
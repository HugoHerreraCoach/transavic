// src/app/dashboard/dashboard-content.tsx
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Pedido } from '@/lib/types';
import Search from './search';
import PedidosTable from './table';
import PrintButton from './print-button';
import { FiLogOut } from 'react-icons/fi';

function Dashboard() {
    const [pedidos, setPedidos] = useState<Pedido[]>([]);
    const [cargando, setCargando] = useState(true);
    const searchParams = useSearchParams();

    useEffect(() => {
        const fetchPedidos = async () => {
            setCargando(true);
            try {
                const params = new URLSearchParams(searchParams.toString());
                const response = await fetch(`/api/dashboard/pedidos?${params.toString()}`);
                if (!response.ok) {
                    throw new Error('Error al obtener los pedidos');
                }
                const data: Pedido[] = await response.json();
                setPedidos(data);
            } catch (error) {
                console.error(error);
                // Opcional: manejar el estado de error en la UI
            } finally {
                setCargando(false);
            }
        };

        fetchPedidos();
    }, [searchParams]);

    return (
        <main className="container mx-auto bg-white p-4 sm:p-8">
            {/* ✅ MEJORA: Cabecera responsive */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6 print:hidden">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Dashboard de Pedidos</h1>
                    <p className="text-gray-600 mt-1">Aquí puedes ver, buscar y gestionar los pedidos.</p>
                </div>
                <div className="flex items-center gap-4">
                    <a
                        href="/api/auth/logout"
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                        <FiLogOut />
                        Cerrar Sesión
                    </a>
                    <PrintButton />
                </div>
            </div>

            <div className="print:hidden">
                <Search />
            </div>

            {cargando ? (
                <p className="mt-8 text-center text-gray-500">Cargando pedidos...</p>
            ) : (
                <PedidosTable pedidos={pedidos} />
            )}
        </main>
    );
}

export default function DashboardContent() {
    return (
        <Suspense fallback={<p className="mt-8 text-center text-gray-500">Cargando dashboard...</p>}>
            <Dashboard />
        </Suspense>
    );
}
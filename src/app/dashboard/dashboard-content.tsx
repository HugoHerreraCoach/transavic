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
    const searchParams = useSearchParams();
    const [pedidos, setPedidos] = useState<Pedido[]>([]);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        // Esta función se ejecuta en el cliente y pide los datos a nuestra API
        const fetchPedidos = async () => {
            setCargando(true);
            const params = new URLSearchParams(searchParams.toString());
            const response = await fetch(`/api/dashboard/pedidos?${params.toString()}`);
            const data = await response.json();
            setPedidos(data);
            setCargando(false);
        };

        fetchPedidos();
    }, [searchParams]); // Se vuelve a ejecutar cada vez que los filtros cambian

    return (
        <main className="container mx-auto p-4 sm:p-8">
            <div className="flex justify-between items-start mb-6 print:hidden">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Dashboard de Pedidos</h1>
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

            {cargando ? <p className="text-center mt-8">Cargando pedidos...</p> : <PedidosTable pedidos={pedidos} />}
        </main>
    );
}

// Envolvemos el componente en Suspense para manejar la carga inicial de los searchParams
export default function DashboardContent() {
    return (
        <Suspense fallback={<p className="text-center mt-8">Cargando dashboard...</p>}>
            <Dashboard />
        </Suspense>
    );
}
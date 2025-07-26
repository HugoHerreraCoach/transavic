// src/app/dashboard/dashboard-content.tsx

"use client";

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pedido } from '@/lib/types';
import Search from './search';
import PedidosTable from './table';
import PrintButton from './print-button';
import ColumnCustomizer from './column-customizer';
import { FiLogOut, FiUsers } from 'react-icons/fi';
import TicketShareModal from './ticket-share-modal';
import { Session } from "next-auth";

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'notas' | 'empresa' | 'asesor' | 'entregado' | 'navegacion' | 'fecha';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
}

interface DashboardContentProps {
  session: Session;
}


const getInitialVisibleColumns = (role: string): Record<Column, boolean> => {
  // Configuración base para todos los roles
  const baseColumns: Record<Column, boolean> = {
    distrito: false,
    tipo_cliente: false,
    hora_entrega: false,
    notas: false,
    empresa: false,
    asesor: false,
    entregado: true,
    navegacion: false, // Navegación visible por defecto para todos
    fecha: false,     // Fecha oculta por defecto para todos
  };

  // Si el rol es 'repartidor', sobrescribimos las configuraciones necesarias
  if (role === 'repartidor') {
    return {
      ...baseColumns,
      distrito: true,
      hora_entrega: true,
      notas: true,
      // 'navegacion' ya es true, pero lo dejamos por claridad
      navegacion: true,
    };
  }

  // Para cualquier otro rol (admin, asesor), devolvemos la configuración base
  return baseColumns;
};


function PaginationControls({ currentPage, totalPages }: PaginationControlsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex justify-center items-center gap-4 mt-8 print:hidden">
      <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage <= 1} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
        Anterior
      </button>
      <span className="font-medium text-gray-700">
        Página {currentPage} de {totalPages}
      </span>
      <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage >= totalPages} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
        Siguiente
      </button>
    </div>
  );
}

function Dashboard({ session }: DashboardContentProps) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [cargando, setCargando] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState<Record<Column, boolean>>(
    getInitialVisibleColumns(session.user.role)
  );
  const [sharingPedido, setSharingPedido] = useState<Pedido | null>(null);
  const searchParams = useSearchParams();
  const currentPage = Number(searchParams.get('page')) || 1;

  useEffect(() => {
    const fetchPedidos = async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams(searchParams.toString());
        const response = await fetch(`/api/dashboard/pedidos?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Error al obtener los pedidos');
        }
        const { data, pagination } = await response.json();
        setPedidos(data);
        setTotalPages(pagination.totalPages);
      } catch (error) {
        console.error(error);
      } finally {
        setCargando(false);
      }
    };
    fetchPedidos();
  }, [searchParams]);

  const handlePesoUpdated = (updatedPedido: Pedido) => {
    setPedidos(currentPedidos =>
      currentPedidos.map(p => p.id === updatedPedido.id ? updatedPedido : p)
    );
  };

  const handlePedidoDeleted = (deletedId: string) => {
    setPedidos(currentPedidos => currentPedidos.filter(p => p.id !== deletedId));
  };

  const handleColumnChange = (column: Column, visible: boolean) => {
    setVisibleColumns(prev => ({ ...prev, [column]: visible }));
  };

  return (
    <main className="bg-white max-w-[1600px] mx-auto p-4 sm:p-6">
      {/* 1. Encabezado Principal (Ahora contiene el botón de logout responsivo) */}
      <div className="flex justify-between items-center mb-4 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
            Dashboard de Pedidos - {session.user.name}
          </h1>
          <p className="text-gray-600 mt-1">Aquí puedes ver, buscar y gestionar los pedidos.</p>
        </div>

        {/* Botón de Cerrar Sesión único y adaptable */}
        <a
          href="/api/auth/logout"
          className="flex flex-shrink-0 items-center justify-center rounded-full bg-red-500 p-2 text-white hover:bg-red-600 sm:gap-2 sm:rounded-lg sm:px-4 sm:py-2"
          aria-label="Cerrar Sesión"
        >
          <FiLogOut className="h-5 w-5" />
          <span className="hidden sm:inline text-sm font-medium">Cerrar Sesión</span>
        </a>
      </div>

      {/* 2. Filtros (Sin cambios) */}
      <div className="print:hidden">
        <Search />
      </div>

      {/* 3. Acciones de la Lista (Se eliminó el botón de logout para móvil de aquí) */}
      <div className="mt-4 flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-3 print:hidden">
        <PrintButton />
        <ColumnCustomizer visibleColumns={visibleColumns} onColumnChange={handleColumnChange} />
        {session.user.role === 'admin' && (
          <Link href="/dashboard/users" className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            <FiUsers className="mr-2 h-5 w-5" />
            Gestionar Usuarios
          </Link>
        )}
      </div>

      {/* 4. Contenido de la Tabla (Sin cambios) */}
      <div className="mt-6">
        {cargando ? (
          <p className="mt-8 text-center text-gray-500">Cargando pedidos...</p>
        ) : (
          <>
            <PedidosTable
              pedidos={pedidos}
              onPedidoDeleted={handlePedidoDeleted}
              onPesoUpdated={handlePesoUpdated}
              onShareClick={setSharingPedido}
              visibleColumns={visibleColumns}
              userRole={session.user.role}
            />
            {totalPages > 1 && (
              <PaginationControls currentPage={currentPage} totalPages={totalPages} />
            )}
          </>
        )}
      </div>

      {sharingPedido && (
        <TicketShareModal
          pedido={sharingPedido}
          onClose={() => setSharingPedido(null)}
        />
      )}

    </main>
  );
}

export default function DashboardContent({ session }: DashboardContentProps) {
  return (
    <Suspense fallback={<p className="mt-8 text-center text-gray-500">Cargando dashboard...</p>}>
      <Dashboard session={session} />
    </Suspense>
  );
}
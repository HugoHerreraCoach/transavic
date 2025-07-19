"use client";

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Pedido } from '@/lib/types';
import Search from './search';
import PedidosTable from './table';
import PrintButton from './print-button';
import ColumnCustomizer from './column-customizer';
import { FiLogOut } from 'react-icons/fi';

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'notas' | 'empresa';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
}

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

function Dashboard() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [cargando, setCargando] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState<Record<Column, boolean>>({
    distrito: false,
    tipo_cliente: false,
    hora_entrega: false,
    notas: false,
    empresa: false,
  });
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

  const handlePedidoDeleted = (deletedId: string) => {
    setPedidos(currentPedidos => currentPedidos.filter(p => p.id !== deletedId));
  };

  const handleColumnChange = (column: Column, visible: boolean) => {
    setVisibleColumns(prev => ({ ...prev, [column]: visible }));
  };

  return (
    <main className="bg-white max-w-[1600px] mx-auto p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Dashboard de Pedidos</h1>
          <p className="text-gray-600 mt-1">Aquí puedes ver, buscar y gestionar los pedidos.</p>
        </div>
        <div className="flex items-center gap-4">
          <a href="/api/auth/logout" className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
            <FiLogOut /> Cerrar Sesión
          </a>
          <PrintButton />
          <ColumnCustomizer visibleColumns={visibleColumns} onColumnChange={handleColumnChange} />
        </div>
      </div>
      <div className="print:hidden">
        <Search />
      </div>
      {cargando ? (
        <p className="mt-8 text-center text-gray-500">Cargando pedidos...</p>
      ) : (
        <>
          <PedidosTable pedidos={pedidos} onPedidoDeleted={handlePedidoDeleted} visibleColumns={visibleColumns} />
          {totalPages > 1 && (
            <PaginationControls currentPage={currentPage} totalPages={totalPages} />
          )}
        </>
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
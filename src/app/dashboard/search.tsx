// src/app/dashboard/search.tsx
'use client';

import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { FiSearch, FiCalendar, FiX } from 'react-icons/fi'; // 👈 Se importa el ícono X

export default function Search() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();

    // Función con debounce para la búsqueda por nombre
    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('page', '1');
        if (term) {
            params.set('query', term);
        } else {
            params.delete('query');
        }
        replace(`${pathname}?${params.toString()}`);
    }, 300);

    // Función para el cambio de fecha (sin cambios)
    const handleDateChange = (date: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('page', '1');
        if (date) {
            params.set('fecha', date);
        } else {
            params.delete('fecha');
        }
        replace(`${pathname}?${params.toString()}`);
    }

    const fechaSeleccionada = searchParams.get('fecha')?.toString();

    return (
        <div className="flex flex-col sm:flex-row gap-4 mb-6 text-gray-700">
            <div className="relative flex-1">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    placeholder="Buscar por cliente o número..."
                    onChange={(e) => handleSearch(e.target.value)}
                    defaultValue={searchParams.get('query')?.toString()}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg border-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>
            {/* ✅ CAMBIO: Se envuelve el input de fecha en un div relativo para posicionar el botón de limpiar */}
            <div className="relative flex items-center">
                <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                    type="date"
                    onChange={(e) => handleDateChange(e.target.value)}
                    defaultValue={fechaSeleccionada}
                    className="w-full sm:w-auto pl-10 pr-4 py-2 border rounded-lg border-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {/* ✅ CAMBIO: Botón para limpiar la fecha, solo visible si hay una fecha seleccionada */}
                {fechaSeleccionada && (
                    <button
                        onClick={() => handleDateChange('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full"
                        aria-label="Limpiar fecha"
                    >
                        <FiX size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
// src/app/dashboard/search.tsx
'use client';

import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { FiSearch, FiCalendar } from 'react-icons/fi';

export default function Search() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();

    // Función con debounce para la búsqueda por nombre
    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('page', '1'); // Reinicia a la página 1 en cada búsqueda
        if (term) {
            params.set('query', term);
        } else {
            params.delete('query');
        }
        replace(`${pathname}?${params.toString()}`);
    }, 300); // Espera 300ms después de que el usuario deja de escribir

    // Función para el cambio de fecha
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

    return (
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    placeholder="Buscar por nombre de cliente..."
                    onChange={(e) => handleSearch(e.target.value)}
                    defaultValue={searchParams.get('query')?.toString()}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>
            <div className="relative">
                <FiCalendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="date"
                    onChange={(e) => handleDateChange(e.target.value)}
                    defaultValue={searchParams.get('fecha')?.toString()}
                    className="w-full sm:w-auto pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>
        </div>
    );
}
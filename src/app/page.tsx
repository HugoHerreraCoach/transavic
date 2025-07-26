// src/app/page.tsx

import { fetchAsesores } from '@/lib/data';
import PedidoForm from '@/components/PedidoForm';
import Link from 'next/link';
import { FiLogIn } from 'react-icons/fi';

export default async function HomePage() {
  const asesores = await fetchAsesores();

  return (
    // Contenedor principal para toda la página con un fondo sutil
    <div className="min-h-screen bg-gray-50">
      
      {/* Encabezado profesional y responsivo (se eliminó la clase 'sticky') */}
      <header className="bg-white shadow-sm">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Lado izquierdo: Logo y Título de la App */}
            <div className="flex items-center gap-3">
              <span className="text-2xl lg:text-2xl font-bold text-gray-800">
                Generador de Pedidos
              </span>
            </div>

            {/* Lado derecho: Botón de Acción Principal */}
            <div className="flex items-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 sm:px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <FiLogIn className="h-5 w-5" />
                {/* El texto solo es visible en pantallas más grandes que la móvil */}
                <span className="hidden sm:inline">Iniciar Sesión</span>
              </Link>
            </div>
          </div>
        </nav>
      </header>

      {/* Contenido principal de la página */}
      <main>
        <PedidoForm asesores={asesores} />
      </main>
    </div>
  );
}
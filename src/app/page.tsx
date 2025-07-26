// src/app/page.tsx

import { fetchAsesores } from '@/lib/data';
import PedidoForm from '@/components/PedidoForm'; // Asumiremos que mueves el formulario a este archivo

// Este es el Componente de Servidor. No lleva "use client".
export default async function HomePage() {
  
  // La obtención de datos se hace aquí, en el servidor.
  const asesores = await fetchAsesores();

  // Pasamos los datos obtenidos a nuestro componente de formulario.
  return <PedidoForm asesores={asesores} />;
}
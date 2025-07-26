// ⚙️ 1. Mueve los imports de cliente al componente de cliente
import { fetchAsesores } from '@/lib/data';
import PedidoForm from '@/components/PedidoForm'; // Asumiremos que mueves el formulario a este archivo

// ✅ 2. Este es el Componente de Servidor. No lleva "use client".
export default async function HomePage() {
  
  // ✅ 3. La obtención de datos se hace aquí, en el servidor.
  const asesores = await fetchAsesores();

  // ✅ 4. Pasamos los datos obtenidos a nuestro componente de formulario.
  return <PedidoForm asesores={asesores} />;
}
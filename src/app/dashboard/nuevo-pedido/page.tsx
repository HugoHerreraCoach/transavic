// src/app/dashboard/nuevo-pedido/page.tsx

import { fetchAsesores } from '@/lib/data';
import PedidoForm from '@/components/PedidoForm';

export default async function NuevoPedidoPage() {
  const asesores = await fetchAsesores();

  return <PedidoForm asesores={asesores} />;
}

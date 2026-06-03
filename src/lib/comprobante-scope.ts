// src/lib/comprobante-scope.ts
// Scoping de comprobantes por rol (decisión de Antonio, jun 2026):
//   - admin   → ve y maneja TODOS los comprobantes.
//   - asesor  → SOLO los suyos: los de SUS pedidos (pedidos.asesor_id) o los que ELLA
//               emitió (comprobantes.emitido_por). El match por nombre usa TRIM+lower
//               por la data legacy de producción (nombres con espacios — gotcha #11).
//   - otros roles → sin acceso.
// Lo usan los endpoints por id ([id], xml, cdr, enviar, nota-credito) tras leer el
// comprobante. El GET de la lista aplica el mismo criterio como condición SQL.
export function asesoraPuedeVerComprobante(
  role: string | undefined | null,
  userId: string | undefined | null,
  userName: string | undefined | null,
  comp: { pedidoAsesorId?: string | null; emitidoPor?: string | null }
): boolean {
  if (role === "admin") return true;
  if (role !== "asesor") return false;
  const esDeSuPedido = !!comp.pedidoAsesorId && comp.pedidoAsesorId === userId;
  const laEmitioElla =
    !!comp.emitidoPor &&
    !!userName &&
    comp.emitidoPor.trim().toLowerCase() === userName.trim().toLowerCase();
  return esDeSuPedido || laEmitioElla;
}

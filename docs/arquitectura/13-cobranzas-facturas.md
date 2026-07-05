# 13 — Gestión de Cobranzas y Facturas

> **Última verificación contra código:** 2026-06-28
> **Commit del proyecto:** `9f29f5a`
> **Archivos clave:** `src/lib/cobranzas.ts`, `src/app/api/facturas/route.ts`, `src/app/api/facturas/[id]/route.ts`

Este documento describe el funcionamiento de las cuentas por cobrar (cobranzas), la lógica de estados de pago, la conciliación de evidencias y el reporte de antigüedad de deuda (aging).

---

## 1. El Ciclo de Vida de una Cobranza

En Transavic, **toda emisión de boleta o factura genera automáticamente una cobranza** (una fila en la tabla `facturas`).

- **Regla de negocio:** El proceso de "Entregar" un pedido por el motorizado **no** crea la cobranza. Es la **emisión exitosa del CPE ante SUNAT** la que congela el saldo final y gatilla el registro en `facturas` (tanto para ventas al contado como a crédito).
- **Monto de la deuda:** La cobranza se inicializa con el valor `monto_total` (neto + IGV) retornado del XML firmado del comprobante, lo que garantiza cuadres exactos al céntimo.
- **Asignación de asesora:** La cobranza se asocia al `asesor_id` en cascada (`pedido` $\rightarrow$ `comprobante` $\rightarrow$ `facturas.asesor_id`), permitiendo a las asesoras realizar el seguimiento de sus propios cobros en el panel.

---

## 2. Los 4 Estados de Cobranza

1. **`Pendiente`**: La factura ha sido emitida pero aún no vence ni se ha pagado.
2. **`Vencida`**: La fecha actual supera la `fecha_vence` (calculada como `fecha_emision + plazo_pago_dias`). El cron job `/api/cron/facturas-vencidas` actualiza este estado diariamente a las 08:00 Lima.
3. **`Pagada`**: La asesora o el admin confirman la recepción del dinero y registran el pago.
4. **`Anulada`**: La cobranza ha sido cancelada por algún motivo administrativo o por la emisión de una Nota de Crédito.

---

## 3. Reglas Técnicas de Consulta y Deuda (Exclusión Crítica)

> [!WARNING]
> **Regla de exclusión de Anuladas:** Al calcular saldos, deudas acumuladas o reportes de aging, **nunca** se debe usar la condición `estado <> 'Pagada'`. Se debe filtrar explícitamente usando `estado IN ('Pendiente', 'Vencida')` para excluir los montos de las facturas que fueron anuladas o canceladas por Nota de Crédito.

```typescript
// Lógica de cálculo en queries de cobranza
const result = await sql`
  SELECT COALESCE(SUM(monto), 0) AS saldo_deudora
  FROM facturas
  WHERE cliente_id = ${clienteId}
    AND estado IN ('Pendiente', 'Vencida')
`;
```

---

## 4. Conciliación de Pagos y Evidencia Visual

Cuando el cliente realiza el pago (usualmente por transferencias bancarias BCP/BBVA o billeteras digitales Yape/Plin), la asesora abre la cobranza y registra:
- `metodo_pago` $\rightarrow$ 'Transferencia', 'Yape', 'Efectivo', etc.
- `pago_detalle` $\rightarrow$ Número de operación bancaria o glosa.
- **Resguardo fotográfico:** Se sube la captura de pantalla del voucher (`pago_img_base64` y `pago_img_mime`). Esto proporciona al administrador la evidencia física para contrastar contra el estado de cuenta real del banco.

---

## 5. Anulaciones

- **Anulación Manual (Admin):** El administrador puede anular una cobranza sin emitir Notas de Crédito, registrando el motivo en `anulada_motivo` y marcando `anulada_por` / `anulada_at`.
- **Anulación Automática (Nota de Crédito):** Cuando una asesora emite una Nota de Crédito (CPE tipo "07") que afecta a una factura o boleta, el sistema busca la cobranza asociada mediante el `comprobante_id` y actualiza automáticamente su estado a `Anulada`, previniendo que figure como deuda activa.

---

## 6. Reporte de Antigüedad de Deuda (Aging)

El panel de finanzas calcula las cuentas por cobrar agrupándolas en 4 cubos de tiempo basados en la diferencia de días entre la `fecha_vence` y el día de hoy:
- **0–7 días:** Deuda muy reciente.
- **8–15 días:** Requiere primer contacto de cobranza.
- **16–30 días:** Alerta de atraso comercial.
- **Más de 30 días:** Deuda crítica (bloqueo potencial de futuros pedidos del cliente).
- El endpoint `GET /api/cobranzas/aging` provee la data consolidada para el panel del administrador.

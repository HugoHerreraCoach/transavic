# 13 — Cobranzas y Carteras por Operación

> **Última verificación contra código:** 2026-07-12
> **Archivos clave:** `src/lib/cobranzas.ts`, `src/lib/avicola/saldos.ts`, `src/lib/avicola/estado-cuenta.ts`, `src/lib/planta/saldos.ts`, `src/app/api/facturas/`, `src/app/api/avicola/`, `src/app/api/cobranzas-planta/`

Transavic tiene tres carteras independientes. Compartir el motor SUNAT **no significa compartir la tabla de deuda**.

---

## 1. Mapa de carteras

| Operación | Nace de | Deuda | Pagos | Vistas |
|---|---|---|---|---|
| Ejecutivas | CPE de pedido/manual atribuible a Ejecutivas | `facturas` | campos de pago/voucher en `facturas` | `/dashboard/cobranzas` |
| Campo | venta visitando mercados/avícolas | saldo calculado desde `ventas_avicola` | `abonos_avicola` | ficha/estado de cuenta/Panel Campo |
| Planta | POS a crédito | `cobranzas_planta` | `abonos_planta` | `/dashboard/cobranzas-planta` |

Invariantes:

- Un CPE de Campo no crea `facturas`.
- Un CPE/reintento de Planta no crea `facturas`.
- Una misma deuda no debe existir en dos carteras.
- Marcar una cobranza de Ejecutivas como pagada no crea una transacción bancaria/caja: es una decisión vigente documentada en [10 §7](./10-pos-caja-tesoreria.md).

---

## 2. Ejecutivas: tabla `facturas`

El CPE aceptado/observado crea o enlaza una fila de cobranza una sola vez. La entrega del pedido no debe crear una segunda deuda.

Campos funcionales principales:

- comprobante/pedido/asesora;
- cliente y monto total tomado del CPE;
- fecha de emisión, vencimiento y plazo;
- estado de cobranza;
- fecha/método/detalle de pago;
- voucher en base64/mime;
- auditoría de anulación.

### Estados

1. `Pendiente`: deuda activa no vencida.
2. `Vencida`: deuda activa cuyo plazo terminó; el cron la actualiza.
3. `Pagada`: pago confirmado.
4. `Anulada`: fuera de cartera por anulación/NC según el flujo.

> [!WARNING]
> Para calcular deuda usa `estado IN ('Pendiente','Vencida')`. `estado <> 'Pagada'` incluiría anuladas.

Las asesoras solo ven/gestionan cobranzas de su alcance; el admin ve todas.

---

## 3. Campo: saldo derivado y abonos

Campo no persiste un "saldo actual". La fuente canónica es `src/lib/avicola/saldos.ts`:

```text
saldo_actual = saldo_anterior
             + suma(ventas no anuladas)
             - suma(abonos no anulados)
```

Un saldo negativo es dinero a favor del cliente. Para cartera gerencial solo se suman saldos positivos.

### Abonos individuales

`abonos_avicola` registra cada pago con fecha, hora de creación, medio, nota, monto y evidencia opcional. `src/lib/avicola/estado-cuenta.ts` ordena ventas y abonos y calcula el saldo posterior de cada movimiento.

Si el mismo cliente entrega tres abonos el mismo día:

| Hora | Medio | Monto | Saldo posterior |
|---|---|---:|---:|
| 09:15 | Yape | S/ 100 | S/ 400 |
| 13:40 | Efectivo | S/ 150 | S/ 250 |
| 18:05 | Transferencia | S/ 50 | S/ 200 |

Pantalla y PDF deben mostrar las tres filas. El total diario puede usarse en el libro mayor; la guía
de una venta usa la ventana de abonos posteriores hasta la siguiente venta no anulada. Ningún resumen
debe sustituir el detalle que Antonio entrega al cliente.

Reglas adicionales:

- PK generada en frontend y reutilizada en reintentos para idempotencia.
- Sobrepago requiere confirmación y puede dejar saldo a favor.
- Anulación es soft-delete con motivo; el movimiento anulado no modifica el saldo.
- Un CPE activo/error/aceptado vuelve inmutable la venta; si todos los CPE 01/03 fueron rechazados,
  puede corregirse para emitir un reemplazo auditado. La NC total aceptada anula la venta.

---

## 4. Planta: cartera propia

Las ventas POS a crédito usan `cobranzas_planta` y sus pagos parciales viven en `abonos_planta`. No pasan por `facturas`.

Una emisión o reintento CPE de Planta debe reconocer `pedidos.origen='pos_planta'` y enlazar la cartera propia. Una NC total aceptada anula de forma automática solo deudas activas de Planta; si ya está pagada, la devolución se gestiona manualmente para no ocultar una salida real de dinero.

El detalle del modelo y flujos está en [25-clientes-cobranzas-planta.md](./25-clientes-cobranzas-planta.md).

---

## 5. Notas de Crédito y anulaciones

La operación del CPE base decide qué cartera se afecta:

| CPE base | Efecto de NC total aceptada |
|---|---|
| Ejecutivas | anula la fila activa de `facturas` |
| Campo | anula automáticamente `ventas_avicola` con auditoría y retira la venta del saldo; no existe `facturas` que anular |
| Planta | anula deuda activa de `cobranzas_planta`; pagada requiere devolución manual |

No basta con mirar `venta_avicola_id`: para Planta se debe cargar el origen del pedido, incluso en reintentos y NC.

---

## 6. Consolidado y aging

`/api/consolidado` muestra por separado:

- `totalCobrar`: Ejecutivas (`facturas` activas);
- `carteraCampo`: suma de saldos positivos de Campo;
- `carteraPlanta`: saldos activos de Planta.

El aging clásico de `/api/cobranzas/aging` pertenece a Ejecutivas. No debe presentarse como aging total del negocio salvo que se integren explícitamente las fechas/reglas de las otras dos carteras.

---

## 7. Impacto de cambios

| Si cambias… | Revisa también… |
|---|---|
| creación de cobranza al emitir/reintentar | operación del CPE, idempotencia y las tres tablas de cartera |
| estados de deuda | Consolidado, aging, crons y filtros activos |
| NC | cartera del CPE base, pagos ya realizados y anulación de venta Campo |
| abonos de Campo | saldos, historial, guía, modal, PDF y prueba de tres abonos |
| abonos de Planta | saldo parcial, estados, POS y devoluciones |
| tesorería | caja/cuentas; no asumas que una cobranza pagada mueve dinero automáticamente |

Pruebas obligatorias: [24 §6–9](./24-pruebas-regresion-despliegue.md).

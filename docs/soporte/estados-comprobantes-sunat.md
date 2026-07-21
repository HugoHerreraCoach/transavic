# Guía para asesoras: estados de comprobantes SUNAT

> **Actualizado:** 2026-07-20
> **Objetivo:** saber si un comprobante vale y qué hacer sin emitir duplicados.

## Regla de oro

Si el sistema muestra **Por confirmar**, no emitas otra factura o boleta y no
emitas una Nota de Crédito. El mismo número está protegido. El proceso automático
corre cada cinco minutos y consultará ese mismo número cuando corresponda. También
puedes usar **Verificar ahora**.

## Matriz rápida

| Lo que ves | Qué significa | Qué debes hacer | No hagas esto |
|---|---|---|---|
| **Aceptado** | SUNAT confirmó el comprobante. Es válido. | Entrégalo al cliente y continúa el flujo normal. | No emitas otro por la misma venta. |
| **Aceptado**, pero sin botón CDR | SUNAT confirmó el estado, pero la constancia no está disponible para descargar. | Trátalo como aceptado. El sistema intentará recuperar el CDR de la factura cuando corresponda. | **No emitas una NC solo porque falta el CDR.** |
| **Observado** | SUNAT lo aceptó con una observación. Sigue siendo válido. | Lee el mensaje y corrige el dato para futuras emisiones si corresponde. | No lo dupliques ni lo anules automáticamente. |
| **Por confirmar** | SUNAT pudo recibirlo, pero todavía no dio un resultado final. | Espera la consulta automática o pulsa **Verificar ahora**. | No emitas otro correlativo ni una NC. |
| **No registrado** | Después de las consultas de seguridad, SUNAT no encontró ese número. | Usa **Reintentar mismo número** si el sistema lo ofrece. | No crees manualmente otro correlativo. |
| **Rechazado** | SUNAT evaluó el documento y no lo aceptó. | Lee el motivo, corrige los datos y usa el flujo que muestre el sistema. | No reenvíes el mismo XML sin corregir y no emitas NC de un rechazo. |
| **Error** | El envío o proceso necesita una acción controlada. | Sigue el botón y el mensaje de esa fila; si dice reintentar, conserva el mismo número. | No abras otro comprobante para evitar el error. |
| **Corregida con FC…** | El comprobante fue aceptado, pero la NC indicada neutralizó sus efectos. | Abre la NC indicada como sustento y conserva ambos documentos. | No emitas otra NC sobre el mismo comprobante. |

## XML, CDR y estado no son lo mismo

- **XML:** es el documento generado y firmado. Tener XML no demuestra por sí
  solo que SUNAT lo aceptó.
- **CDR:** es la constancia que SUNAT devuelve. El botón aparece solo cuando el
  sistema guardó un ZIP legible y válido.
- **Estado aceptado:** también puede confirmarse mediante la consulta oficial del
  mismo RUC, tipo, serie y número. Por eso un aceptado puede no tener CDR
  descargable y continuar siendo válido.

La ausencia de CDR no convierte un aceptado en rechazado y no justifica una Nota
de Crédito.

## Cuándo corresponde una Nota de Crédito

Una NC se emite cuando existe un comprobante **aceptado** que debe anularse o
corregirse legalmente. Debes abrir exactamente la fila que se quiere corregir:
la NC neutraliza solo ese comprobante, no todos los comprobantes del pedido.

No corresponde emitir NC cuando:

- el comprobante está `por_confirmar`;
- solo falta la descarga del CDR;
- el comprobante fue rechazado y nunca quedó válido;
- ya aparece **Corregida con FC…** y el número exacto de la NC.

## Caso F002-412 y F002-413

1. SUNAT terminó confirmando como aceptadas F002-412 y F002-413 para la misma
   venta.
2. F002-412 no tenía CDR descargable, pero la consulta oficial confirmó que sí
   estaba aceptada. La falta de CDR no era la razón para anularla.
3. Como existían dos facturas aceptadas, se eligió conservar F002-413.
4. La NC FC02-00000028 fue aceptada y referencia exclusivamente a F002-412.
5. F002-412 permanece en el historial como aceptada, pero queda corregida por
   FC02-00000028. F002-413 permanece vigente y conserva la única deuda.

Para este caso no se debe emitir otra factura ni otra NC.

## Qué hace el sistema durante una espera

- Reserva la fila, XML y correlativo antes de comunicarse con SUNAT.
- Bloquea una segunda emisión mientras el estado sea `emitiendo` o
  `por_confirmar`.
- Cada cinco minutos consulta hasta tres comprobantes pendientes, uno por uno.
- Para facturas consulta estado y CDR; para boletas usa la Consulta Integrada.
- El proceso de consulta **nunca usa `sendBill`**, nunca firma otro XML y nunca
  crea un correlativo nuevo.
- Si SUNAT acepta tarde, enlaza la deuda una sola vez. Si ya existe otro
  comprobante aceptado para la venta, no duplica la deuda y pide elegir cuál se
  corregirá.

Solo escala el caso cuando la propia pantalla indique **Requiere revisión** o
cuando existan dos comprobantes aceptados para la misma venta. Mientras diga
**Por confirmar**, la acción correcta es esperar o verificar el mismo número.

# 21 — Clientes Avícola (venta en campo del Gerente General)

> **Creado:** 2026-07-07 · **Última verificación:** 2026-07-13 · **Estado:** BETA en producción; código y esquema de facturación de Campo desplegados
> **Requerimiento origen:** docx "Requerimiento de Implementación — Módulo Clientes Avícola" (Antonio/Nelita, 7 jul 2026)
> **Cuándo leer esto:** vas a tocar cualquier cosa bajo `src/app/dashboard/clientes-avicola/`, `src/app/api/avicola/` o `src/lib/avicola/`.

---

## 1. Qué es y qué NO es

**Es** el módulo de la operación de venta n.º 1 de Antonio: él mismo visita puestos de mercados y
avícolas, vende por peso (kg × precio/kg), **cobra deudas (abonos)** y manda una **guía interna por
WhatsApp** en el momento. Reemplaza el Excel de control de saldos. Optimizado para celular.

**NO es**:
- El flujo de las asesoras (operación 2: CRM leads → pedidos → despacho). Sus tablas, clientes,
  cartera, pagos y métricas siguen separados.
- El POS de planta (operación 3), que usa `pedidos.origen='pos_planta'` y cartera propia.
- Una GRE: la "guía de venta" es un documento INTERNO informal (correlativo propio
  `guia_avicola` en la tabla `correlativos`), distinto de la GRE legal (`comprobantes_guias`) y
  de la orden de pedido. Campo **sí puede emitir CPE SUNAT** reutilizando el motor compartido.

### Las 3 operaciones de venta (definidas por Antonio, 7 jul 2026)

| # | Operación | Módulo | Estado |
|---|---|---|---|
| 1 | Venta en campo (mercados/avícolas), con cobranza y guía inmediata | **Clientes Avícola** (este doc) | ✅ construido |
| 2 | Ejecutivas → negocios (restaurantes, chifas, dark kitchens) | CRM leads + pedidos + despacho | ✅ existente. ⚠️ "Cotizaciones" formales NO existen (solo etapa "Propuesta" del kanban) — pendiente confirmar con Antonio si las necesita |
| 3 | Venta rápida en planta | POS planta | ✅ existente + panel post-venta agregado (Imprimir orden / Emitir comprobante) el 7 jul 2026 |

---

## 2. Decisión de arquitectura: independencia operativa e integración tributaria controlada

Campo conserva tablas propias y no escribe en `pedidos`, `clientes` ni `facturas`. La única
integración deliberada es `comprobantes.venta_avicola_id`, que permite reutilizar el motor SUNAT,
las descargas, la NC y la GRE sin duplicar el dominio de ventas. Razones:
1. El requerimiento lo pide textual ("completamente independiente del módulo de ventas de las ejecutivas").
2. Reutilizar `pedidos` con un `origen` nuevo **contaminaría las metas/ranking de asesoras**: los
   filtros son `COALESCE(origen,'asesor') <> 'pos_planta'` (en `ventas-metricas.ts`,
   `datos-ventas.ts`, `insights.ts`) y un origen nuevo caería del lado "asesor".
3. `pedidos` arrastra máquina de estados/despacho/riders que aquí no aplican; `facturas` no modela
   abonos parciales; `clientes` tiene scoping por asesora.

Consecuencia vigente:

- **Metas, rachas y ranking de asesoras NO incluyen Campo.** La vista `ventas_facturadas` también
  excluye el CPE de Campo y su NC.
- **Ventas Generales, Consolidado y el comparativo Hoy/Ayer SÍ incluyen Campo** a través de
  `src/lib/ventas-generales.ts`; no leen `facturas` para hacerlo.
- **La deuda de Campo sigue siendo propia:** `saldo_anterior + ventas - abonos`. Emitir un CPE
  nunca crea una fila en `facturas`.

La relación con las otras dos operaciones está documentada de punta a punta en
[22-operaciones-ventas-facturacion.md](./22-operaciones-ventas-facturacion.md).

---

## 3. Modelo de datos

Migración: `scripts/migrate-clientes-avicola-2026-07-07.sql` (idempotente, por psql — gotchas #13/#17).

```
clientes_avicola      nombre, mercado (texto libre), numero_puesto?, telefono?, direccion?,
                      observaciones?, empresa (Transavic|Avícola de Tony → logo de la guía),
                      saldo_anterior NUMERIC (deuda pre-sistema, editable, puede ser negativo),
                      activo BOOLEAN
ventas_avicola        id UUID SIN default (lo genera el CLIENTE → idempotencia), cliente_id,
                      numero_guia INT UNIQUE (correlativo "guia_avicola"), fecha DATE Lima,
                      total (calculado en SERVER), anulada + anulacion_motivo (CHECK), creado_por
venta_avicola_items   producto_id? (FK viva p/ reporte kg), producto_nombre (denormalizado),
                      peso_kg > 0, precio_kg >= 0, subtotal = round2(peso*precio) server-side
abonos_avicola        id UUID del cliente (idempotencia), cliente_id, fecha, monto > 0,
                      medio_pago (efectivo|transferencia|yape|plin|otro),
                      comprobante_data/mime (foto webp base64, single-photo),
                      anulado + anulacion_motivo, creado_por
```

### Reglas de oro
1. **El saldo NUNCA se persiste** — se calcula al vuelo:
   `saldo_actual = saldo_anterior + Σ ventas (NOT anulada) − Σ abonos (NOT anulado)`.
   Única fuente: **`src/lib/avicola/saldos.ts`** (`listaClientesConSaldo`, `estadoCuentaCliente`,
   `estadoCuentaParaGuia`). NO dupliques esos SUMs.
2. **Anulación soft, nunca DELETE** (motivo obligatorio ≥5 chars). Toda query filtra
   `NOT anulada/anulado` — misma disciplina que `facturas.estado='Anulada'` (gotcha #24).
   Una venta se puede editar mientras **todavía no tenga CPE activo**: PATCH
   `/api/avicola/ventas/[id]` cambia peso/precio/fecha/observaciones, recalcula el total en server
   (transacción atómica) y audita `modificada_por`/`modificada_at`. Un CPE `emitiendo`, pendiente,
   `error`, aceptado u observado bloquea la edición: el XML y el saldo no pueden divergir. Si **todos**
   los CPE 01/03 están rechazados, la venta se puede corregir y emitir un reemplazo con otro correlativo
   y vínculo de auditoría. Una NC total aceptada con código `01`, `02` o `06` anula automáticamente
   la venta de Campo; el endpoint de anulación también reconoce esa evidencia legal como respaldo.
3. **La fecha de la venta es seleccionable** (alta y edición): **retroactiva permitida** (para cargar lo
   de un domingo/feriado o cuando la asistente no registró), **futura NO** (validado en server, zona Lima).
   Por defecto es hoy; en la UI es un chip compacto en el header ("Hoy", o ámbar con el día si es pasado).
4. **Idempotencia doble-tap**: la PK de venta/abono la genera el FRONTEND (`crypto.randomUUID()` al
   montar el form, reusada en reintentos). El POST pre-checkea por id y captura `23505` → responde
   200 con lo ya guardado (mismo número de guía). No quitar.
5. **La guía es reimprimible y estable**: su estado de cuenta va ANCLADO al `created_at` de la venta
   (`estadoCuentaParaGuia`): `saldo_previo` = movimientos anteriores; `abonos_aplicados` = pagos
   registrados después de esa venta y antes de la siguiente venta no anulada. La ventana puede cruzar
   de fecha; el corte por `created_at` evita atribuir a esa guía pagos de otra venta.
6. Sobrepago de abono = **409 blando** (`requiere_confirmacion`) + `permitir_sobrepago:true` →
   saldo negativo se muestra "a favor". La cartera usa `GREATEST(saldo, 0)`.
7. Cliente **inactivo**: ventas bloqueadas (409), abonos permitidos, deuda sigue en cartera/rankings.
8. **La grilla de productos se ordena sola** (9 jul 2026, pedido de Antonio): en la venta, el catálogo (~90
   ítems) se corta en secciones — **Fijados** (estrella manual, `localStorage` `transavic_avicola_favoritos`,
   por dispositivo) → **Lo de siempre** (lo que ESE cliente ya compró, ordenado por **frecuencia** y desempate
   por recencia) → **Más vendidos** (top global, solo si el cliente aún no compró nada) → **Todo el catálogo**.
   Cada producto aparece UNA vez. Además hay un botón **"Repetir última venta"** que siembra los productos de la
   última venta con su precio y los pesos vacíos, con el foco en el primer peso (solo con el carrito vacío, para
   no pisar nada). Ese botón **previsualiza** qué trae: 2ª línea con hasta 2 nombres **truncados** + una píldora
   con el **TOTAL** ("3 productos"). Se muestra el total —y no "+N restantes"— **a propósito**: como los nombres
   del catálogo son larguísimos y se recortan, un "+1 más" haría creer que son 2 cuando son 3. Las 3 consultas
   viven en `venta/page.tsx`.
9. **Buscador de productos** (9 jul 2026): fijo en el header (2ª fila, siempre visible al scrollear), filtra el
   catálogo en vivo **por nombre O categoría** (escribir "pollo" trae todo el pollo; "alas" trae solo Alas), con
   estado "no se encontró…" + botón para limpiar. Al buscar, **las secciones se aplanan** en una sola lista
   filtrada: el buscador manda y no hay que pensar en secciones.
10. **v1 NO toca inventario ni caja/cuentas** (decisión 7 jul 2026): no se sabe cómo se abastece el
   camión de Antonio (pendiente confirmar). Los kg por producto/día SÍ quedan registrados
   (`venta_avicola_items` + liquidación) → activar el descuento después es un cambio acotado.
11. **Los abonos del mismo día NUNCA se colapsan en el estado de cuenta**: pantalla y PDF usan
    `src/lib/avicola/estado-cuenta.ts` y conservan cada movimiento con hora Lima, medio de pago,
    monto, nota y saldo posterior. El total diario sigue existiendo para la aritmética, pero si un
    cliente hace 3 pagos, el PDF que recibe muestra los 3 por separado.

---

## 4. Mapa de archivos

| Capa | Archivo | Qué hace |
|---|---|---|
| Lib | `src/lib/avicola/types.ts` | Tipos + `MEDIOS_PAGO_AVICOLA` + shapes de respuesta de TODAS las APIs |
| Lib | `src/lib/avicola/saldos.ts` | Aritmética del saldo (única fuente) |
| Lib | `src/lib/avicola/historial.ts` | Historial ventas+abonos intercalado (anulados marcados) |
| Lib | `src/lib/avicola/estado-cuenta.ts` | Libro mayor por día; conserva cada abono individual para pantalla/PDF |
| Lib | `src/lib/avicola/guia.ts` | `guiaDeVenta()` → `GuiaAvicolaData` completa para el ticket |
| Lib | `src/lib/reportes/pdf-estado-cuenta-avicola.ts` | PDF estado de cuenta (jsPDF, clon de pdf-ventas) |
| API | `src/app/api/avicola/clientes` (+`[id]`) | CRUD + ficha con historial |
| API | `src/app/api/avicola/ventas` (+`[id]`, `[id]/anular`) | POST idempotente (`sql.transaction` patrón POS), guía |
| API | `src/app/api/avicola/abonos` (+`[id]/anular`, `[id]/comprobante`) | Abonos + sobrepago + foto |
| API | `src/app/api/avicola/liquidacion` · `dashboard` | Reportes (shapes en types.ts) |
| UI | `clientes-avicola/page.tsx` + `lista-client.tsx` | Home: búsqueda client-side, chips mercado, Vender/Abonar |
| UI | `[id]/page.tsx` + `ficha-client.tsx` | Ficha 360: héroe 2×2, historial, reenviar guía, anular |
| UI | `[id]/venta/*` | Venta rápida y **edición** (`?edit=<uuid>`): buscador fijo en el header + chip de fecha compacto ("Hoy"/ámbar si es retroactiva); productos en secciones (Fijados ⭐ → Lo de siempre → Más vendidos → Todo el catálogo) con **último precio por cliente+producto**; botón "Repetir última venta"; footer sticky |
| UI | `ticket-guia-avicola.tsx` + `guia-avicola-modal.tsx` | Ticket 500px + toJpeg → `navigator.share` (clon ticket-share-modal); toggle precios en localStorage `transavic_avicola_opcion_guia` |
| UI | `abono-modal.tsx` · `cliente-avicola-form.tsx` · `estado-cuenta-modal.tsx` | Modales compartidos |
| UI | `liquidacion/*` · `panel/*` | Liquidación del día + panel gerencial |

Acceso: **solo `admin`** (guard en cada page + cada API). Sidebar: entrada Primary+Beta en
"Ventas & CRM" (`DashboardLayout.tsx`); guía de pasos clave `"clientes-avicola"` en `guias-modulos.ts`.

## 5. La guía de venta (req. §7-9 del docx)

- Correlativo propio: tipo `"guia_avicola"` en `src/lib/correlativos.ts` (UPSERT, arranca solo).
- Selector de 2 formatos (req. §8): "Con precio por kilo" / "Solo peso y total" — la Opción 2 oculta
  ÚNICAMENTE la columna precio/kg; el importe por producto y el total SIEMPRE se muestran.
- Bloque estado de cuenta (req. §9): Saldo anterior / Esta venta / Abonos aplicados hasta la
  siguiente venta (si existen) / SALDO ACTUAL.
- Envío: JPEG generado con `html-to-image` (pixelRatio 2.5) → `navigator.share({files})` → WhatsApp.
  Fallback: Descargar. El logo sale de `clientes_avicola.empresa`.
- ⚠️ **El logo del ticket** (ver **gotcha #43**): va como `data:` URL, así que **NUNCA** le pongas
  `crossOrigin` al `<img>` — en WebKit/iOS eso fuerza una petición CORS que falla y **la guía sale sin logo en
  iPhone** (en Chrome de escritorio sí se ve, por eso es fácil no cazarlo). Y antes de `toJpeg` hay que esperar
  `await img.decode()` de las imágenes del ticket: `html-to-image` en iOS omite las que no están decodificadas.

## 6. Guardar SEPARADO de enviar la guía + venta de hoy (10 jul 2026 — video de Antonio)

Los dos momentos del día del GG en campo mandan el flujo (`venta-client.tsx`):

- **Footer con DOS botones**: primario "**Guardar**" (crear) / "**Actualizar**" (editar) — guarda
  SIN abrir el modal de la guía (en la mañana solo se registra el peso); secundario "Guardar y
  enviar guía" / "Actualizar y enviar guía" — abre el modal para compartir. La guía siempre se
  puede enviar después ("Reenviar guía" / "Enviar guía" en la ficha).
- **Destinos post-guardar** (`destinoPostGuardar`): crear → **lista** (en la mañana encadena
  clientes); editar → **ficha del cliente** (en la tarde está cobrando a ESE cliente). El cierre
  del modal de guía usa los mismos destinos por modo.
- **Tarjeta "Venta de hoy"** en la ficha (`ficha-client.tsx:ventasDeHoy`, hoy-Lima con `Intl`):
  al abrir al cliente para cobrar, las ventas del día salen destacadas con botones grandes
  "Ajustar peso/precio" (→ `?edit=id`) y "Enviar guía" — sin buscar en el historial.
- El botón "Reintentar" tras un error de red repite EXACTAMENTE el modo del último intento
  (con o sin guía, ref `ultimoModoEnvio`).

## 7. Facturación SUNAT de la venta en campo (12 jul 2026 — pedido de Antonio)

**Antonio (dueño/GG) es quien personalmente hace la venta en campo.** Ahora puede **facturar
las ventas de campo que elija** (factura/boleta y, sobre ellas, GRE y Nota de Crédito),
REUTILIZANDO el mismo motor de las ejecutivas (sin duplicar código — pedido explícito).

**Cómo funciona (gotcha #47):**
- **Vista nueva** `/dashboard/clientes-avicola/ventas` (`ventas-campo-client.tsx`, admin-only):
  lista las ventas por fecha (Hoy/Ayer/fecha), con estado de facturación por venta
  ("Sin comprobante" / "Facturado B001-…") y acción **Facturar** (+ selección múltiple para
  lote 1:1). Consume `GET /api/avicola/ventas` (ya soportaba rango de fechas; se le agregó un
  `LEFT JOIN LATERAL` a `comprobantes` por `venta_avicola_id` para el badge).
- **Facturar** abre el MISMO formulario de emisión (`comprobantes/nuevo/emitir-client.tsx`) en
  un modal, precargado desde la venta (`ventaAvicolaIdProp` → `GET /api/avicola/ventas/[id]`):
  `peso_kg`→cantidad KGM, `precio_kg`→precio CON IGV, `producto_nombre`→descripción; cliente y
  empresa desde `clientes_avicola`. Sin `pedidoId` → emite por **`/api/comprobantes/emitir-manual`**
  con `ventaAvicolaId`.
- **El motor** (`src/lib/sunat/index.ts` + `emitir-manual`): persiste `comprobantes.venta_avicola_id`
  y, con `esCampo = !!ventaAvicolaId`, **NO crea cobranza en `facturas`** (la deuda ya vive en el
  saldo avícola). Antes de validar o consumir correlativo adquiere un claim temporal en la venta;
  editar/anular y un segundo POST quedan bloqueados. Antes del SOAP reserva una fila `emitiendo`;
  el índice único parcial impide dos CPE para la misma venta. La fila se actualiza con XML/CDR/estado,
  los errores se reintentan con el mismo correlativo y una reserva interrumpida >15 min pasa a `error`.
  La NC adquiere otro claim en el CPE base antes de su contador; reserva+índice cierran la carrera
  de una segunda NC activa. La vista
  `ventas_facturadas` excluye Campo y sus NC de las metas de asesoras.
- **RUC del cliente de campo:** `clientes_avicola` no lo tenía → columna nueva `ruc_dni`. Para
  FACTURA se consulta en el form y se guarda server-side. Si ya hay RUC guardado, la siguiente
  emisión vuelve a consultar la razón social/dirección fiscal. El servidor consulta API Perú otra vez
  y usa el dato oficial aunque se manipule el payload; no reutiliza el nombre informal del puesto.
- **NC y GRE:** gratis. Una vez que el comprobante de campo existe en `/dashboard/comprobantes`,
  sus botones (Nota de Crédito, emitir GRE) funcionan con el flujo existente. La GRE toma la
  dirección del cliente de campo (del XML firmado del comprobante).
- **Colores por operación** (`src/lib/operaciones-venta.ts`): 🛵 Ejecutivas azul, 🏪 Campo ámbar,
  🏭 Planta violeta — chip en la lista de comprobantes (+ filtro `?operacion=`), tarjetas de
  Ventas Generales y puntos en los grupos del sidebar.
- **Vistas generales:** `/dashboard/comprobantes` es el hub de **facturación general** ("Comprobantes
  (todos)" en el sidebar, con filtro de operación); `/dashboard/ventas-generales` (nuevo) muestra las
  **ventas** de las 3 operaciones por fecha; el **Consolidado** ahora incluye Campo (ventas de hoy +
  cartera avícola).
- **Vistas de comprobantes SEPARADAS por operación** (12 jul 2026, pedido de Hugo — el menú no tenía
  entrada dedicada): la MISMA lista `ComprobantesClient` acepta un prop `operacionFija` que la amarra a
  una operación, oculta el filtro de Operación y adapta el header/CTA. Rutas: **🏪 `/dashboard/clientes-avicola/comprobantes`**
  ("Comprobantes de Campo", admin, solo campo) y **🛵 `/dashboard/comprobantes/ejecutivas`**
  ("Comprobantes", admin+asesor, solo ejecutivas). En el sidebar cada operación tiene su entrada; Finanzas
  conserva "Comprobantes (todos)".

Migración: `scripts/migrate-facturacion-campo-2026-07-12.sql` (por psql ANTES del deploy — #17).

### 7.1 Estados Venta ↔ CPE

| Estado de la venta | Acción permitida |
|---|---|
| Sin CPE ni claim | editar, anular o facturar |
| Claim de facturación activo | no editar/anular; esperar o recuperar si superó 15 minutos |
| CPE `emitiendo` | no crear otro; la reserva protege el correlativo mientras sale a SUNAT |
| CPE `aceptado`/`observado` | no editar; para anular la venta se requiere NC total aceptada |
| CPE `error` | reintentar la misma fila y el mismo correlativo |
| CPE `rechazado` | conservar XML/CDR, corregir la venta/receptor y usar **Corregir y emitir nuevo**; crea nuevo correlativo enlazado por `reemplaza_comprobante_id` |

El detalle de claims, índices, NC y consumidores está en [22 §4–5](./22-operaciones-ventas-facturacion.md).

## 8. Pendientes de negocio y operación

1. ¿Cómo se abastece el camión? → decide si las ventas de campo descuentan inventario (hoy NO).
2. ¿Algún cliente de mercado compra bajo "Avícola de Tony"? (el campo ya existe, default Transavic).
3. ¿Necesita cotizaciones formales en el CRM (operación 2)? Hoy no existen como documento.
4. Migración a producción: aplicar el SQL por psql ANTES del deploy (gotcha #17).
5. Facturación de campo: ¿precio_kg va CON IGV? (se asume que sí, gotcha #10 — validar en la 1ª
   emisión real). La anulación de una venta facturada ya exige NC total aceptada.
6. Aplicar también `migrate-reemision-cpe-campo-rechazado-2026-07-12.sql` antes del deploy. El
   rechazado se conserva; cada reemplazo apunta al intento anterior y un índice impide dos hijos.
7. Aplicar después `migrate-nc-error-reintento-unico-2026-07-12.sql`: una NC en `error` con XML
   firmado debe reintentar el mismo correlativo y no habilitar otra NC paralela.

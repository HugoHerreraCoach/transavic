# 18 — Plan Maestro de Implementación (Sistema Integral Transavic)

> **Fecha:** 2026-06-28
> **Alcance:** Implementación del paquete "Sistema Completo S/ 12,000" (Excluye integración de balanzas IoT).
> **Estrategia:** Desarrollo 100% en entorno local usando una rama de desarrollo en Neon Postgres para evitar romper producción. Despliegue fase por fase.

Este plan detalla la hoja de ruta técnica para construir los 19 módulos (agrupados en 7 áreas) de la cotización.

---

## Estrategia de Base de Datos y Entorno Local

1. **Rama de BD:** Todo el desarrollo se realizará sobre la base de datos `dev-hugo` (o una rama limpia a partir de producción) configurada en el archivo `.env.local`. Nada tocará la URL de producción.
2. **Migraciones Ordenadas:** Se crearán scripts iterativos (Fase 1, Fase 2, etc.) en la carpeta `scripts/` para que la estructura vaya mutando localmente de forma segura.

---

## Fases de Implementación

El enfoque será construir de atrás hacia adelante en la cadena de suministro (desde la compra hasta la cobranza) para que los datos fluyan correctamente.

### Fase 1: Cimientos, Roles y Estructura (Área 7 y 5)
*Adaptar el esquema actual para soportar los 19 módulos.*
- **Base de Datos:** Ampliación del esquema Neon para incluir `proveedores`, `compras`, `gastos`, `caja_diaria`, y `cuentas_por_pagar`.
- **RBAC (Roles Granulares):** Refactorizar `lib/roles.ts` para separar vistas entre `admin`, `facturacion`, `produccion`, `asesor` y `repartidor`.
- **Auditoría Interna:** Implementación de Triggers en PostgreSQL (ej. tabla `precios_audit_log`) para registrar silenciosamente cada cambio de precios (quién y cuándo).

### Fase 2: Control de Costos, Mermas y Operación (Área 1)
*El núcleo productivo que reemplazará al sistema de Ariana (Avitech).*
- **Directorio de Proveedores y Cuentas por Pagar:** Registro y control de deudas con granjas.
- **Préstamo de Mercadería (Proveedores):** Módulo para registrar préstamos entre proveedores. El control y pago debe ser estrictamente en especie (mercadería), no monetario, mostrando cuánto debemos y cuánto nos deben.
- **Módulo de Compras (Kardex Inbound):** Formulario para registrar las compras (jabas, precio pactado).
- **Calculadora Reactiva de Mermas (Sin Balanza Automática):** Interfaz ágil en `/dashboard/produccion` donde Ariana digitará manualmente el `Peso Bruto` y `Peso Tara`. El sistema calculará automáticamente el `Peso Neto` y registrará el rendimiento de la merma de forma transparente.
- **Costeo Real:** Algoritmo de rentabilidad que cruce el precio de compra con la merma reportada.

### Fase 3: Punto de Venta Rápida en Planta y Finanzas (Área 3 y 2)
*Módulo independiente para registrar ventas de producción en <20 segundos y cuadrar el dinero interno.*
- **POS de Venta Rápida (Planta):** Vista optimizada con botones grandes por categorías (Menudencia, Hígado, Molleja, Patas, Cuello, Corazón, Pollo entero, Cortes, Saldos).
  - *No requiere:* RUC, dirección, tipo de negocio, ni ruta.
  - *Flujo:* Seleccionar Producto -> Digitar Peso/Cantidad -> Seleccionar Cliente (Al paso o Frecuente solo por nombre/celular) -> Pagar (Efectivo, Yape, Plin, Transferencia, Tarjeta).
  - *Ticket:* Botón "Enviar Resumen" para generar mensaje automático por WhatsApp.
  - *Impacto automático:* Registra venta interna, descuenta inventario, ingresa a caja, y actualiza el saldo del cliente (Saldo anterior + compra - pago).
- **Caja Diaria y Gastos:** Módulo para apertura, registro de ingresos, egresos y cierre ciego.
- **Reportes de Control Interno:** Reporte de ventas rápidas, ingresos generados, saldos pendientes y responsable de venta.

### Fase 4: CRM Comercial y Bot de IA en WhatsApp (Área 4)
*Inspirado en la lógica exitosa del proyecto `conexipema-eventos`.*
- **Gestión de Leads:** Kanban para agrupar prospectos y asignarlos a las asesoras.
- **Bot de Inteligencia Artificial:** Agente conversacional conectado a Meta Cloud API capaz de dar información, cotizar y agendar ventas iniciales.
- **Métricas:** Medición de cuántas conversaciones cierra cada asesora y cuántas cierra el bot.

### Fase 5: Dashboard Gerencial y Despliegue (Área 5 y 6)
- **Consolidado Antonio:** Una única pantalla que resuma ventas, caja, cuentas por cobrar y alertas de rentabilidad.
- **Intercambio de Mercadería:** Lógica para registrar pollos/jabas "prestados" a otros proveedores y su devolución en especie (sin cruzar caja).
- **Pruebas Finales y Pase a Producción:** Una vez aprobada cada fase localmente, se fusionará a `main` y se desplegará en Vercel.

---

## 📊 Estado real (auditoría 5 jul 2026)

En la práctica, las fases **NO se construyeron de forma secuencial sino EN PARALELO**: todos los módulos existen como código local (untracked, aún sin commit a `main`) trabajando contra la rama Neon `dev-hugo`. Producción no tiene ninguna de las 15 tablas nuevas (ver [02-modelo-datos.md §5](./02-modelo-datos.md)). Las reglas 4, 5 y 7 de este plan quedaron **ratificadas y precisadas el 5 jul 2026** como la métrica oficial de ventas por pedidos (atribución por `created_at` Lima, dos variantes de estado) — la definición canónica vive en [14-metas-incentivos.md §2](./14-metas-incentivos.md).

| Fase | Avance aprox. | Detalle |
|---|---|---|
| **F1 — Cimientos/RBAC** | ✅ Completa | `PERMISSIONS`/`hasPermission()` en `roles.ts`, rol `facturacion` declarado (sin usuarios), `precios_audit_log`. |
| **F2 — Compras/Mermas** | ~80% | Compras, proveedores, cuentas por pagar, préstamos de mercadería, mermas e inventario flexible operativos en local. |
| **F3 — POS/Caja** | ~70% | POS de planta (crea pedidos `origen='pos_planta'` con estado `Entregado` directo), caja diaria, gastos, cuentas bancarias y transacciones. |
| **F4 — CRM/Bot** | ~50% | Kanban + chat + rotación de leads con webhook de Meta y chatbot Gemini/Groq; **el envío SALIENTE de WhatsApp sigue siendo MOCK** (`console.log`). |
| **F5 — Gerencial** | ~40% | Consolidado y rentabilidad funcionales pero básicos. |

### Optimización operativa (Fase B, 5 jul 2026)

Tras la auditoría, el mismo 5 jul se ejecutó una ola de optimización sobre los módulos de la expansión. **Implementado y verificado contra código:**

- **Inventario REAL al entregar + kardex** (la mejora estructural de la fase): política de inventario formalizada — el stock lo mueven compras (+), ventas POS (−), ajustes manuales (± con motivo obligatorio) y los pedidos normales al pasar a **ENTREGADO** (− con `COALESCE(cantidad_real, cantidad)`; se repone al revertir). Implementación en `src/lib/inventario.ts` con guard de idempotencia `pedidos.inventario_descontado` (la offline-queue puede repetir el POST `/entregar` sin descontar doble), no-bloqueante (la entrega jamás falla por inventario) y kardex completo en `inventario_movimientos` (tipos `compra|venta_pos|entrega|reversion|ajuste`, migración `scripts/migrate-inventario-movimientos.sql`). Detalle: [09-compras-inventario-mermas.md](./09-compras-inventario-mermas.md) §4–5.
- **Compras:** la compra actualiza `productos.precio_compra` con el último costo real pagado (la rentabilidad deja de usar costos desactualizados) y `GET /api/compras?ultimos_costos=<proveedorId>` precarga los costos por producto del proveedor al registrar la carga de la madrugada. Todo el POST es UNA transacción batch (compra + ítems + inventario + kardex + costo + CxP a 30 días).
- **POS y caja:** venta de mostrador 100% atómica (pedido + stock + kardex + cobro por CTE o cobranza a crédito); caja con apertura atómica y **una sola caja abierta garantizada** por el índice único parcial `ux_caja_diaria_unica_abierta` (409 en conflicto). Detalle: [10-pos-caja-tesoreria.md](./10-pos-caja-tesoreria.md).
- **Inventario:** ajustes manuales con **motivo de lista cerrada** (detalle obligatorio si "Otro") + mini-kardex por producto (`GET /api/inventario?movimientos=<id>`).
- **Mermas:** validación física `limpio + menudencia ≤ bruto` (zod refine, cierra el ítem del backlog original) y **merma por lote** — vínculo opcional `mermas_diarias.compra_id` con selector de las cargas de HOY en la UI.
- **Préstamos:** kardex/historial por proveedor (`GET /api/prestamos/transacciones?proveedorId=`) sobre la semántica de signo documentada (positivo = el proveedor nos debe).
- **Hoy vs Ayer:** comparativo de ventas totales del negocio (Entregado incluyendo POS, por fecha de registro Lima) en `/api/rentabilidad` — responde "¿vendí más que ayer?" sin tocar filtros.
- **Toasts y polling:** reemplazo de `alert()` por `useToast`/`ToastContainer` y adopción de `usePollingVisible` (pausa con pestaña oculta — optimización de cómputo Neon) extendiéndose a las vistas de la expansión (al corte de esta verificación: toasts en compras, inventario, préstamos, mermas y POS; polling en inventario y cobranzas; caja y las vistas de finanzas restantes en despliegue ese mismo día — verificar cobertura por vista antes de asumirla).

### Fase C (5 jul 2026) — paso a producción

- **Marcador visual de beta:** los módulos nuevos llevan chip índigo **"Beta"** — el azul índigo es el marcador deliberado de fase beta en la app (sidebar y banners de guía); los elementos primarios vuelven al **rojo de marca** al aprobarse el módulo.
- **Guías de pasos removibles:** cada módulo beta muestra un banner colapsable "¿Cómo funciona este módulo?" (componente `src/components/GuiaModulo.tsx`, chip "Beta" incluido; recuerda su estado por módulo en `localStorage`). El contenido de TODAS las guías vive centralizado en **`src/lib/guias-modulos.ts`** (compras, mermas, pos-planta, caja-diaria, inventario, préstamos, proveedores, cuentas-por-pagar, cuentas, rentabilidad, consolidado, crm-leads) — al aprobar un módulo se borra su entrada de ese archivo y la guía desaparece sola, sin tocar la vista.
- **Runbook de despliegue:** las migraciones se aplican a producción **por psql ANTES del push** (gotchas #13/#17), en este orden: `migrate-produccion-fase-2-3-consolidado.sql` → `migrate-crm.sql` → `migrate-crm-extensions.sql` → rotación CRM (`migrate-crm-rotacion.mjs`, aplicar su SQL por psql) → `migrate-caja-unica-abierta.sql` → `migrate-inventario-movimientos.sql` → seed de inventario en cero (inicializar `inventario_lotes` a 0 para todo producto sin fila — el DML viene al final del consolidado).

### Backlog priorizado (benchmark de industria, 5 jul 2026)

1. **Plantillas de pedidos recurrentes por cliente** — "repetir el pedido de siempre" en un toque desde la ficha o el historial del cliente; ahorra tipeo diario a las asesoras con los clientes frecuentes.
2. **Alertas de caducidad por lote** — el pollo fresco rota en horas/días: avisar mercadería con más de N días desde su compra (base: `inventario_movimientos` tipo `compra` + fecha).
3. **Listas de precios por cliente/segmento** — precios pactados por cliente o rubro (restaurante vs mayorista) en lugar del precio único de catálogo + autorizaciones caso por caso.
4. **Liquidación de ruta / settlement del repartidor** — rendición de efectivo y devoluciones al volver de ruta. **Descartada por ahora:** el repartidor casi no cobra efectivo (ver decisión de cobranzas en [10 §7](./10-pos-caja-tesoreria.md)).
5. **Catch weight / kardex valuado por kg** — valorizar cada movimiento del kardex a su costo (S/, no solo kg) para margen bruto real por producto y día.
6. **POS con báscula integrada** — leer el peso directo de la balanza (serial/BT) en el POS de planta; elimina el error de digitación en la venta de mostrador.
7. **Notificación diaria de precios a asesoras** — publicar el precio del día (el pollo cambia a diario) por la campanita/comunicados al abrir la jornada.
8. **Refactor del CRM monolítico** — `crm-leads-client.tsx` (~4.100 líneas) separado en `ChatView`/`KanbanView`/`RotationView` + hooks propios.

### Backlog de optimización (deuda técnica detectada)

> Depurado el 5 jul 2026: los ítems de toasts, polling en caja y la validación de mermas salieron de esta lista porque ya se implementaron (ver "Optimización operativa" arriba); el refactor del CRM se movió al backlog priorizado (#8).

- **Estandarizar el formato de respuesta de las APIs nuevas:** algunos endpoints devuelven un array crudo y otros `{ data }`.
- **Montos como `float8` en consolidado/rentabilidad:** considerar la precisión (usar NUMERIC/redondeo consistente antes de mostrar).
- **KARDEX de préstamos abre modal sobre modal** — repensar la navegación.
- **Sidebar con >20 ítems** — agrupar por secciones o colapsables por rol.
- **Feature flags / `BetaPlaceholder` para módulos beta:** hoy NO hay flags de apagado; el marcador beta es visual (chip índigo + `GuiaModulo`); `BetaPlaceholder.tsx` solo se usa en `/dashboard/reportes`.
- **Envío real de WhatsApp saliente** (hoy mock en el webhook y en `/api/crm/leads/[id]/mensajes`) — ver el checklist de seguridad en [15-asistente-ia.md](./15-asistente-ia.md).
- **Rate limiting del webhook de Meta.**
- **Scopear `POST /api/transacciones` por rol** (hoy solo exige sesión) y **permitir tipo `billetera`** en el zod de `POST /api/cuentas` — pendientes menores detectados al documentar [10-pos-caja-tesoreria.md §4](./10-pos-caja-tesoreria.md).

---

## 💡 Reglas de Trabajo para este Proyecto
1. **Documentación:** Cada avance técnico se actualizará en los documentos `.md` de `docs/arquitectura/`.
2. **Responsive:** Absolutamente todas las nuevas vistas (POS, Compras, Caja) estarán diseñadas `mobile-first` (TailwindCSS) para ser usadas en tablets y celulares.
3. **Cero código a ciegas:** Se discutirá la lógica de cada bloque (ej. cómo calcular el costo) antes de programarlo.
4. **Métricas Comerciales (Esfuerzo de Venta):** Toda venta cuenta para las comisiones y bonos de la asesora en el instante en que el motorizado marca el pedido como `Entregado` en su aplicación de ruta, basándose en el **peso real** que despachó Producción. No importa si el cliente pagó al contado, a crédito, o si se emitió factura electrónica o nota de venta. JAMÁS se atan los bonos comerciales a las facturas de SUNAT.
5. **Pedidos Fallidos:** Los pedidos con estado `Fallido` NO suman a la cuota ni al bono mensual de la asesora (para evitar fraudes o registros inflados). Solo se contabilizarán excepcionalmente para mantener la "Racha Diaria" (gamificación motivacional del día), pero se descuentan del volumen real mensual.
6. **Flexibilidad de Precios:** Los precios al registrar el pedido inicial pueden ser 0 o nulos (ej: mercadería agotada, cortesía). Producción y Despacho son la barrera final que regulariza pesos reales y montos.
7. **Aislamiento de Ventas Rápidas (POS):** Todas las ventas del POS en planta deben registrarse con la etiqueta `origen = 'pos_planta'` en la tabla `pedidos` para excluirlas automáticamente del ranking y bonos de las asesoras comerciales.
8. **Modelo de Inventario Flexible:** Como el local de producción es prestado/compartido y a veces se compra mercadería sobre la marcha, el inventario no debe ser estricto ni bloqueante. La "Venta Rápida" (POS) debe permitir vender incluso sin stock previo registrado, asumiendo una regularización posterior (préstamo/compra).
9. **Cuentas y Métodos de Pago:** Todo ingreso de dinero (especialmente en POS) debe asociarse a una "Cuenta" o "Caja" (ej. Efectivo, BCP Antonio, Yape Empresa, Interbank). Debe ser un sistema de tesorería sencillo, permitiendo crear múltiples cuentas bancarias de forma dinámica.
10. **Proceso de Mermas (Pollo Muerto):** Transavic trabaja actualmente con pollo ya beneficiado (muerto), no vivo. Las mermas se calculan sobre la pérdida de frío (agua/sangre) o el trozado. El sistema debe calcular estas mermas actuales, pero su arquitectura debe estar preparada (desacoplada) para soportar conversión de "pollo vivo a eviscerado" si el negocio crece en un futuro.
11. **Modo Offline en Producción:** Aunque hay señal en planta, todas las vistas críticas de Producción (POS y pesado de pedidos) heredarán el sistema de `offline-queue` de los repartidores. Si Ariana pierde la conexión, el POS y los pesos guardados se encolan y se sincronizan al volver el internet, garantizando fluidez ininterrumpida.

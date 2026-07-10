// src/lib/guias-modulos.ts
// Contenido de las guías paso a paso de los módulos BETA (fase de prueba).
// ⚠️ TEMPORAL: cuando un módulo quede aprobado (feedback de Ariana/Antonio),
// se borra su entrada aquí y el banner desaparece solo — no hay que tocar la vista.
// Estilo "No me hagas pensar": pasos de UNA línea, verbo primero, cero jerga.

export interface PasoGuia {
  titulo: string;
  detalle?: string;
}

export interface GuiaModuloDef {
  nombre: string; // nombre visible del módulo
  pasos: PasoGuia[];
  nota?: string; // tip opcional (💡)
}

export const GUIAS_MODULOS: Record<string, GuiaModuloDef> = {
  "clientes-avicola": {
    nombre: "Clientes Avícola",
    pasos: [
      { titulo: "Busca al cliente por nombre o toca su mercado", detalle: "también puedes buscar por puesto o teléfono" },
      { titulo: "Toca Vender, elige los productos e ingresa el peso", detalle: "el precio sale solo del último que le cobraste; tócalo si cambió" },
      { titulo: "Toca Guardar y enviar guía y mándala por WhatsApp", detalle: "la guía muestra el saldo actualizado del cliente" },
      { titulo: "Los pagos se registran con Abonar", detalle: "el saldo se actualiza solo" },
    ],
    nota: "Al final del día, toca Liquidación para ver todo lo vendido y cobrado.",
  },
  "clientes-planta": {
    nombre: "Clientes de Planta",
    pasos: [
      { titulo: "Registra aquí a los clientes que compran en la planta a crédito", detalle: "solo el nombre es obligatorio" },
      { titulo: "Desde Venta Rápida, elige el cliente y cobra al Contado o al Crédito", detalle: "también puedes crear el cliente al vuelo desde el POS" },
      { titulo: "Las deudas a crédito van a Cobranzas Planta", detalle: "separadas de las cobranzas de las ejecutivas" },
    ],
    nota: "Estos clientes son SOLO de la planta; no se mezclan con los de las ejecutivas ni los del campo.",
  },
  "cobranzas-planta": {
    nombre: "Cobranzas de Planta",
    pasos: [
      { titulo: "Aquí ves solo las deudas de las ventas a crédito de la planta" },
      { titulo: "Toca Registrar abono para cobrar por partes ('saldito')", detalle: "el saldo se actualiza solo" },
      { titulo: "Puedes anular una deuda o un abono con un motivo" },
    ],
  },
  compras: {
    nombre: "Compras",
    pasos: [
      { titulo: "Elige el proveedor", detalle: "queda recordado para la próxima carga" },
      { titulo: "Agrega cada producto con jabas, peso bruto y tara", detalle: "el peso neto se calcula solo" },
      { titulo: "Revisa el costo", detalle: "se precarga el último pagado a ese proveedor; corrígelo si cambió" },
      { titulo: "¿Le devuelves mercadería? Cambia la fila a 'Devolución'", detalle: "resta del total de la guía y del inventario" },
      { titulo: "Servicios como 'Pelada de pollo': se digitan cantidad × precio", detalle: "suman a la deuda pero no entran al inventario" },
      { titulo: "Toca Registrar Carga", detalle: "crea la deuda al proveedor y suma el stock automáticamente" },
    ],
    nota: "Presiona Enter en el campo de costo para agregar otra fila sin usar el mouse.",
  },
  mermas: {
    nombre: "Calculadora de Mermas",
    pasos: [
      { titulo: "Elige la carga del día", detalle: "precarga el peso bruto de esa compra" },
      { titulo: "Ingresa el peso limpio y la menudencia" },
      { titulo: "Guarda el registro", detalle: "la merma y el rendimiento se calculan solos" },
    ],
  },
  "pos-planta": {
    nombre: "Venta Rápida",
    pasos: [
      { titulo: "Toca los productos para armar la venta", detalle: "marca con ★ tus más vendidos y quedan arriba" },
      { titulo: "Ajusta cantidad y precio en el carrito" },
      { titulo: "Elige Contado (a qué caja entra el dinero) o Crédito (qué cliente queda debiendo)" },
      { titulo: "Toca Confirmar Cobro", detalle: "descuenta el stock y registra el dinero al instante" },
    ],
    nota: "Si se corta el internet, la venta se guarda en el celular y se reintenta sola.",
  },
  "caja-diaria": {
    nombre: "Caja Diaria",
    pasos: [
      { titulo: "Abre la caja ANTES de la primera venta del día", detalle: "cuenta el efectivo físico e ingrésalo como monto inicial" },
      { titulo: "Registra cada gasto en el momento en que sale dinero", detalle: "por defecto sale de la caja de efectivo" },
      { titulo: "Al cerrar, usa \"Contar billetes y monedas\" y confirma", detalle: "el sistema compara lo contado contra lo esperado" },
    ],
    nota: "El cuadre de caja cuenta SOLO el efectivo de la caja de planta. Los cobros por Yape, Plin o banco no entran al conteo de billetes.",
  },
  inventario: {
    nombre: "Inventario",
    pasos: [
      { titulo: "El stock se mueve solo", detalle: "las compras suman; las ventas y entregas descuentan" },
      { titulo: "Ajusta a mano SOLO si hay una diferencia real", detalle: "siempre con motivo — queda registrado quién y por qué" },
      { titulo: "Toca Ajustar en un producto para ver su historial de movimientos" },
    ],
  },
  prestamos: {
    nombre: "Préstamos",
    pasos: [
      { titulo: "La tabla muestra el saldo con cada proveedor", detalle: "en jabas y kilos: quién le debe a quién" },
      { titulo: "Usa los botones de cada fila para registrar un préstamo o una devolución" },
      { titulo: "Revisa el historial que aparece en el formulario antes de guardar" },
    ],
  },
  proveedores: {
    nombre: "Proveedores",
    pasos: [
      { titulo: "Registra a cada proveedor: solo el nombre y el teléfono son obligatorios", detalle: "el RUC es opcional — déjalo vacío si es informal" },
      { titulo: "Marca si es principal o secundario" },
      { titulo: "Sus datos se usan en Compras y en Cuentas por Pagar", detalle: "regístralo una sola vez" },
    ],
  },
  "cuentas-por-pagar": {
    nombre: "Cuentas por Pagar",
    pasos: [
      { titulo: "Cada compra crea una deuda al proveedor automáticamente" },
      { titulo: "¿Le debías de antes? Usa el botón 'Deuda anterior'", detalle: "registra el saldo que tenías con el proveedor antes del sistema" },
      { titulo: "Cuando pagues, toca la deuda y registra el pago", detalle: "el dinero sale de la cuenta o caja que elijas" },
    ],
  },
  cuentas: {
    nombre: "Cuentas Bancarias",
    pasos: [
      { titulo: "Crea aquí las cajas y cuentas bancarias del negocio" },
      { titulo: "Sus saldos se mueven solos con las ventas, gastos y pagos" },
      { titulo: "¿El saldo no cuadra con el banco? Usa 'Ajustar saldo'", detalle: "queda registrado como ajuste manual con su motivo" },
    ],
  },
  gastos: {
    nombre: "Gastos",
    pasos: [
      { titulo: "Aquí ves todos los gastos registrados del negocio" },
      { titulo: "Los gastos se registran desde Caja Diaria", detalle: "esta vista es solo para consultar y filtrar" },
      { titulo: "Filtra por categoría o por fechas para revisar un periodo" },
    ],
  },
  configuracion: {
    nombre: "Configuración",
    pasos: [
      { titulo: "Aquí cambias las opciones y umbrales del negocio sin programador" },
      { titulo: "Agrega o quita categorías de gasto y tipos de documento" },
      { titulo: "Ajusta los porcentajes de margen, merma y rendimiento" },
      { titulo: "Toca Guardar y el cambio aplica en todo el sistema al instante" },
    ],
  },
  rentabilidad: {
    nombre: "Rentabilidad Real",
    pasos: [
      { titulo: "Arriba ves las ventas de hoy comparadas con ayer" },
      { titulo: "Los indicadores muestran cuánto cuesta el pollo listo para vender", detalle: "compra + merma del proceso" },
      { titulo: "Verde = ganancia por kilo · Rojo = pérdida" },
    ],
  },
  consolidado: {
    nombre: "Consolidado",
    pasos: [
      { titulo: "Es el resumen del dinero del negocio", detalle: "cuánto hay, cuánto te deben y cuánto debes" },
      { titulo: "Se alimenta solo de los demás módulos", detalle: "aquí no se registra nada, solo se mira" },
    ],
  },
  "crm-leads": {
    nombre: "CRM Leads",
    pasos: [
      { titulo: "Aquí llegan los interesados (leads) para convertirlos en clientes" },
      { titulo: "Responde desde el chat o mueve la tarjeta según avance la conversación" },
      { titulo: "Cuando quiera comprar, toca Crear Pedido", detalle: "sus datos ya van llenados" },
    ],
  },
};

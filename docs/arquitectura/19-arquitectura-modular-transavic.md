# 19 — Arquitectura Modular y Despliegue Seguro

> **Fecha original:** 2026-06-28 · **Revisión:** 2026-07-12
> **Propósito:** Mantener aislados los módulos ERP ya desplegados y los cambios nuevos sin romper el sistema de pedidos ni las tres operaciones de venta.

## 1. Principio de Aislamiento (Isolation)

El código actual de Transavic está fuertemente acoplado en `/api/pedidos` y `/dashboard/mi-ruta`. Para implementar las nuevas fases (Compras, Caja, CRM), aplicaremos un patrón de **aislamiento de módulos**:

- **Nuevas Rutas y Carpetas:** Todo el código nuevo vivirá en carpetas independientes.
  - Ej: `src/app/dashboard/compras/`
  - Ej: `src/app/dashboard/caja/`
  - Ej: `src/app/api/compras/`
- **Componentes Compartidos Reutilizables (`src/components/ui`):**
  En lugar de crear botones y tablas desde cero, unificaremos el diseño utilizando los componentes base. Las tablas de compras heredarán el mismo diseño Tailwind que la tabla de pedidos actual.

## 2. Desarrollo Local Seguro (Cero Riesgo)

Para garantizar que "nada se rompa", seguiremos este flujo:
1. **Rama en BD (Neon):** Usaremos `dev-hugo` en Neon, que es una base de datos aislada con el mismo esquema que producción. El archivo `.env.local` apunta ahí.
2. **Desarrollo en Localhost:** Se construyen y prueban todas las pantallas localmente.
3. **Migraciones Diferidas:** Cuando un bloque está listo, el script `.mjs` de la base de datos se ejecutará primero en producción, y *después* se subirá el código a Vercel. Al ser aditivas (nuevas tablas, no alteran las existentes), no rompen la app en vivo.

## 3. Modularidad Fase por Fase (Qué hacer primero y por qué)

### 🔴 Paso 1: Base de Datos y Permisos (Cimientos)
- **Por qué primero:** No puedes construir "Compras" sin tener dónde guardar el proveedor. Tampoco puedes mostrar la vista si el rol `produccion` no tiene permiso.
- **Acción:** Definir las tablas y refactorizar `roles.ts`. *(Completado localmente)*.

### 🟡 Paso 2: Operación y Mermas (Reemplazar Avitech)
- **Por qué segundo:** Es la urgencia principal para conectar a Ariana.
- **Implementación Modular:**
  - Se creará `src/components/Compras/CalculadoraMerma.tsx`. Este componente usará variables de estado React puras (sin llamadas al servidor hasta guardar) para calcular `Bruto - Tara = Neto` en milisegundos.
  - Se creará una tabla en `/dashboard/compras` completamente aislada del `/dashboard` principal.

### 🟢 Paso 3: POS en Planta y Caja Diaria
- **Por qué tercero:** Una vez que entra el pollo (Paso 2), hay que venderlo rápido y cobrarlo.
- **Implementación Modular:**
  - El POS usará diseño Mobile-First.
  - La "Caja" usará una tabla `caja_diaria` que consolide todos los cierres. No tocará la lógica de facturación electrónica de SUNAT, solo el control interno de dinero.

### 🔵 Paso 4: CRM e Inteligencia Artificial (Inspirado en conexipema-eventos)
- **Por qué cuarto:** El equipo ya domina la operación interna. Es hora de traer más ventas automáticas.
- **Implementación Modular:**
  - Se creará una carpeta `src/app/api/webhook/whatsapp` aislada.
  - Analizaremos la arquitectura de `conexipema-eventos` para importar la lógica de lectura de mensajes de Meta, adaptando el prompt de Gemini/Groq al contexto avícola.

### 🟣 Paso 5: Dashboard Gerencial
- **Por qué último:** Requiere que todas las demás áreas (Compras, Caja, Ventas) estén generando datos para poder consolidarlos y calcular la utilidad real.

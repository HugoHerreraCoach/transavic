# Transavic

Sistema interno de gestión para una distribuidora avícola de Lima. Centraliza pedidos,
producción, despacho, cobranzas, compras, inventario, caja y facturación electrónica de
las marcas **Transavic** y **Avícola de Tony**.

No es un e-commerce público. Los usuarios son el dueño, las ejecutivas comerciales,
Producción y los repartidores; los clientes finales no inician sesión.

## Operaciones de venta

El sistema mantiene separadas tres operaciones que comparten catálogo y motor SUNAT:

| Operación | Fuente principal | Cartera |
|---|---|---|
| Ejecutivas | `pedidos` con `origen='asesor'` o legado `NULL` | `facturas` |
| Campo | `ventas_avicola` | `abonos_avicola` y saldo calculado |
| Planta | `pedidos` con `origen='pos_planta'` | `cobranzas_planta` / `abonos_planta` |

Las vistas generales agregan las operaciones sin mezclar sus clientes, pagos ni
comprobantes. Consulta [Operaciones, ventas y facturación](./docs/arquitectura/22-operaciones-ventas-facturacion.md).

## Stack

- Next.js 15 (App Router) y TypeScript estricto.
- Tailwind CSS 4.
- NextAuth 5 beta con credenciales.
- Neon Postgres mediante SQL directo (`@neondatabase/serverless`), sin ORM.
- Vercel para producción.
- Google Maps, SUNAT, Brevo/SMTP y Gemini/Groq como integraciones externas.

## Desarrollo local

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`. Las variables viven en
`.env` y `.env.local`; nunca se deben subir credenciales al repositorio.

Verificaciones seguras:

```bash
npx tsc --noEmit
npm run lint
npm run test:observaciones
npm run test:estado-cuenta-avicola
npm run test:operaciones-facturacion
```

No uses `npm run build` para una verificación rutinaria mientras otra persona tenga
`npm run dev` abierto, porque ambos comparten el caché de Next/Webpack.

## Migraciones

Las migraciones son SQL aditivo e idempotente en `scripts/`. Se prueban primero en
la rama Neon `dev-hugo` y se aplican con `psql` antes de desplegar el código:

```bash
psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 -f scripts/migrate-<feature>.sql
```

Los scripts `.mjs` son históricos; no son el mecanismo recomendado para cambios
nuevos ni para producción. El procedimiento completo y los rollbacks están en
[Migraciones y despliegue seguro](./docs/arquitectura/20-migracion-produccion.md).

## Documentación

La referencia principal está en [docs/arquitectura/README.md](./docs/arquitectura/README.md).
Sus 27 documentos describen el negocio, tablas, APIs, permisos, flujos, dependencias,
impacto de cambios, pruebas y despliegue. Antes de modificar un módulo, usa el mapa
"Si vas a tocar X, lee Y" del índice.

Reglas operativas breves para agentes y colaboradores:

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [Historial de cambios 2026](./docs/historial-cambios-2026.md)

## Estado de despliegue

`main` se despliega continuamente en Vercel. Las mejoras desarrolladas en una rama
no deben describirse como productivas hasta aplicar sus migraciones, fusionar el
código y verificar el despliegue. La documentación distingue siempre entre código,
`dev-hugo` y producción.

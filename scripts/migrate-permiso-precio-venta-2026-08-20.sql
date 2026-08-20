-- Permiso puntual: cambiar el PRECIO DE VENTA del catalogo (20 ago 2026).
--
-- Bandera por usuario. Quien la tiene (una asesora) puede editar SOLO
-- productos.precio_venta desde /dashboard/catalogo. Nada mas: no ve el precio de
-- compra ni el margen, no crea ni desactiva productos, y no aprueba
-- autorizaciones de precio bajo. El admin siempre pudo y sigue pudiendo: su
-- permiso viene del rol, no de esta columna.
--
-- Se llama precio_venta y no "precios" a proposito: el costo (precio_compra)
-- nunca debe caer bajo este mismo permiso.
--
-- Aditiva e idempotente. Aplicar por psql en dev-hugo y luego en produccion ANTES
-- de desplegar el codigo:
--   psql "$DATABASE_URL_UNPOOLED" -1 -v ON_ERROR_STOP=1 \
--     -f scripts/migrate-permiso-precio-venta-2026-08-20.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS puede_editar_precio_venta BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.puede_editar_precio_venta IS
  'Si TRUE, esta asesora puede cambiar productos.precio_venta desde el catalogo. Nada mas: ni precio_compra, ni activo, ni alta de productos. Viaja en el JWT: aplica desde su proximo login.';

-- Verificacion:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='users' AND column_name='puede_editar_precio_venta';

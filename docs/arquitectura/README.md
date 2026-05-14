# Documentación de Arquitectura — Transavic

> **Última actualización:** 2026-05-13
> **Commit verificado:** `d2a49cd`

Esta carpeta contiene la **referencia técnica de verdad** del sistema Transavic, verificada contra el código real. Está pensada para que el desarrollador principal (Hugo) y agentes IA futuros entiendan el sistema en profundidad sin re-leer 8,000 líneas de implementación.

Para overview rápido y gotchas del día a día, ver **[`/CLAUDE.md`](../../CLAUDE.md)** en la raíz del repo.

---

## 📚 Los 5 documentos

| # | Documento | Cuándo leerlo | Líneas |
|---|---|---|---|
| 1 | **[01-vision-general.md](./01-vision-general.md)** | Primera vez que entrás al proyecto. Querés entender stack, deployment y decisiones macro. | ~470 |
| 2 | **[02-modelo-de-datos.md](./02-modelo-de-datos.md)** | Vas a tocar el schema, agregar tablas/columnas, o entender por qué algo está denormalizado. | ~640 |
| 3 | **[03-autenticacion-y-roles.md](./03-autenticacion-y-roles.md)** | Vas a crear un endpoint nuevo, agregar un rol, o entender cómo se aplica scoping. | ~520 |
| 4 | **[04-flujos-de-negocio.md](./04-flujos-de-negocio.md)** | Vas a modificar la máquina de estados del pedido, agregar transiciones, o entender qué hace cada pantalla. | ~720 |
| 5 | **[05-apis-e-integraciones.md](./05-apis-e-integraciones.md)** | Referencia rápida de endpoints, Google Maps, offline queue. También lista deudas de auditoría. | ~720 |

---

## 🎯 Guía "si vas a tocar X, lee Y"

| Tu tarea | Documentos a leer (en orden) |
|---|---|
| Entender el proyecto por primera vez | 01 → 04 → (los demás según necesidad) |
| Agregar una tabla o columna nueva | 02 → 05 (ver convenciones SQL y patrones de query) |
| Crear una API nueva | 05 (convenciones) → 03 (auth y scoping) → 04 (si afecta máquina de estados) |
| Agregar un rol nuevo | 03 (sección "Cómo agregar un rol nuevo") |
| Tocar el flujo del repartidor | 04 (sección "Repartidor") → 05 (offline queue) |
| Tocar el panel de despacho del admin | 04 (sección "Admin") → 05 (Google Directions) |
| Tocar el form de crear pedido | 04 (sección "Asesora crea pedido") |
| Modificar la máquina de estados | 04 (diagrama Mermaid completo en §3) |
| Integrar un servicio externo nuevo | 01 (variables de entorno) → 05 (patrón de integración con Google Maps como referencia) |
| Resolver una deuda de auditoría | 05 §8 (tabla de hallazgos) |
| Optimizar queries lentas | 02 (índices existentes) → 05 (cuáles endpoints hacen JOINs pesados) |
| Cambiar deployment o env vars | 01 (sección 5 y 6) |
| Debuggear un bug de auth | 03 (flujo completo de login) → 05 (qué endpoints hacen check) |
| Implementar las **8 mejoras 2026** | Los 5 documentos + propuesta comercial (`/propuesta-mejoras-transavic.pdf`) |

---

## 🗺️ Convenciones de los documentos

Todos los documentos siguen las mismas convenciones:

### Header estándar

```markdown
# <N> — <Título>

> **Última verificación contra código:** YYYY-MM-DD
> **Commit del proyecto:** <hash corto>
> **Archivos clave:** lista de archivos referenciados
```

### Referencias a archivos

Formato `path/al/archivo.ts:LINEA-FINAL` que permite click directo en editores modernos:

> Ver el `authorize()` en `src/auth.ts:23-41`.

### Diagramas

- **Mermaid** para flujos complejos (capas, ER, máquina de estados, secuencia).
- **ASCII art** para flujos lineales simples.
- **Tablas markdown** para comparativas, decisiones, hallazgos.

### Code blocks

- TypeScript, SQL y JSON **reales del proyecto** (no inventados).
- Cuando se simplifica, se indica con `// ... (lógica de validación) ...`.

### Sección final estándar

Cada documento (excepto este README) termina con **"Cómo verificar que este documento sigue vigente"** — comandos `grep` y `psql` específicos para detectar si hay drift entre la doc y el código.

---

## ⚙️ Cómo mantener esta documentación

### Cuando hagas un cambio importante

1. **Identifica qué documentos cubren el área que tocaste.**
   - ¿Modificaste schema? → actualizar 02.
   - ¿Agregaste endpoint? → actualizar 05.
   - ¿Cambiaste la máquina de estados? → actualizar 04 (incluido el diagrama Mermaid).
   - ¿Agregaste un rol? → actualizar 03 y CLAUDE.md.

2. **Actualizá la fecha del header** (`Última verificación contra código:`) y el `Commit del proyecto`.

3. **Ejecutá los comandos de "Cómo verificar que sigue vigente"** del documento que tocaste. Si alguno revela inconsistencias, corregilas.

4. **Commiteá** con mensaje descriptivo:
   ```
   docs(arquitectura): actualizar 02-modelo-de-datos con nueva tabla X
   ```

### Cuando agregues un documento nuevo

1. Numerarlo `06-...`, `07-...`, etc.
2. Agregar entrada en la tabla de §1 de este README.
3. Agregar entrada en la guía "si vas a tocar X, lee Y".
4. Actualizar `CLAUDE.md` mencionando el nuevo documento.

### Cuando elimines algo del código

- Si eliminás una tabla, columna, endpoint o feature, **eliminá las menciones en los documentos**.
- Si la eliminación tiene rationale histórico (ej: "antes había X pero se removió porque..."), considerar mantenerlo como nota corta para contexto futuro.

---

## 🚨 Hallazgos de auditoría conocidos

Durante la creación de esta documentación se detectaron **12 deudas técnicas** que conviene tratar. Ver la tabla completa en [`05-apis-e-integraciones.md §8`](./05-apis-e-integraciones.md#8-hallazgos-de-auditoría-deudas-a-tratar).

**Las más urgentes:**

| # | Hallazgo | Severidad |
|---|---|---|
| ~~1~~ | ~~`PATCH/DELETE /api/pedidos/[id]` sin auth check~~ — **✅ Resuelto 2026-05-13** | ✅ Resuelto |
| 2 | Migración de tabla `clientes` no documentada en `/scripts/` (DB irrecuperable desde cero) | 🟡 Media |
| 3 | `GET /api/clientes/[id]/pedidos` permite ver historial de clientes ajenos | 🟡 Media |

---

## 🧭 Mapa de relaciones entre documentos

```mermaid
flowchart LR
    subgraph "Para empezar"
        CM["CLAUDE.md<br/>(raíz)"]
        README["README.md<br/>(este archivo)"]
    end

    subgraph "Documentos temáticos"
        D01["01-vision-general"]
        D02["02-modelo-de-datos"]
        D03["03-autenticacion-y-roles"]
        D04["04-flujos-de-negocio"]
        D05["05-apis-e-integraciones"]
    end

    CM -->|profundizar arquitectura| README
    README --> D01
    README --> D02
    README --> D03
    README --> D04
    README --> D05

    D01 -.->|"contexto general<br/>necesario antes de"| D02
    D01 -.-> D04
    D02 -.->|"schema usado por"| D05
    D03 -.->|"scoping aplicado en"| D05
    D04 -.->|"endpoints detallados en"| D05

    classDef root fill:#fff4e1,stroke:#f59e0b
    classDef temat fill:#dbeafe,stroke:#3b82f6
    class CM,README root
    class D01,D02,D03,D04,D05 temat
```

---

## 📞 Contacto

- **Mantenedor principal:** Hugo Herrera (`eventonegocioslegendarios@gmail.com`)
- **Cliente del proyecto:** Antonio Resurrección (Transavic / Avícola de Tony)
- **Repo:** local en `/Users/hugoherrera/Programación/proyectos/transavic`

---

**Idioma:** Español (consistente con el código y comentarios del proyecto).
**Audiencia:** Desarrollador + agentes IA. Sin "value pitch" — referencia técnica densa y verificable.

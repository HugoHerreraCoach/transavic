// Política de privacidad pública (sin auth) — requerida por Google Play porque
// la app del motorizado usa la ubicación. URL: https://transavic.vercel.app/privacidad
export const metadata = {
  title: "Política de Privacidad — Transavic Reparto",
  description:
    "Cómo Transavic usa la ubicación del motorizado en la app interna de reparto.",
};

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <article className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 text-gray-800">
        <h1 className="text-2xl font-bold text-gray-900">
          Política de Privacidad — Transavic Reparto
        </h1>
        <p className="mt-1 text-sm text-gray-500">Última actualización: 4 de junio de 2026</p>

        <section className="mt-6 space-y-3 text-sm leading-relaxed">
          <p>
            <strong>Transavic Reparto</strong> es una aplicación de uso interno para los
            motorizados (repartidores) de Transavic. Sirve para coordinar las entregas del día
            y mostrar al área de despacho dónde se encuentra cada motorizado en tiempo real. No
            es una aplicación para el público general.
          </p>
        </section>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Qué datos recopilamos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Ubicación (GPS) del dispositivo</strong> del motorizado, únicamente mientras
            el seguimiento está activo durante su jornada de trabajo.
          </li>
          <li>
            La cuenta de usuario con la que el motorizado inicia sesión (asignada por Transavic).
          </li>
        </ul>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Para qué la usamos</h2>
        <p className="mt-2 text-sm leading-relaxed">
          La ubicación se usa solo para mostrar la posición del motorizado en el mapa de despacho
          de Transavic, y así coordinar y optimizar las entregas. No la usamos con fines
          publicitarios.
        </p>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Cuándo se comparte la ubicación</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Solo cuando el motorizado <strong>activa el seguimiento</strong> en la app. El
          motorizado puede pausarlo o desactivarlo cuando quiera. Mientras está activo, la app
          muestra una notificación fija que lo indica.
        </p>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Quién accede a estos datos</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Únicamente el personal administrativo de Transavic, dentro de su sistema interno. La
          ubicación <strong>no se comparte ni se vende a terceros</strong>.
        </p>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Cuánto tiempo se conserva</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Se guarda solo la <strong>última posición conocida</strong> de cada motorizado, que se
          va actualizando. No conservamos un historial del recorrido.
        </p>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Seguridad</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Los datos viajan por conexión cifrada (HTTPS) y el acceso al sistema está restringido
          por cuenta y contraseña.
        </p>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Permisos que pide la app</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Ubicación:</strong> para reportar la posición del motorizado al sistema de
            despacho.
          </li>
          <li>
            <strong>Notificaciones:</strong> para mostrar el aviso de que el seguimiento está
            activo mientras la app trabaja en segundo plano.
          </li>
        </ul>

        <h2 className="mt-7 text-lg font-semibold text-gray-900">Contacto</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Para cualquier consulta sobre esta política o sobre tus datos, escribe a{" "}
          <a href="mailto:transavicdev@gmail.com" className="text-red-600 underline">
            transavicdev@gmail.com
          </a>
          .
        </p>
      </article>
    </main>
  );
}

import { IconoEstrella } from "@/components/valoracion/ValoracionPedido";
import {
  CLASE_AYUDA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "@/components/admin/reportes/reportes.estilos";
import {
  conClaves,
  formatearDia,
  textoComentariosMostrados,
  type ValoracionesDelPeriodo,
} from "./valoraciones.utils";

/**
 * HU-050 (BL-558): los comentarios del período, con el día y las estrellas.
 * Sin hora, pedido ni mesa (E1). El comentario se muestra como texto (React
 * lo escapa), nunca como HTML.
 */
export default function ComentariosValoraciones({
  datos,
}: Readonly<{ datos: ValoracionesDelPeriodo }>) {
  const { comentarios, totalComentarios } = datos;
  const aviso = textoComentariosMostrados(comentarios.length, totalComentarios);

  return (
    <section aria-labelledby="titulo-comentarios" className={CLASE_TARJETA}>
      <h2 id="titulo-comentarios" className={CLASE_TITULO_TARJETA}>
        Comentarios
      </h2>
      {comentarios.length === 0 ? (
        <p className={`mt-3 ${CLASE_AYUDA}`}>
          No hay comentarios en este período.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-outline-variant">
          {conClaves(comentarios).map((c) => (
            <li key={c.clave} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex gap-0.5">
                  <span className="sr-only">{c.estrellas} de 5</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <IconoEstrella
                      key={n}
                      llena={n <= c.estrellas}
                      tamano={16}
                    />
                  ))}
                </span>
                <span className={CLASE_AYUDA}>{formatearDia(c.dia)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
                {c.comentario}
              </p>
            </li>
          ))}
        </ul>
      )}
      {aviso && <p className={`mt-3 ${CLASE_AYUDA}`}>{aviso}</p>}
    </section>
  );
}

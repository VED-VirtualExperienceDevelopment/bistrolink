import type { ElementoPlano, ZonaPlano } from "@/types/plano";
import { ETIQUETA_POR_ESTADO, type MesaEnEdicion } from "./mapa-mesas.utils";
import { ICONO_POR_ELEMENTO } from "./plano-iconos";
import { zonaDePunto } from "./plano.utils";

interface Props {
  mesas: MesaEnEdicion[];
  zonas: ZonaPlano[];
  elementos: ElementoPlano[];
}

const ESTILO_TITULO = "mb-2 text-body-md font-semibold text-on-surface";
const ESTILO_VACIO = "text-body-sm text-on-surface-variant";

/**
 * HU-028 (BL-173): el plano en texto. El lienzo de Konva es una imagen para
 * un lector de pantalla; esta lista es su alternativa (WCAG 2.1 AA, 1.1.1 y
 * 1.3.1): cada mesa con su estado y su zona, cada zona con cuántas mesas
 * tiene y cada elemento fijo. Va cerrada por defecto (<details>, nativo y
 * accesible sin JavaScript extra) y la ven ADMIN y MOZO.
 */
export function ListaPlano({ mesas, zonas, elementos }: Readonly<Props>) {
  const mesasOrdenadas = [...mesas].sort((a, b) => a.numero - b.numero);
  const zonaDeCadaMesa = new Map(
    mesas.map((m) => [m.clientId, zonaDePunto(m, zonas)]),
  );

  return (
    <details className="rounded-xl border border-outline-variant bg-surface-container-lowest">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-label-md text-on-surface-variant touch:min-h-12">
        Ver el plano como lista
      </summary>
      <div className="grid gap-6 px-4 pb-4 md:grid-cols-3">
        <section aria-labelledby="lista-plano-mesas">
          <h3 id="lista-plano-mesas" className={ESTILO_TITULO}>
            Mesas ({mesas.length})
          </h3>
          {mesas.length === 0 ? (
            <p className={ESTILO_VACIO}>No hay mesas en el mapa.</p>
          ) : (
            <table className="w-full text-left text-body-sm text-on-surface">
              <thead className="text-label-md text-on-surface-variant">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Mesa
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Zona
                  </th>
                </tr>
              </thead>
              <tbody>
                {mesasOrdenadas.map((mesa) => (
                  <tr
                    key={mesa.clientId}
                    className="border-t border-outline-variant"
                  >
                    <th scope="row" className="py-1 pr-2 font-medium">
                      {mesa.numero}
                    </th>
                    <td className="py-1 pr-2">
                      {ETIQUETA_POR_ESTADO[mesa.estado]}
                    </td>
                    <td className="py-1">
                      {zonaDeCadaMesa.get(mesa.clientId) ?? "Sin zona"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="lista-plano-zonas">
          <h3 id="lista-plano-zonas" className={ESTILO_TITULO}>
            Zonas ({zonas.length})
          </h3>
          {zonas.length === 0 ? (
            <p className={ESTILO_VACIO}>No hay zonas en el plano.</p>
          ) : (
            <ul className="space-y-1 text-body-sm text-on-surface">
              {zonas.map((zona) => {
                const cantidad = mesas.filter(
                  (m) => zonaDeCadaMesa.get(m.clientId) === zona.etiqueta,
                ).length;
                return (
                  <li key={zona.id}>
                    {zona.etiqueta}: {cantidad}{" "}
                    {cantidad === 1 ? "mesa" : "mesas"}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="lista-plano-elementos">
          <h3 id="lista-plano-elementos" className={ESTILO_TITULO}>
            Elementos fijos ({elementos.length})
          </h3>
          {elementos.length === 0 ? (
            <p className={ESTILO_VACIO}>No hay elementos fijos en el plano.</p>
          ) : (
            <ul className="space-y-1 text-body-sm text-on-surface">
              {elementos.map((elemento) => {
                const zona = zonaDePunto(elemento, zonas);
                return (
                  <li key={elemento.id}>
                    {ICONO_POR_ELEMENTO[elemento.tipo].etiqueta}
                    {zona ? ` (en ${zona})` : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

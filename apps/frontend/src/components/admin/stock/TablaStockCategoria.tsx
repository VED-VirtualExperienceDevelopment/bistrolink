"use client";

import Switch from "@/components/ui/Switch";
import {
  CLASE_CONTROL,
  CLASE_ERROR_CAMPO,
} from "@/components/admin/configuracion/configuracion.estilos";
import { CLASE_ESTADO_STOCK, ETIQUETA_TIPO } from "./stock.utils";
import {
  idCampoStock,
  idCampoUmbral,
  type ErroresFila,
  type FilaStock,
  type GrupoCategoria,
  type ItemStock,
} from "./stock-jornada.utils";

// BL-474: celdas compactas en el celular (px-2) para que la tabla entre en
// 375 px sin scroll horizontal; desde md, el espaciado de siempre.
const CLASE_CELDA = "px-2 py-2 align-top md:px-3";
const CLASE_ENCABEZADO =
  "px-2 py-2 text-left align-bottom text-label-md font-medium text-on-surface-variant md:px-3";

function Estado({ item }: Readonly<{ item: ItemStock }>) {
  if (item.alerta) {
    return (
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-label-sm ${CLASE_ESTADO_STOCK[item.alerta]}`}
      >
        {ETIQUETA_TIPO[item.alerta]}
      </span>
    );
  }
  return (
    <span className="text-body-sm text-on-surface-variant">
      {item.controlaStock ? "Con stock" : "Sin control"}
    </span>
  );
}

/** Encabezado con un texto corto en el celular y el completo desde md. */
function TextoEncabezado({
  corto,
  largo,
}: Readonly<{ corto: string; largo: string }>) {
  return (
    <>
      <span className="md:hidden">{corto}</span>
      <span className="hidden md:inline">{largo}</span>
    </>
  );
}

function CampoUnidades({
  id,
  etiqueta,
  valor,
  error,
  deshabilitado,
  onCambiar,
}: Readonly<{
  id: string;
  etiqueta: string;
  valor: string;
  error?: string;
  deshabilitado: boolean;
  onCambiar: (valor: string) => void;
}>) {
  // El ancho lo da el contenedor (64 px en el celular, 96 px desde md): con
  // un ancho en % dentro de una tabla, la columna podría colapsar.
  return (
    <div className="w-16 md:w-24">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={etiqueta}
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => onCambiar(e.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${CLASE_CONTROL} disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant`}
      />
      {error && (
        <p id={`${id}-error`} className={CLASE_ERROR_CAMPO}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * HU-015 (BL-120): los ítems de una categoría en «Stock de la jornada».
 * Una tabla por categoría, con el nombre del ítem como encabezado de fila;
 * cada campo lleva el nombre del ítem en su etiqueta, porque el lector de
 * pantalla lo anuncia fuera de la tabla al tabular.
 *
 * BL-474: sigue siendo una tabla en todos los tamaños (no se cambia el
 * `display` de las filas, que en algunos navegadores borra la semántica de
 * tabla). En el celular:
 * - Sin ancho mínimo fijo: títulos cortos («Control», «Aviso»), campos de
 *   64 px y el estado debajo del nombre (la columna «Estado» se oculta).
 * - El `overflow-x-auto` queda solo como red para nombres muy largos en
 *   pantallas de 320 px (WCAG 1.4.10 exceptúa las tablas de datos).
 */
export default function TablaStockCategoria({
  grupo,
  formulario,
  errores,
  onCambiar,
}: Readonly<{
  grupo: GrupoCategoria;
  formulario: Readonly<Record<string, FilaStock>>;
  errores: Readonly<Record<string, ErroresFila>>;
  onCambiar: (itemId: string, cambios: Partial<FilaStock>) => void;
}>) {
  const idTitulo = `categoria-${grupo.categoria.id}`;
  return (
    <section
      aria-labelledby={idTitulo}
      className="min-w-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest"
    >
      <h2
        id={idTitulo}
        className="border-b border-outline-variant px-4 py-3 text-headline-sm text-on-surface md:px-6"
      >
        {grupo.categoria.nombre}
      </h2>
      <div className="overflow-x-auto">
        <table aria-labelledby={idTitulo} className="w-full">
          <thead>
            <tr>
              <th scope="col" className={`${CLASE_ENCABEZADO} pl-4 md:pl-6`}>
                Ítem
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                <TextoEncabezado corto="Control" largo="Controlar stock" />
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                Unidades
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                <TextoEncabezado corto="Aviso" largo="Avisar cuando queden" />
              </th>
              <th
                scope="col"
                className={`${CLASE_ENCABEZADO} hidden md:table-cell md:pr-6`}
              >
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {grupo.items.map((item) => {
              const fila = formulario[item.id];
              if (!fila) return null;
              const error = errores[item.id] ?? {};
              return (
                <tr
                  key={item.id}
                  className="hover:bg-surface-container-low focus-within:bg-surface-container-low"
                >
                  <th
                    scope="row"
                    className={`${CLASE_CELDA} pl-4 text-left text-body-md font-normal text-on-surface md:pl-6`}
                  >
                    <span className="flex min-h-12 flex-col items-start justify-center gap-1">
                      <span className="[overflow-wrap:anywhere]">
                        {item.nombre}
                      </span>
                      <span className="md:hidden">
                        <Estado item={item} />
                      </span>
                    </span>
                  </th>
                  <td className={CLASE_CELDA}>
                    <span className="flex min-h-12 items-center">
                      <Switch
                        checked={fila.controlaStock}
                        onChange={(valor) =>
                          onCambiar(item.id, { controlaStock: valor })
                        }
                        label={`Controlar stock de ${item.nombre}`}
                      />
                    </span>
                  </td>
                  <td className={CLASE_CELDA}>
                    <CampoUnidades
                      id={idCampoStock(item.id)}
                      etiqueta={`Unidades de ${item.nombre}`}
                      valor={fila.stock}
                      error={error.stock}
                      deshabilitado={!fila.controlaStock}
                      onCambiar={(valor) =>
                        onCambiar(item.id, { stock: valor })
                      }
                    />
                  </td>
                  <td className={CLASE_CELDA}>
                    <CampoUnidades
                      id={idCampoUmbral(item.id)}
                      etiqueta={`Avisar cuando queden: ${item.nombre}`}
                      valor={fila.umbral}
                      error={error.umbral}
                      deshabilitado={!fila.controlaStock}
                      onCambiar={(valor) =>
                        onCambiar(item.id, { umbral: valor })
                      }
                    />
                  </td>
                  <td className={`${CLASE_CELDA} hidden md:table-cell md:pr-6`}>
                    <span className="flex min-h-12 items-center">
                      <Estado item={item} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

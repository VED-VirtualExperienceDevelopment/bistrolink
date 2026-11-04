"use client";

import Switch from "@/components/ui/Switch";
import { ETIQUETA_TIPO } from "./stock.utils";
import {
  idCampoStock,
  idCampoUmbral,
  type ErroresFila,
  type FilaStock,
  type GrupoCategoria,
  type ItemStock,
} from "./stock-jornada.utils";

const CLASE_CAMPO =
  "min-h-12 w-24 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-container disabled:text-on-surface-variant aria-[invalid=true]:border-error";
const CLASE_CELDA = "px-3 py-2 align-top";
const CLASE_ENCABEZADO =
  "px-3 py-2 text-left text-label-md font-medium text-on-surface-variant";
const CLASE_ESTADO = {
  STOCK_CRITICO: "bg-amber-100 text-amber-900",
  AGOTADO: "bg-error-container text-on-error-container",
} as const;

function Estado({ item }: Readonly<{ item: ItemStock }>) {
  if (item.alerta) {
    return (
      <span
        className={`inline-block rounded-full px-2 py-0.5 text-label-sm ${CLASE_ESTADO[item.alerta]}`}
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
  return (
    <>
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
        className={CLASE_CAMPO}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 max-w-40 text-body-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * HU-015 (BL-120): los ítems de una categoría en «Stock de la jornada».
 * Una tabla por categoría, con el nombre del ítem como encabezado de fila;
 * cada campo lleva el nombre del ítem en su etiqueta, porque el lector de
 * pantalla lo anuncia fuera de la tabla al tabular.
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
      className="rounded-xl border border-outline-variant bg-surface-container-lowest"
    >
      <h2
        id={idTitulo}
        className="border-b border-outline-variant px-4 py-3 text-headline-sm text-on-surface"
      >
        {grupo.categoria.nombre}
      </h2>
      <div className="overflow-x-auto">
        <table aria-labelledby={idTitulo} className="w-full min-w-[36rem]">
          <thead>
            <tr>
              <th scope="col" className={CLASE_ENCABEZADO}>
                Ítem
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                Controlar stock
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                Unidades
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
                Avisar cuando queden
              </th>
              <th scope="col" className={CLASE_ENCABEZADO}>
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
                <tr key={item.id}>
                  <th
                    scope="row"
                    className={`${CLASE_CELDA} text-left text-body-md font-normal text-on-surface`}
                  >
                    <span className="flex min-h-12 items-center">
                      {item.nombre}
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
                  <td className={CLASE_CELDA}>
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

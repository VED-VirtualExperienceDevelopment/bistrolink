"use client";

import { claseChip } from "./reportes.estilos";

/** Dos o más opciones de cómo ver un gráfico (Monto / Pedidos, …). */
export default function SelectorMetrica<T extends string>({
  nombre,
  leyenda,
  opciones,
  valor,
  onCambiar,
}: Readonly<{
  nombre: string;
  leyenda: string;
  opciones: readonly { valor: T; etiqueta: string }[];
  valor: T;
  onCambiar: (valor: T) => void;
}>) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">{leyenda}</legend>
      {opciones.map((opcion) => (
        <label key={opcion.valor} className={claseChip(valor === opcion.valor)}>
          <input
            type="radio"
            name={nombre}
            value={opcion.valor}
            checked={valor === opcion.valor}
            onChange={() => onCambiar(opcion.valor)}
            className="sr-only"
          />
          {opcion.etiqueta}
        </label>
      ))}
    </fieldset>
  );
}

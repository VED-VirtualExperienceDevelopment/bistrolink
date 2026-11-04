/**
 * HU-012 (BL-108): la tabla equivalente a un gráfico. Siempre está en la
 * página: escondida (sr-only) para los lectores de pantalla, o visible con
 * «Ver como tabla».
 */
export default function TablaAccesible({
  titulo,
  columnas,
  filas,
  visible,
}: Readonly<{
  titulo: string;
  columnas: readonly string[];
  filas: readonly (readonly string[])[];
  visible: boolean;
}>) {
  return (
    <table
      className={visible ? "mt-4 w-full border-collapse text-left" : "sr-only"}
    >
      <caption className={visible ? "sr-only" : undefined}>{titulo}</caption>
      <thead>
        <tr>
          {columnas.map((columna, i) => (
            <th
              key={columna}
              scope="col"
              className={`border-b border-outline-variant px-3 py-2 text-label-md text-on-surface-variant ${i > 0 ? "text-right" : ""}`}
            >
              {columna}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr key={fila.join("|")}>
            {fila.map((celda, i) =>
              i === 0 ? (
                <th
                  key={columnas[i]}
                  scope="row"
                  className="border-b border-outline-variant px-3 py-2 text-body-md font-normal text-on-surface"
                >
                  {celda}
                </th>
              ) : (
                <td
                  key={columnas[i]}
                  className="border-b border-outline-variant px-3 py-2 text-right text-body-md text-on-surface"
                >
                  {celda}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

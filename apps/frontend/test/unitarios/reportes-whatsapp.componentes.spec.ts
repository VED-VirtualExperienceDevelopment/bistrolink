/**
 * @jest-environment jsdom
 */
// HU-010 (BL-612): WhatsApp en Reportes como un canal más. Componentes
// reales con React Testing Library.
import { createElement, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import FiltrosReportes from "@/components/admin/reportes/FiltrosReportes";
import DentroFueraDelLocal from "@/components/admin/reportes/DentroFueraDelLocal";
import { formatearMonto } from "@/components/admin/reportes/reportes.utils";

describe("Reportes: canal WhatsApp (BL-612)", () => {
  it("[TC-U-701] el filtro WhatsApp se puede elegir, sin «Próximamente», y avisa qué pedidos son", () => {
    const onCambiar = jest.fn();
    render(
      createElement(FiltrosReportes, {
        filtros: { periodo: "HOY", canal: "TODOS", desde: "", hasta: "" },
        invalido: false,
        onCambiar,
      }),
    );

    const radio = screen.getByRole("radio", { name: "WhatsApp" });
    expect((radio as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText("Próximamente")).toBeNull();
    const ayuda = document.getElementById(
      radio.getAttribute("aria-describedby")!,
    );
    expect(ayuda?.textContent).toBe(
      "Pedidos hechos por el bot de WhatsApp, para retirar",
    );

    fireEvent.click(radio);
    expect(onCambiar).toHaveBeenCalledWith(
      expect.objectContaining({ canal: "WHATSAPP" }),
    );
  });

  it("[TC-U-702] «Dentro y fuera del local» muestra lo vendido por WhatsApp, también en 0", () => {
    const reporte = (whatsapp: number) =>
      ({
        porLugar: { local: 750, web: 250, whatsapp, pos: 0 },
        rotacionMesas: { aplica: false },
      }) as unknown as ComponentProps<typeof DentroFueraDelLocal>["reporte"];

    const { rerender } = render(
      createElement(DentroFueraDelLocal, { reporte: reporte(0) }),
    );
    const fila = () =>
      screen
        .getAllByRole("listitem", { hidden: true })
        .find((li) => li.textContent?.startsWith("WhatsApp"))!;
    expect(fila().textContent).toContain(`${formatearMonto(0)} · 0 %`);
    expect(screen.queryByText("Próximamente")).toBeNull();

    rerender(createElement(DentroFueraDelLocal, { reporte: reporte(250) }));
    expect(fila().textContent).toContain(`${formatearMonto(250)} · 20 %`);
  });
});

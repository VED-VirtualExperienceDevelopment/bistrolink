/**
 * @jest-environment jsdom
 */
// BL-304: la 404 del menú público (HU-002), en español.
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import MenuPublicoNoEncontrado from "@/app/m/[tenantId]/restaurante/[restauranteId]/not-found";

describe("404 del menú público (BL-304)", () => {
  it("[TC-U-704] avisa en español que el local no existe y qué hacer", () => {
    render(createElement(MenuPublicoNoEncontrado));

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("No encontramos este local.")).toBeTruthy();
    const detalle = screen.getByText(
      "Revisá el enlace o pedile al local que te lo pase de nuevo.",
    );
    // El gris del detalle cumple 4,5:1 (culinary-neutral daba 4,46:1).
    expect(detalle.className).toContain("text-[#5a575e]");
    expect(screen.queryByText(/could not be found/i)).toBeNull();
  });
});

import {
  accionDeAtajo,
  accionDeTecla,
  PASO_MOVER_FINO,
  PASO_MOVER_GRUESO,
} from "@/components/admin/mesas/plano.utils";

// Atajos de teclado del editor del plano en PC: zoom, mover lo seleccionado
// y guardar. Supr y Esc siguen en accionDeTecla.

type Modificadores = Partial<{
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}>;

const tecla = (key: string, modificadores: Modificadores = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modificadores,
});

describe("accionDeAtajo", () => {
  it("+ y - cambian el zoom; 0 vuelve al 100 %", () => {
    expect(accionDeAtajo(tecla("+"), false, false)).toEqual({
      tipo: "acercar",
    });
    expect(accionDeAtajo(tecla("="), false, false)).toEqual({
      tipo: "acercar",
    });
    expect(accionDeAtajo(tecla("-"), false, false)).toEqual({ tipo: "alejar" });
    expect(accionDeAtajo(tecla("0"), false, false)).toEqual({
      tipo: "zoom-inicial",
    });
  });

  it("las flechas mueven de a 1 y con Shift de a 10", () => {
    expect(accionDeAtajo(tecla("ArrowRight"), false, true)).toEqual({
      tipo: "mover",
      dx: PASO_MOVER_FINO,
      dy: 0,
    });
    expect(accionDeAtajo(tecla("ArrowLeft"), false, true)).toEqual({
      tipo: "mover",
      dx: -PASO_MOVER_FINO,
      dy: 0,
    });
    expect(
      accionDeAtajo(tecla("ArrowUp", { shiftKey: true }), false, true),
    ).toEqual({ tipo: "mover", dx: 0, dy: -PASO_MOVER_GRUESO });
    expect(
      accionDeAtajo(tecla("ArrowDown", { shiftKey: true }), false, true),
    ).toEqual({ tipo: "mover", dx: 0, dy: PASO_MOVER_GRUESO });
  });

  it("sin nada seleccionado, las flechas no hacen nada (queda el scroll)", () => {
    expect(accionDeAtajo(tecla("ArrowRight"), false, false)).toBeNull();
  });

  it("Ctrl+S y Cmd+S guardan, incluso desde un campo de texto", () => {
    expect(accionDeAtajo(tecla("s", { ctrlKey: true }), true, false)).toEqual({
      tipo: "guardar",
    });
    expect(accionDeAtajo(tecla("S", { metaKey: true }), false, false)).toEqual({
      tipo: "guardar",
    });
  });

  it("Ctrl+Alt+S no guarda (puede ser otro atajo del sistema)", () => {
    expect(
      accionDeAtajo(tecla("s", { ctrlKey: true, altKey: true }), false, false),
    ).toBeNull();
  });

  it("no actúa mientras se escribe en un campo", () => {
    expect(accionDeAtajo(tecla("0"), true, true)).toBeNull();
    expect(accionDeAtajo(tecla("-"), true, true)).toBeNull();
    expect(accionDeAtajo(tecla("ArrowLeft"), true, true)).toBeNull();
  });

  it("deja Ctrl con + o − para el zoom del navegador", () => {
    expect(
      accionDeAtajo(tecla("+", { ctrlKey: true }), false, false),
    ).toBeNull();
    expect(
      accionDeAtajo(tecla("-", { metaKey: true }), false, false),
    ).toBeNull();
    expect(
      accionDeAtajo(tecla("0", { ctrlKey: true }), false, false),
    ).toBeNull();
  });

  it("no pisa Supr ni Esc, que siguen en accionDeTecla", () => {
    expect(accionDeAtajo(tecla("Delete"), false, true)).toBeNull();
    expect(accionDeAtajo(tecla("Escape"), false, true)).toBeNull();
    expect(accionDeTecla("Delete", false)).toBe("eliminar");
  });

  it("ignora el resto de las teclas", () => {
    expect(accionDeAtajo(tecla("a"), false, true)).toBeNull();
  });
});

import {
  DURACION_DESHACER_MS,
  reinsertar,
  restaurarMesa,
  restaurarPorId,
  textoEliminacion,
} from "@/components/admin/mesas/deshacer.utils";
import type { MesaEnEdicion } from "@/components/admin/mesas/mapa-mesas.utils";
import { accionDeAtajo } from "@/components/admin/mesas/plano.utils";
import type { ElementoPlano, ZonaPlano } from "@/types/plano";

/** BL-332: deshacer la última eliminación en el editor del plano. */

function mesa(clientId: string, numero: number, id?: string): MesaEnEdicion {
  return {
    clientId,
    id,
    numero,
    estado: "LIBRE",
    x: 100,
    y: 100,
    forma: "CUADRADO",
    ancho: 80,
    alto: 80,
    rotacion: 0,
  };
}

const zona: ZonaPlano = {
  id: "z1",
  etiqueta: "Terraza",
  x: 200,
  y: 150,
  ancho: 300,
  alto: 200,
};

const elemento: ElementoPlano = {
  id: "e1",
  tipo: "CAJA",
  x: 50,
  y: 50,
  ancho: 60,
  alto: 40,
  rotacion: 0,
} as ElementoPlano;

const tecla = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe("textoEliminacion", () => {
  it("dice qué se eliminó", () => {
    expect(
      textoEliminacion({ tipo: "mesa", mesa: mesa("a", 4), indice: 0 }),
    ).toBe("Mesa 4 eliminada");
    expect(textoEliminacion({ tipo: "zona", zona, indice: 0 })).toBe(
      "Zona «Terraza» eliminada",
    );
    expect(
      textoEliminacion({
        tipo: "elemento",
        elemento,
        indice: 0,
        etiqueta: "Caja",
      }),
    ).toBe("Elemento «Caja» eliminado");
  });
});

describe("reinsertar", () => {
  it("vuelve a poner el ítem en su posición", () => {
    expect(reinsertar(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("si la lista se achicó, lo pone al final; con índice negativo, al principio", () => {
    expect(reinsertar(["a"], "b", 5)).toEqual(["a", "b"]);
    expect(reinsertar(["a"], "b", -1)).toEqual(["b", "a"]);
  });
});

describe("restaurarMesa", () => {
  it("devuelve la mesa a su lugar y la saca de las eliminadas pendientes", () => {
    const borrada = mesa("b", 2, "id-b");
    const resultado = restaurarMesa(
      [mesa("a", 1, "id-a"), mesa("c", 3, "id-c")],
      [borrada],
      borrada,
      1,
    );
    expect(resultado.mesas.map((m) => m.numero)).toEqual([1, 2, 3]);
    expect(resultado.eliminadas).toEqual([]);
  });

  it("una mesa nueva (sin id) vuelve aunque no estuviera en las eliminadas", () => {
    const nueva = mesa("tmp-1", 9);
    const resultado = restaurarMesa([], [], nueva, 0);
    expect(resultado.mesas).toEqual([nueva]);
  });

  it("mantiene los cambios hechos después de eliminar", () => {
    const movida = { ...mesa("a", 1, "id-a"), x: 500 };
    const borrada = mesa("b", 2, "id-b");
    const resultado = restaurarMesa([movida], [borrada], borrada, 1);
    expect(resultado.mesas[0]).toBe(movida);
  });

  it("si la mesa ya está en el mapa, no la duplica", () => {
    const a = mesa("a", 1, "id-a");
    const mesas = [a];
    expect(restaurarMesa(mesas, [], a, 0).mesas).toBe(mesas);
  });
});

describe("restaurarPorId", () => {
  it("devuelve la zona o el elemento a su lugar", () => {
    const otra = { ...zona, id: "z2", etiqueta: "Salón" };
    expect(restaurarPorId([otra], zona, 0).map((z) => z.id)).toEqual([
      "z1",
      "z2",
    ]);
    expect(restaurarPorId([], elemento, 0)).toEqual([elemento]);
  });

  it("si ya está, no lo duplica", () => {
    const zonas = [zona];
    expect(restaurarPorId(zonas, zona, 0)).toBe(zonas);
  });
});

describe("DURACION_DESHACER_MS", () => {
  it("deja unos segundos para deshacer", () => {
    expect(DURACION_DESHACER_MS).toBeGreaterThanOrEqual(5000);
  });
});

describe("accionDeAtajo: Ctrl/Cmd + Z", () => {
  it("deshace con Ctrl + Z y con Cmd + Z", () => {
    expect(accionDeAtajo(tecla("z", { ctrlKey: true }), false, false)).toEqual({
      tipo: "deshacer",
    });
    expect(accionDeAtajo(tecla("Z", { metaKey: true }), false, false)).toEqual({
      tipo: "deshacer",
    });
  });

  it("en un campo de texto no: ahí deshace lo que se escribió", () => {
    expect(
      accionDeAtajo(tecla("z", { ctrlKey: true }), true, false),
    ).toBeNull();
  });

  it("Ctrl + Shift + Z y Z sola no deshacen", () => {
    expect(
      accionDeAtajo(
        tecla("z", { ctrlKey: true, shiftKey: true }),
        false,
        false,
      ),
    ).toBeNull();
    expect(accionDeAtajo(tecla("z"), false, false)).toBeNull();
  });
});

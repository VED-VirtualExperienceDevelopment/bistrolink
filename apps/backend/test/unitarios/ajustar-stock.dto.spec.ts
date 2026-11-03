import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AjustarStockDto } from '../../src/stock/dto/ajustar-stock.dto';

// HU-015 (BL-120): body de PATCH /admin/stock.

const ITEM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function errores(body: unknown): string[] {
  const dto = plainToInstance(AjustarStockDto, body);
  const mensajes: string[] = [];
  const recorrer = (lista: ReturnType<typeof validateSync>) => {
    for (const e of lista) {
      mensajes.push(...Object.values(e.constraints ?? {}));
      recorrer(e.children ?? []);
    }
  };
  recorrer(validateSync(dto));
  return mensajes;
}

describe('AjustarStockDto', () => {
  it('[TC-U-327] acepta el ajuste de un ítem con cualquiera de los tres campos', () => {
    expect(
      errores({
        items: [
          {
            itemId: ITEM_ID,
            controlaStock: true,
            stockActual: 12,
            umbralAlerta: 3,
          },
        ],
      }),
    ).toEqual([]);
    expect(errores({ items: [{ itemId: ITEM_ID, stockActual: 0 }] })).toEqual(
      [],
    );
  });

  it('[TC-U-328] BL-121: un umbral o un stock negativo, o con decimales, se rechaza', () => {
    expect(
      errores({ items: [{ itemId: ITEM_ID, umbralAlerta: -1 }] }),
    ).toContain('umbralAlerta no puede ser negativo');
    expect(
      errores({ items: [{ itemId: ITEM_ID, stockActual: -3 }] }),
    ).toContain('stockActual no puede ser negativo');
    expect(
      errores({ items: [{ itemId: ITEM_ID, stockActual: 2.5 }] }),
    ).toContain('stockActual debe ser un número entero');
  });

  it('[TC-U-329] sin ítems o con un id que no es UUID, se rechaza', () => {
    expect(errores({ items: [] })).toContain('Indicá al menos un ítem');
    expect(errores({ items: [{ itemId: 'abc', stockActual: 1 }] })).toContain(
      'itemId debe ser un UUID',
    );
  });
});

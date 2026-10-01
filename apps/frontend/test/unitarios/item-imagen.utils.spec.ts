import {
  esPlaceholder,
  PLACEHOLDER_ITEM,
  srcImagenItem,
} from '@/components/menu/item-imagen.utils';

// BL-195 / BL-257: imagen de un ítem del menú (público y admin). Si la imagen
// no existe, no carga o el ítem no tiene URL, se muestra un placeholder y el
// layout no se rompe.

const URL_FIRMADA =
  'https://bistrolink-images-staging.s3.us-east-2.amazonaws.com/t/menu/helado.jpg?X-Amz-Signature=abc';

describe('srcImagenItem', () => {
  it('ítem con imagen válida: usa la URL firmada', () => {
    expect(srcImagenItem(URL_FIRMADA, false)).toBe(URL_FIRMADA);
  });

  it.each([
    ['null (el backend no pudo firmar)', null],
    ['undefined (el ítem no tiene imagen)', undefined],
    ['string vacío', ''],
    ['solo espacios', '   '],
  ])('sin URL, %s: usa el placeholder', (_caso, url) => {
    expect(srcImagenItem(url, false)).toBe(PLACEHOLDER_ITEM);
  });

  it('imagen que falló al cargar (ej. 404 en S3): usa el placeholder', () => {
    expect(srcImagenItem(URL_FIRMADA, true)).toBe(PLACEHOLDER_ITEM);
  });

  it('sin URL y con fallo: sigue siendo el placeholder', () => {
    expect(srcImagenItem(null, true)).toBe(PLACEHOLDER_ITEM);
  });
});

describe('esPlaceholder', () => {
  it('true para el placeholder (evita reintentar onError en bucle)', () => {
    expect(esPlaceholder(PLACEHOLDER_ITEM)).toBe(true);
  });

  it('false para una URL real', () => {
    expect(esPlaceholder(URL_FIRMADA)).toBe(false);
  });
});

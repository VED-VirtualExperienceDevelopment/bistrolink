import {
  ErrorSubidaAlmacenamiento,
  mensajeErrorSubida,
  TAMANIO_MAXIMO_IMAGEN,
  validarImagen,
} from '@/components/menu/image-uploader.utils';

// BL-257: un archivo de más de 5 MB o de otro tipo se rechaza con un mensaje
// claro, y cada falla de la subida muestra un mensaje real (no "WIP").

describe('validarImagen', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'acepta %s de hasta 5 MB',
    (type) => {
      expect(validarImagen({ type, size: TAMANIO_MAXIMO_IMAGEN })).toBeNull();
    },
  );

  it.each(['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', ''])(
    'rechaza el tipo %p',
    (type) => {
      expect(validarImagen({ type, size: 1024 })).toBe(
        'Formato no permitido. Usá una imagen PNG, JPG o WEBP.',
      );
    },
  );

  it('rechaza 1 byte por encima de 5 MB, indicando el peso', () => {
    expect(
      validarImagen({ type: 'image/png', size: TAMANIO_MAXIMO_IMAGEN + 1 }),
    ).toBe('La imagen pesa 5 MB. El máximo es 5 MB.');
  });

  it('muestra el peso con un decimal', () => {
    expect(
      validarImagen({ type: 'image/jpeg', size: 7.5 * 1024 * 1024 }),
    ).toBe('La imagen pesa 7,5 MB. El máximo es 5 MB.');
  });

  it('valida el tipo antes que el tamaño', () => {
    expect(validarImagen({ type: 'image/gif', size: 10 * 1024 * 1024 })).toBe(
      'Formato no permitido. Usá una imagen PNG, JPG o WEBP.',
    );
  });
});

describe('mensajeErrorSubida', () => {
  it('S3 responde 403 (la policy rechazó el archivo)', () => {
    expect(mensajeErrorSubida(new ErrorSubidaAlmacenamiento(403))).toBe(
      'El almacenamiento rechazó la imagen. Verificá que sea PNG, JPG o WEBP de hasta 5 MB.',
    );
  });

  it('S3 responde otro error', () => {
    expect(mensajeErrorSubida(new ErrorSubidaAlmacenamiento(500))).toBe(
      'No pudimos guardar la imagen. Probá de nuevo.',
    );
  });

  it('sin respuesta de S3 (red o CORS: fetch tira TypeError)', () => {
    expect(mensajeErrorSubida(new TypeError('Failed to fetch'))).toBe(
      'No pudimos conectar con el almacenamiento de imágenes. Revisá tu conexión y probá de nuevo.',
    );
  });

  it.each([401, 403])(
    'el backend rechaza la URL firmada con %p (sesión o permisos)',
    (status) => {
      expect(mensajeErrorSubida({ status, message: 'x' })).toBe(
        'Tu sesión expiró o no tenés permisos para subir imágenes. Volvé a iniciar sesión.',
      );
    },
  );

  it('el backend falla al generar la URL firmada', () => {
    expect(mensajeErrorSubida({ status: 500, message: 'x' })).toBe(
      'No pudimos preparar la subida. Probá de nuevo en unos minutos.',
    );
  });

  it.each([new Error('otra cosa'), 'texto', null])(
    'cualquier otro error (%p): mensaje genérico',
    (err) => {
      expect(mensajeErrorSubida(err)).toBe(
        'No pudimos subir la imagen. Probá de nuevo.',
      );
    },
  );
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActualizarConfiguracionDto } from '../../src/configuracion/dto/actualizar-configuracion.dto';

/** HU-020 (BL-72): validación de PATCH /admin/configuracion. */

async function errores(body: Record<string, unknown>) {
  const dto = plainToInstance(ActualizarConfiguracionDto, body);
  const resultado = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return resultado.map((e) => e.property);
}

describe('ActualizarConfiguracionDto (HU-020, BL-72)', () => {
  it('acepta una configuración completa', async () => {
    expect(
      await errores({
        razonSocial: 'Uno SRL',
        efectivoHabilitado: false,
        mercadoPagoHabilitado: true,
        plexoHabilitado: false,
        handyHabilitado: false,
        propinasSugeridas: [10, 15, 20],
        propinaPreseleccionada: true,
        cfeProveedor: 'SURTEC',
      }),
    ).toEqual([]);
  });

  it('acepta cambiar un solo campo', async () => {
    expect(await errores({ mercadoPagoHabilitado: false })).toEqual([]);
  });

  it('rechaza el RUT: lo cambia solo la plataforma (BL-412)', async () => {
    expect(await errores({ rut: '211234560019' })).toEqual(['rut']);
  });

  it('limpia los espacios de la razón social y no la acepta vacía', async () => {
    const dto = plainToInstance(ActualizarConfiguracionDto, {
      razonSocial: '  Uno   SRL ',
    });
    expect(dto.razonSocial).toBe('Uno SRL');
    expect(await errores({ razonSocial: '   ' })).toEqual(['razonSocial']);
  });

  it.each(['plexoHabilitado', 'handyHabilitado'])(
    'rechaza habilitar %s: quedó fuera del MVP (BL-452)',
    async (campo) => {
      expect(await errores({ [campo]: true })).toEqual([campo]);
      expect(await errores({ [campo]: false })).toEqual([]);
    },
  );

  it('HU-007b (BL-80): el POS del local se puede habilitar y deshabilitar', async () => {
    expect(await errores({ posHabilitado: true })).toEqual([]);
    expect(await errores({ posHabilitado: false })).toEqual([]);
    expect(await errores({ posHabilitado: 'si' })).toEqual(['posHabilitado']);
  });

  it('los medios de pago son verdadero o falso', async () => {
    expect(await errores({ efectivoHabilitado: 'no' })).toEqual([
      'efectivoHabilitado',
    ]);
  });

  describe('propinas sugeridas', () => {
    it('las ordena de menor a mayor', () => {
      const dto = plainToInstance(ActualizarConfiguracionDto, {
        propinasSugeridas: [20, 10, 15],
      });
      expect(dto.propinasSugeridas).toEqual([10, 15, 20]);
    });

    it('acepta la lista vacía (sin sugerencias)', async () => {
      expect(await errores({ propinasSugeridas: [] })).toEqual([]);
    });

    it.each([
      ['un decimal', [12.5]],
      ['un cero', [0]],
      ['más de 100', [101]],
      ['repetidos', [10, 10]],
      ['más de 5', [5, 10, 15, 20, 25, 30]],
      ['algo que no es una lista', 10],
    ])('rechaza %s', async (_caso, propinasSugeridas) => {
      expect(await errores({ propinasSugeridas })).toEqual([
        'propinasSugeridas',
      ]);
    });
  });

  describe('HU-022 (BL-495): preselección de la propina', () => {
    it('se puede activar y desactivar', async () => {
      expect(await errores({ propinaPreseleccionada: true })).toEqual([]);
      expect(await errores({ propinaPreseleccionada: false })).toEqual([]);
    });

    it.each([['si'], [1], ['true']])(
      'rechaza %p: tiene que ser verdadero o falso',
      async (valor) => {
        expect(await errores({ propinaPreseleccionada: valor })).toEqual([
          'propinaPreseleccionada',
        ]);
      },
    );

    it('se puede mandar junto con los porcentajes sugeridos', async () => {
      expect(
        await errores({
          propinasSugeridas: [5, 10, 15],
          propinaPreseleccionada: true,
        }),
      ).toEqual([]);
    });
  });

  describe('proveedor de CFE', () => {
    it('acepta Surtec', async () => {
      expect(await errores({ cfeProveedor: 'SURTEC' })).toEqual([]);
    });

    it('rechaza Biller: quedó fuera del MVP', async () => {
      expect(await errores({ cfeProveedor: 'BILLER' })).toEqual([
        'cfeProveedor',
      ]);
    });
  });

  describe('HU-036 (BL-206): correo de privacidad', () => {
    it('acepta un correo válido y lo guarda sin espacios y en minúsculas', async () => {
      const dto = plainToInstance(ActualizarConfiguracionDto, {
        emailPrivacidad: '  Privacidad@Uno.com.UY ',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.emailPrivacidad).toBe('privacidad@uno.com.uy');
    });

    it.each([[''], ['   '], [null]])(
      'vacío o null (%p) lo quita',
      async (valor) => {
        const dto = plainToInstance(ActualizarConfiguracionDto, {
          emailPrivacidad: valor,
        });
        expect(await validate(dto)).toEqual([]);
        expect(dto.emailPrivacidad).toBeNull();
      },
    );

    it.each([['no-es-un-correo'], ['a@b'], [123]])(
      'rechaza %p',
      async (valor) => {
        expect(await errores({ emailPrivacidad: valor })).toEqual([
          'emailPrivacidad',
        ]);
      },
    );
  });
  describe('HU-042 (BL-465): cola del KDS', () => {
    it('[TC-U-399] acepta el límite, el umbral y los minutos dentro de rango, y null para desactivar la cola', async () => {
      expect(
        await errores({
          limitePedidosEnPreparacion: 5,
          umbralAlertaCola: 10,
          minutosPreparacionEstimados: 15,
        }),
      ).toEqual([]);
      expect(await errores({ limitePedidosEnPreparacion: null })).toEqual([]);
    });

    it.each([
      ['limitePedidosEnPreparacion', 0],
      ['limitePedidosEnPreparacion', 51],
      ['limitePedidosEnPreparacion', 2.5],
      ['limitePedidosEnPreparacion', '5'],
      ['umbralAlertaCola', 0],
      ['umbralAlertaCola', 201],
      ['umbralAlertaCola', null],
      ['minutosPreparacionEstimados', 0],
      ['minutosPreparacionEstimados', 181],
      ['minutosPreparacionEstimados', 12.5],
    ])(
      '[TC-U-400] rechaza %s = %p (fuera de rango o no entero)',
      async (campo, valor) => {
        expect(await errores({ [campo]: valor })).toEqual([campo]);
      },
    );
  });

  describe('HU-038 (BL-506): umbrales de espera del KDS', () => {
    it('[TC-U-469] acepta los tres umbrales enteros dentro del rango', async () => {
      expect(
        await errores({
          minutosEsperaAtencion: 30,
          minutosEsperaDemorado: 60,
          minutosEsperaDemoraAlta: 120,
        }),
      ).toEqual([]);
      expect(await errores({ minutosEsperaAtencion: 1 })).toEqual([]);
      expect(await errores({ minutosEsperaDemoraAlta: 600 })).toEqual([]);
    });

    it.each([
      ['minutosEsperaAtencion', 0],
      ['minutosEsperaAtencion', 601],
      ['minutosEsperaAtencion', null],
      ['minutosEsperaDemorado', 12.5],
      ['minutosEsperaDemorado', '60'],
      ['minutosEsperaDemoraAlta', -5],
      ['minutosEsperaDemoraAlta', null],
    ])(
      '[TC-U-470] rechaza %s = %p (fuera de rango, no entero o null)',
      async (campo, valor) => {
        expect(await errores({ [campo]: valor })).toEqual([campo]);
      },
    );
  });

  describe('HU-043 (BL-531): plantilla de marca', () => {
    it.each(['clasica', 'gourmet', 'rapida', 'familiar'])(
      '[TC-U-509] acepta la plantilla %p',
      async (plantilla) => {
        expect(await errores({ plantilla })).toEqual([]);
      },
    );

    it.each(['azul', 'Gourmet', '', null, 1])(
      '[TC-U-510] rechaza la plantilla %p (fuera de la lista o null)',
      async (plantilla) => {
        expect(await errores({ plantilla })).toEqual(['plantilla']);
      },
    );
  });

  describe('HU-043 (BL-561): nombre y dirección del local', () => {
    it('[TC-U-535] acepta el nombre y la dirección, sin los espacios de los extremos', async () => {
      const dto = plainToInstance(ActualizarConfiguracionDto, {
        nombre: '  La Parrilla de Juan ',
        direccion: ' 18 de Julio 1234, Montevideo ',
      });

      expect(await validate(dto)).toEqual([]);
      expect(dto.nombre).toBe('La Parrilla de Juan');
      expect(dto.direccion).toBe('18 de Julio 1234, Montevideo');
    });

    it.each([
      ['nombre', ''],
      ['nombre', '   '],
      ['nombre', null],
      ['nombre', 'x'.repeat(121)],
      ['direccion', ''],
      ['direccion', null],
      ['direccion', 'x'.repeat(201)],
      ['direccion', 1234],
    ])(
      '[TC-U-536] rechaza %s = %p (vacío, null, demasiado largo o no es texto)',
      async (campo, valor) => {
        expect(await errores({ [campo]: valor })).toEqual([campo]);
      },
    );
  });

  describe('HU-043 (BL-532): logo del local', () => {
    it('[TC-U-519] acepta una key (la controla el servicio) y null para quitarlo', async () => {
      expect(
        await errores({
          logoKey:
            '11111111-1111-1111-1111-111111111111/menu/marca/0b4f6a3e-1111-4c2d-9e8f-123456789abc.webp',
        }),
      ).toEqual([]);
      expect(await errores({ logoKey: null })).toEqual([]);
    });

    it.each([1, true, { key: 'x' }, 'x'.repeat(201)])(
      '[TC-U-519] rechaza logoKey = %p (no es texto o es demasiado larga)',
      async (logoKey) => {
        expect(await errores({ logoKey })).toEqual(['logoKey']);
      },
    );
  });
});

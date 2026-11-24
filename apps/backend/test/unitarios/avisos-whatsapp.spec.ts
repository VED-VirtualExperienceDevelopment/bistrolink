import { PedidosService } from '../../src/pedidos/pedidos.service';
import { PedidosTransicionService } from '../../src/pedidos/pedidos-transicion.service';
import {
  AvisosWhatsappService,
  instanciaDelTenant,
  telefonoDelContacto,
  textoPagoAprobado,
  textoPedidoListo,
} from '../../src/whatsapp/avisos-whatsapp.service';

jest.mock('../../src/pedidos/cola-kds', () => ({
  ...jest.requireActual('../../src/pedidos/cola-kds'),
  completarCapacidad: jest.fn().mockResolvedValue([]),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTRO_TENANT = '22222222-2222-2222-2222-222222222222';
const PEDIDO = 'c6f91b00-0000-4000-8000-000000000001';

const ENTORNO = {
  EVOLUTION_API_URL: 'https://evo.test',
  EVOLUTION_API_KEY: 'clave-evo',
  EVOLUTION_INSTANCIAS: `otra=${OTRO_TENANT},bistrolink-staging=${TENANT}`,
  WHATSAPP_WEBHOOK_SECRETO: 's'.repeat(40),
  WHATSAPP_TELEFONO_CLAVE: 'k'.repeat(32),
};

function armar(pedido: Record<string, unknown> | null) {
  const tx = { pedido: { findUnique: jest.fn().mockResolvedValue(pedido) } };
  const tenantPrisma = {
    runInTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
      fn(tx),
    ),
  };
  const evolution = {
    enviar: jest.fn((_c, _i, _t, mensajes: string[]) =>
      Promise.resolve(mensajes.length),
    ),
  };
  const avisos = new AvisosWhatsappService(
    tenantPrisma as never,
    evolution as never,
  );
  return { avisos, evolution, tx };
}

const PEDIDO_WHATSAPP = {
  canal: 'WHATSAPP',
  retiroContacto: '+598991234567',
  codigoRetiro: 'R-042',
};

describe('Avisos por WhatsApp (HU-010, BL-604)', () => {
  const entornoOriginal = { ...process.env };
  beforeEach(() => Object.assign(process.env, ENTORNO));
  afterEach(() => {
    process.env = { ...entornoOriginal };
  });

  it('[TC-U-674] textos del aviso con y sin código, instancia del tenant y teléfono del contacto', () => {
    expect(textoPagoAprobado('R-042')).toBe(
      '¡Pago aprobado! Tu pedido ya está en cocina.\nTu código de retiro es *R-042*. Te avisamos por acá cuando esté listo.',
    );
    expect(textoPagoAprobado(null)).toBe(
      '¡Pago aprobado! Tu pedido ya está en cocina.\nTe avisamos por acá cuando esté listo.',
    );
    expect(textoPedidoListo('R-042')).toBe(
      '¡Tu pedido está listo! Pasá por el mostrador y decí el código *R-042*.\n¡Gracias por tu compra!',
    );
    expect(textoPedidoListo(null)).toBe(
      '¡Tu pedido está listo! Pasá por el mostrador a retirarlo.\n¡Gracias por tu compra!',
    );

    const config = {
      evolutionUrl: 'https://evo.test',
      evolutionApiKey: 'k',
      instancias: new Map([
        ['otra', OTRO_TENANT],
        ['bistrolink-staging', TENANT],
      ]),
      secretoWebhook: 's',
      claveTelefono: 'c',
    };
    expect(instanciaDelTenant(config, TENANT)).toBe('bistrolink-staging');
    expect(
      instanciaDelTenant(config, '33333333-3333-3333-3333-333333333333'),
    ).toBeNull();

    expect(telefonoDelContacto('+598991234567')).toBe('598991234567');
    expect(telefonoDelContacto('598991234567')).toBe('598991234567');
    expect(telefonoDelContacto('099 123 456')).toBeNull();
    expect(telefonoDelContacto('ana@correo.com')).toBeNull();
    expect(telefonoDelContacto(null)).toBeNull();
  });

  it('[TC-U-675] pago aprobado y pedido listo de un pedido del bot: un mensaje por la instancia del tenant al número del contacto', async () => {
    const { avisos, evolution, tx } = armar(PEDIDO_WHATSAPP);

    await expect(avisos.pagoAprobado(TENANT, PEDIDO)).resolves.toBe('enviado');
    await expect(avisos.pedidoListo(TENANT, PEDIDO)).resolves.toBe('enviado');

    expect(tx.pedido.findUnique).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      select: { canal: true, retiroContacto: true, codigoRetiro: true },
    });
    expect(evolution.enviar).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ evolutionUrl: 'https://evo.test' }),
      'bistrolink-staging',
      '598991234567',
      [textoPagoAprobado('R-042')],
    );
    expect(evolution.enviar).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'bistrolink-staging',
      '598991234567',
      [textoPedidoListo('R-042')],
    );
  });

  it('[TC-U-676] no se avisa si el bot está apagado, el tenant no tiene instancia o el pedido no es del bot o no tiene contacto', async () => {
    const web = armar({ ...PEDIDO_WHATSAPP, canal: 'WEB' });
    await expect(web.avisos.pagoAprobado(TENANT, PEDIDO)).resolves.toBe(
      'no-aplica',
    );
    const sinContacto = armar({ ...PEDIDO_WHATSAPP, retiroContacto: null });
    await expect(sinContacto.avisos.pedidoListo(TENANT, PEDIDO)).resolves.toBe(
      'no-aplica',
    );
    const noExiste = armar(null);
    await expect(noExiste.avisos.pedidoListo(TENANT, PEDIDO)).resolves.toBe(
      'no-aplica',
    );
    const otroTenant = armar(PEDIDO_WHATSAPP);
    await expect(
      otroTenant.avisos.pagoAprobado(
        '33333333-3333-3333-3333-333333333333',
        PEDIDO,
      ),
    ).resolves.toBe('sin-instancia');
    expect(otroTenant.tx.pedido.findUnique).not.toHaveBeenCalled();

    delete process.env.WHATSAPP_TELEFONO_CLAVE;
    const apagado = armar(PEDIDO_WHATSAPP);
    await expect(apagado.avisos.pagoAprobado(TENANT, PEDIDO)).resolves.toBe(
      'apagado',
    );

    for (const caso of [web, sinContacto, noExiste, otroTenant, apagado]) {
      expect(caso.evolution.enviar).not.toHaveBeenCalled();
    }
  });

  it('[TC-U-677] si Evolution no manda el aviso queda en el log sin el número, y en segundo plano un error nunca se propaga', async () => {
    const { avisos, evolution } = armar(PEDIDO_WHATSAPP);
    evolution.enviar.mockResolvedValueOnce(0);
    const logger = (
      avisos as unknown as { logger: { warn: (m: string) => void } }
    ).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(avisos.pedidoListo(TENANT, PEDIDO)).resolves.toBe(
      'no-enviado',
    );
    const log = String(warn.mock.calls[0][0]);
    expect(log).toContain('***567');
    expect(log).not.toContain('598991234567');

    avisos.enSegundoPlano(Promise.reject(new Error('base caída')), PEDIDO);
    await new Promise((ok) => setImmediate(ok));
    expect(String(warn.mock.calls[1][0])).toContain('base caída');
  });

  it('[TC-U-678] al confirmarse el pago, PedidosService avisa por WhatsApp en segundo plano', () => {
    const avisos = {
      pagoAprobado: jest.fn().mockResolvedValue('enviado'),
      enSegundoPlano: jest.fn(),
    };
    const kds = {
      emitirNuevoPedido: jest.fn(),
      emitirActualizacionPedido: jest.fn(),
      emitirPedidoActualizado: jest.fn(),
      avisarEstadoCola: jest.fn().mockResolvedValue(undefined),
      emitirReportesActualizados: jest.fn(),
    };
    const servicio = new PedidosService(
      {} as never,
      kds as never,
      { recalcularRecientes: jest.fn().mockResolvedValue(undefined) } as never,
      { avisar: jest.fn() } as never,
      undefined,
      avisos as never,
    );

    servicio.notificarPedidoConfirmado(TENANT, {
      id: PEDIDO,
      estado: 'RECIBIDO',
      createdAt: new Date(),
      observacionGeneral: null,
      codigoRetiro: 'R-042',
      retiroNombre: null,
      mesa: { numero: 0 },
      lineas: [],
    } as never);

    expect(avisos.pagoAprobado).toHaveBeenCalledWith(TENANT, PEDIDO);
    expect(avisos.enSegundoPlano).toHaveBeenCalledWith(
      expect.any(Promise),
      PEDIDO,
    );
  });

  it('[TC-U-679] el aviso de «listo» sale solo cuando el pedido pasa a LISTO_PARA_ENTREGAR, después de la transacción', async () => {
    const orden: string[] = [];
    const avisos = {
      pedidoListo: jest.fn(() => {
        orden.push('aviso');
        return Promise.resolve('enviado');
      }),
      enSegundoPlano: jest.fn(),
    };
    const tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue({
          estado: 'EN_PREPARACION',
          codigoRetiro: 'R-042',
        }),
        update: jest.fn().mockResolvedValue({
          id: PEDIDO,
          estado: 'LISTO_PARA_ENTREGAR',
          updatedAt: new Date('2026-11-22T12:00:00Z'),
          mesa: { numero: 0 },
          lineas: [],
        }),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
      pedidoEstadoHistorial: { create: jest.fn() },
      // Sin límite de la cola (HU-042): no se bloquea nada.
      restaurante: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ limitePedidosEnPreparacion: null }),
      },
    };
    const servicio = new PedidosTransicionService(
      {
        runInTenantContext: jest.fn(
          async (_t: string, fn: (t: unknown) => unknown) => {
            const r = await fn(tx);
            orden.push('commit');
            return r;
          },
        ),
      } as never,
      avisos as never,
    );

    await servicio.transicionar({
      tenantId: TENANT,
      keycloakId: 'kc-mozo',
      pedidoId: PEDIDO,
      nuevoEstado: 'LISTO_PARA_ENTREGAR',
    });
    expect(orden).toEqual(['commit', 'aviso']);
    expect(avisos.pedidoListo).toHaveBeenCalledWith(TENANT, PEDIDO);

    // A preparación: sin aviso.
    avisos.pedidoListo.mockClear();
    tx.pedido.findUnique.mockResolvedValue({
      estado: 'RECIBIDO',
      codigoRetiro: 'R-042',
    });
    tx.pedido.update.mockResolvedValue({
      id: PEDIDO,
      estado: 'EN_PREPARACION',
      updatedAt: new Date(),
      mesa: { numero: 0 },
      lineas: [],
    });
    await servicio.transicionar({
      tenantId: TENANT,
      keycloakId: 'kc-mozo',
      pedidoId: PEDIDO,
      nuevoEstado: 'EN_PREPARACION',
    });
    expect(avisos.pedidoListo).not.toHaveBeenCalled();
  });
});

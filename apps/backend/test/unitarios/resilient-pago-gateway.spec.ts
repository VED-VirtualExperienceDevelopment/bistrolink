import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PagoGateway,
  SolicitudCobro,
} from '../../src/pagos/gateways/pago-gateway.interface';
import { PagoTemporalmenteNoDisponibleException } from '../../src/pagos/gateways/pago-temporalmente-no-disponible.exception';
import { ResilientPagoGateway } from '../../src/pagos/gateways/resilient-pago-gateway.decorator';

const SOLICITUD: SolicitudCobro = {
  monto: new Prisma.Decimal('590'),
  idempotencyKey: 'pago-001',
  pedidoId: '3cdf1dad-31d6-43c9-9739-11485e0e23f8',
  tenantId: '11111111-1111-1111-1111-111111111111',
  datosPasarela: {},
};

const APROBADO = { aprobado: true, pasarelaReferencia: 'ORD1' };

// Opciones chicas para que los tests de timeout no tarden 10 segundos.
const OPCIONES = { timeoutMs: 50, halfOpenAfterMs: 60_000, fallosParaAbrir: 3 };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ResilientPagoGateway (BL-77: circuit breaker y modo degradado)', () => {
  let interno: { cobrar: jest.Mock };
  let gateway: PagoGateway;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    interno = { cobrar: jest.fn() };
    gateway = new ResilientPagoGateway(interno, OPCIONES);
  });

  afterEach(() => jest.restoreAllMocks());

  it('si la pasarela responde bien, devuelve el resultado tal cual', async () => {
    interno.cobrar.mockResolvedValue(APROBADO);

    await expect(gateway.cobrar(SOLICITUD)).resolves.toEqual(APROBADO);
    expect(interno.cobrar).toHaveBeenCalledWith(SOLICITUD);
  });

  it('un rechazo de tarjeta (resultado, no error) no cuenta como fallo del circuito', async () => {
    interno.cobrar.mockResolvedValue({
      aprobado: false,
      pasarelaReferencia: 'ORD2',
      motivoRechazo: 'insufficient_amount',
    });

    for (let i = 0; i < 6; i++) {
      await gateway.cobrar(SOLICITUD);
    }

    expect(interno.cobrar).toHaveBeenCalledTimes(6);
  });

  describe('timeout (pasarela lenta)', () => {
    it('si la pasarela tarda más que el timeout => modo degradado (503)', async () => {
      interno.cobrar.mockImplementation(() => dormir(300).then(() => APROBADO));

      await expect(gateway.cobrar(SOLICITUD)).rejects.toThrow(
        PagoTemporalmenteNoDisponibleException,
      );
    });

    it('el modo degradado es un 503 con un mensaje claro para el comensal', async () => {
      interno.cobrar.mockImplementation(() => dormir(300).then(() => APROBADO));

      const error = await gateway.cobrar(SOLICITUD).catch((e) => e);

      expect(error.getStatus()).toBe(503);
      expect(error.message).toContain('quedó pendiente');
    });
  });

  describe('circuit breaker', () => {
    it('tras 3 fallos técnicos seguidos abre el circuito: el 4to intento ni llama a la pasarela', async () => {
      interno.cobrar.mockRejectedValue(new BadGatewayException('caída'));

      for (let i = 0; i < 3; i++) {
        await expect(gateway.cobrar(SOLICITUD)).rejects.toThrow(
          BadGatewayException,
        );
      }
      expect(interno.cobrar).toHaveBeenCalledTimes(3);

      await expect(gateway.cobrar(SOLICITUD)).rejects.toThrow(
        PagoTemporalmenteNoDisponibleException,
      );
      expect(interno.cobrar).toHaveBeenCalledTimes(3); // no volvió a llamar
    });

    it('los timeouts también abren el circuito', async () => {
      interno.cobrar.mockImplementation(() => dormir(300).then(() => APROBADO));

      for (let i = 0; i < 3; i++) {
        await gateway.cobrar(SOLICITUD).catch(() => undefined);
      }
      const llamadasAntes = interno.cobrar.mock.calls.length;

      await expect(gateway.cobrar(SOLICITUD)).rejects.toThrow(
        PagoTemporalmenteNoDisponibleException,
      );
      expect(interno.cobrar.mock.calls.length).toBe(llamadasAntes);
    });

    it('errores del cliente (4xx) NO abren el circuito: no se le corta el servicio a los demás', async () => {
      interno.cobrar.mockRejectedValue(
        new BadRequestException('token inválido'),
      );

      for (let i = 0; i < 6; i++) {
        await expect(gateway.cobrar(SOLICITUD)).rejects.toThrow(
          BadRequestException,
        );
      }

      expect(interno.cobrar).toHaveBeenCalledTimes(6);
    });

    it('un éxito en el medio reinicia la cuenta de fallos consecutivos', async () => {
      interno.cobrar
        .mockRejectedValueOnce(new BadGatewayException('x'))
        .mockRejectedValueOnce(new BadGatewayException('x'))
        .mockResolvedValueOnce(APROBADO)
        .mockRejectedValueOnce(new BadGatewayException('x'))
        .mockRejectedValueOnce(new BadGatewayException('x'))
        .mockResolvedValueOnce(APROBADO);

      await gateway.cobrar(SOLICITUD).catch(() => undefined);
      await gateway.cobrar(SOLICITUD).catch(() => undefined);
      await gateway.cobrar(SOLICITUD);
      await gateway.cobrar(SOLICITUD).catch(() => undefined);
      await gateway.cobrar(SOLICITUD).catch(() => undefined);
      await expect(gateway.cobrar(SOLICITUD)).resolves.toEqual(APROBADO);

      expect(interno.cobrar).toHaveBeenCalledTimes(6); // el circuito nunca se abrió
    });

    it('cada instancia tiene su propio circuito (una pasarela caída no corta a la otra)', async () => {
      const otroInterno = { cobrar: jest.fn().mockResolvedValue(APROBADO) };
      const otraPasarela = new ResilientPagoGateway(otroInterno, OPCIONES);
      interno.cobrar.mockRejectedValue(new BadGatewayException('caída'));

      for (let i = 0; i < 4; i++) {
        await gateway.cobrar(SOLICITUD).catch(() => undefined);
      }

      await expect(otraPasarela.cobrar(SOLICITUD)).resolves.toEqual(APROBADO);
    });
  });

  it('los errores que no son de disponibilidad se propagan sin transformar', async () => {
    const original = new BadRequestException('Faltan datos');
    interno.cobrar.mockRejectedValue(original);

    await expect(gateway.cobrar(SOLICITUD)).rejects.toBe(original);
  });
});

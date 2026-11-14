import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CfeProveedor } from '@prisma/client';
import { ConfiguracionEstablecimientoService } from '../../src/configuracion/configuracion-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { StorageService } from '../../src/menu/storage.service';

/**
 * HU-020 (BL-72): configuración del establecimiento. Lo que se escribe, en
 * qué tabla, y la auditoría en la misma transacción con antes y después.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const ACTOR = { id: 'kc-admin-1' };
const RAZON_SOCIAL = 'Uno SRL';
const RUT = '219999990016';

const RESTAURANTE_ACTUAL = {
  // HU-043 (BL-561): nombre y dirección del local.
  nombre: 'La Parrilla',
  direccion: 'Av. Italia 1234, Montevideo',
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  posHabilitado: true,
  plexoHabilitado: false,
  handyHabilitado: false,
  propinasSugeridas: [10],
  // HU-022 (BL-495): sin preselección del 10 % en la pantalla de pago.
  propinaPreseleccionada: false,
  cfeProveedor: 'SURTEC',
  // HU-042 (BL-465): cola del KDS desactivada.
  limitePedidosEnPreparacion: null,
  umbralAlertaCola: 10,
  minutosPreparacionEstimados: 15,
  // HU-038 (BL-506): umbrales de espera por defecto.
  minutosEsperaAtencion: 30,
  minutosEsperaDemorado: 60,
  minutosEsperaDemoraAlta: 120,
  // HU-043 (BL-531): plantilla de marca por defecto.
  plantilla: 'clasica',
  // HU-043 (BL-532): sin logo.
  logoKey: null as string | null,
};

// HU-043 (BL-532): un logo publicado del tenant y otro de un ítem.
const UUID_LOGO = '0b4f6a3e-1111-4c2d-9e8f-123456789abc';
const KEY_LOGO = `${TENANT_ID}/menu/marca/${UUID_LOGO}.webp`;
const URL_LOGO = 'https://firmada.example/logo.webp';

describe('ConfiguracionEstablecimientoService (HU-020, BL-72)', () => {
  let contextos: string[];
  let tx: any;
  let auditLog: { registrarEnTx: jest.Mock };
  let kdsGateway: {
    emitirPedidoActualizado: jest.Mock;
    avisarEstadoCola: jest.Mock;
    emitirUmbralesEspera: jest.Mock;
  };
  let storage: {
    esKeyDeMarcaDelTenant: jest.Mock;
    existeImagen: jest.Mock;
    urlFirmadaDeLectura: jest.Mock;
  };
  let service: ConfiguracionEstablecimientoService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ razonSocial: RAZON_SOCIAL, rut: RUT }),
        update: jest.fn().mockResolvedValue({}),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ ...RESTAURANTE_ACTUAL }),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...RESTAURANTE_ACTUAL, ...data }),
        ),
      },
      // HU-042 (BL-465): cola del KDS (completarCapacidad).
      pedido: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      pedidoEstadoHistorial: { create: jest.fn(), createMany: jest.fn() },
      $executeRaw: jest.fn(),
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    auditLog = { registrarEnTx: jest.fn().mockResolvedValue(undefined) };
    kdsGateway = {
      emitirPedidoActualizado: jest.fn(),
      avisarEstadoCola: jest.fn().mockResolvedValue(undefined),
      emitirUmbralesEspera: jest.fn(),
    };
    // HU-043 (BL-532): el formato de la key se prueba en storage.service.spec.
    storage = {
      esKeyDeMarcaDelTenant: jest.fn(
        (key: string, tenantId: string) =>
          key === `${tenantId}/menu/marca/${UUID_LOGO}.webp`,
      ),
      existeImagen: jest.fn().mockResolvedValue(true),
      urlFirmadaDeLectura: jest.fn().mockResolvedValue(URL_LOGO),
    };
    service = new ConfiguracionEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      auditLog as unknown as AuditLogService,
      kdsGateway as unknown as KdsGateway,
      storage as unknown as StorageService,
    );
  });

  describe('obtener', () => {
    it('junta los datos fiscales del tenant y la configuración del restaurante, en el contexto del tenant', async () => {
      const configuracion = await service.obtener(TENANT_ID);

      expect(contextos).toEqual([TENANT_ID]);
      // HU-043 (BL-532): el logo va como URL; la key no se devuelve.
      const restaurante: Record<string, unknown> = { ...RESTAURANTE_ACTUAL };
      delete restaurante.logoKey;
      expect(configuracion).toEqual({
        razonSocial: RAZON_SOCIAL,
        rut: RUT,
        ...restaurante,
        logoUrl: null,
        mediosPagoDisponibles: ['EFECTIVO', 'MERCADOPAGO', 'POS'],
        proveedoresCfeDisponibles: ['SURTEC'],
        // HU-043 (BL-531): la plantilla y las que se pueden elegir.
        plantillasDisponibles: ['clasica', 'gourmet', 'rapida', 'familiar'],
      });
    });

    it('establecimiento inexistente: 404', async () => {
      tx.tenant.findUnique.mockResolvedValue(null);

      await expect(service.obtener(TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('alta sin restaurante: 409', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await expect(service.obtener(TENANT_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('actualizar', () => {
    it('sin campos: 400 y no abre la transacción', async () => {
      await expect(
        service.actualizar(TENANT_ID, {}, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contextos).toEqual([]);
    });

    it('apagar el efectivo y cambiar las propinas: escribe solo eso en restaurante y lo audita con antes y después en la misma transacción', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
        ACTOR,
      );

      expect(contextos).toEqual([TENANT_ID]);
      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          data: { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
        }),
      );
      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR.id,
        entidadId: TENANT_ID,
        detalle: { campos: ['efectivoHabilitado', 'propinasSugeridas'] },
        antes: { efectivoHabilitado: true, propinasSugeridas: [10] },
        despues: { efectivoHabilitado: false, propinasSugeridas: [10, 15, 20] },
      });
      expect(configuracion.efectivoHabilitado).toBe(false);
      expect(configuracion.propinasSugeridas).toEqual([10, 15, 20]);
    });

    it('HU-022 (BL-495): activar la preselección de la propina: escribe solo eso, lo audita con antes y después y no avisa al KDS', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { propinaPreseleccionada: true },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          data: { propinaPreseleccionada: true },
        }),
      );
      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR.id,
        entidadId: TENANT_ID,
        detalle: { campos: ['propinaPreseleccionada'] },
        antes: { propinaPreseleccionada: false },
        despues: { propinaPreseleccionada: true },
      });
      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
      expect(configuracion.propinaPreseleccionada).toBe(true);
    });

    it('HU-022 (BL-495): mandar la preselección que ya tiene el local no escribe ni audita', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { propinaPreseleccionada: false },
        ACTOR,
      );

      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      expect(configuracion.propinaPreseleccionada).toBe(false);
    });

    it('razón social: la cambia en tenant y la audita sin el valor', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { razonSocial: 'Uno y Cía SRL' },
        ACTOR,
      );

      expect(tx.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
        data: { razonSocial: 'Uno y Cía SRL' },
      });
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.detalle).toEqual({ campos: ['razonSocial'] });
      expect(JSON.stringify(entrada)).not.toContain('Uno');
      expect(configuracion.razonSocial).toBe('Uno y Cía SRL');
      expect(configuracion.rut).toBe(RUT);
    });

    it('HU-036 (BL-206): correo de privacidad: lo guarda en restaurante y lo audita sin el valor', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { emailPrivacidad: 'privacidad@uno.com.uy' },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailPrivacidad: 'privacidad@uno.com.uy' },
        }),
      );
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.detalle).toEqual({ campos: ['emailPrivacidad'] });
      expect(JSON.stringify(entrada)).not.toContain('privacidad@');
      expect(configuracion.emailPrivacidad).toBe('privacidad@uno.com.uy');
    });

    it('el proveedor de CFE queda en el diff', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        ...RESTAURANTE_ACTUAL,
        cfeProveedor: 'BILLER',
      });

      await service.actualizar(
        TENANT_ID,
        { cfeProveedor: CfeProveedor.SURTEC },
        ACTOR,
      );

      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.antes).toEqual({ cfeProveedor: 'BILLER' });
      expect(entrada.despues).toEqual({ cfeProveedor: 'SURTEC' });
    });

    it('mismos valores que los actuales: no escribe ni audita', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        {
          razonSocial: RAZON_SOCIAL,
          efectivoHabilitado: true,
          propinasSugeridas: [10],
        },
        ACTOR,
      );

      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      expect(configuracion.efectivoHabilitado).toBe(true);
    });

    it('si falla la auditoría, falla el cambio (misma transacción)', async () => {
      auditLog.registrarEnTx.mockRejectedValue(new Error('base caída'));

      await expect(
        service.actualizar(TENANT_ID, { mercadoPagoHabilitado: false }, ACTOR),
      ).rejects.toThrow('base caída');
    });

    it('alta sin restaurante: 409 sin escribir nada', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT_ID, { mercadoPagoHabilitado: false }, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });
  });
  describe('HU-042 (BL-465): cola del KDS', () => {
    it('[TC-U-401] activar la cola: guarda el límite, lo audita con antes y después y llena la cocina en la misma transacción', async () => {
      // Al escribir el límite, completarCapacidad lo lee de la base.
      tx.restaurante.findUnique
        .mockResolvedValueOnce({ ...RESTAURANTE_ACTUAL })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: 2 });
      tx.pedido.findMany.mockResolvedValue([
        { id: 'PED-101', mesa: { numero: 3 }, lineas: [] },
      ]);

      const configuracion = await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: 2 },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { limitePedidosEnPreparacion: 2 } }),
      );
      const [, entrada] = auditLog.registrarEnTx.mock.calls[0];
      expect(entrada.antes).toEqual({ limitePedidosEnPreparacion: null });
      expect(entrada.despues).toEqual({ limitePedidosEnPreparacion: 2 });
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['PED-101'] }, estado: 'RECIBIDO' },
        data: { estado: 'EN_PREPARACION', updatedAt: expect.any(Date) },
      });
      expect(configuracion.limitePedidosEnPreparacion).toBe(2);
    });

    it('[TC-U-402] después del commit avisa al KDS los pedidos promovidos y el estado de la cola', async () => {
      tx.restaurante.findUnique
        .mockResolvedValueOnce({ ...RESTAURANTE_ACTUAL })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: 2 });
      tx.pedido.findMany.mockResolvedValue([
        { id: 'PED-101', mesa: { numero: 3 }, lineas: [] },
      ]);

      await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: 2 },
        ACTOR,
      );

      expect(kdsGateway.emitirPedidoActualizado).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ id: 'PED-101', estado: 'EN_PREPARACION' }),
      );
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-403] desactivar la cola (null): no promueve a nadie y avisa al KDS que se apagó', async () => {
      tx.restaurante.findUnique
        .mockResolvedValueOnce({
          ...RESTAURANTE_ACTUAL,
          limitePedidosEnPreparacion: 5,
        })
        .mockResolvedValueOnce({ limitePedidosEnPreparacion: null });

      await service.actualizar(
        TENANT_ID,
        { limitePedidosEnPreparacion: null },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { limitePedidosEnPreparacion: null } }),
      );
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(kdsGateway.emitirPedidoActualizado).not.toHaveBeenCalled();
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-404] cambiar solo el umbral o los minutos: no toca la cocina, pero avisa el estado nuevo', async () => {
      await service.actualizar(
        TENANT_ID,
        { umbralAlertaCola: 8, minutosPreparacionEstimados: 20 },
        ACTOR,
      );

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.pedido.findMany).not.toHaveBeenCalled();
      expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID, {
        forzar: true,
      });
    });

    it('[TC-U-405] cambiar algo que no es de la cola (propinas) no avisa al KDS', async () => {
      await service.actualizar(
        TENANT_ID,
        { propinasSugeridas: [10, 15] },
        ACTOR,
      );

      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
    });
  });

  describe('HU-038 (BL-506): umbrales de espera del KDS', () => {
    it('[TC-U-471] cambiar los umbrales: los guarda, los audita con antes y después y avisa al KDS después del commit', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        {
          minutosEsperaAtencion: 20,
          minutosEsperaDemorado: 40,
          minutosEsperaDemoraAlta: 90,
        },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            minutosEsperaAtencion: 20,
            minutosEsperaDemorado: 40,
            minutosEsperaDemoraAlta: 90,
          },
        }),
      );
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          antes: {
            minutosEsperaAtencion: 30,
            minutosEsperaDemorado: 60,
            minutosEsperaDemoraAlta: 120,
          },
          despues: {
            minutosEsperaAtencion: 20,
            minutosEsperaDemorado: 40,
            minutosEsperaDemoraAlta: 90,
          },
        }),
      );
      expect(configuracion).toMatchObject({
        minutosEsperaAtencion: 20,
        minutosEsperaDemorado: 40,
        minutosEsperaDemoraAlta: 90,
      });
      expect(kdsGateway.emitirUmbralesEspera).toHaveBeenCalledWith(TENANT_ID, {
        atencion: 20,
        demorado: 40,
        demoraAlta: 90,
      });
      // No son de la cola: no hace falta avisar el estado de la cola.
      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
    });

    it.each([
      [
        { minutosEsperaAtencion: 60 },
        '«Demorado desde» tiene que ser mayor que «Atención desde»',
      ],
      [
        { minutosEsperaDemoraAlta: 50 },
        '«Demora alta desde» tiene que ser mayor que «Demorado desde»',
      ],
      [
        { minutosEsperaDemorado: 120, minutosEsperaDemoraAlta: 120 },
        '«Demora alta desde» tiene que ser mayor que «Demorado desde»',
      ],
    ])(
      '[TC-U-472] umbrales fuera de orden (%p): 400 sin escribir, auditar ni avisar',
      async (dto, mensaje) => {
        await expect(service.actualizar(TENANT_ID, dto, ACTOR)).rejects.toThrow(
          new BadRequestException(mensaje),
        );
        expect(tx.restaurante.update).not.toHaveBeenCalled();
        expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
        expect(kdsGateway.emitirUmbralesEspera).not.toHaveBeenCalled();
      },
    );

    it('[TC-U-473] el orden se controla con lo guardado: cambiar solo uno que respeta el orden se acepta', async () => {
      await service.actualizar(TENANT_ID, { minutosEsperaAtencion: 45 }, ACTOR);

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { minutosEsperaAtencion: 45 } }),
      );
      expect(kdsGateway.emitirUmbralesEspera).toHaveBeenCalledWith(TENANT_ID, {
        atencion: 45,
        demorado: 60,
        demoraAlta: 120,
      });
    });

    it('[TC-U-474] mandar los mismos umbrales o cambiar otra cosa no avisa al KDS', async () => {
      await service.actualizar(
        TENANT_ID,
        { minutosEsperaAtencion: 30, propinasSugeridas: [10, 15] },
        ACTOR,
      );

      expect(kdsGateway.emitirUmbralesEspera).not.toHaveBeenCalled();
    });

    it('[TC-U-511] HU-043 (BL-531): cambiar la plantilla la guarda y la audita con antes y después, sin avisar al KDS', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { plantilla: 'gourmet' },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          data: { plantilla: 'gourmet' },
        }),
      );
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
          detalle: { campos: ['plantilla'] },
          antes: { plantilla: 'clasica' },
          despues: { plantilla: 'gourmet' },
        }),
      );
      expect(configuracion).toMatchObject({
        plantilla: 'gourmet',
        plantillasDisponibles: ['clasica', 'gourmet', 'rapida', 'familiar'],
      });
      // La plantilla es de la carta del comensal: el KDS no se entera.
      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
      expect(kdsGateway.emitirUmbralesEspera).not.toHaveBeenCalled();
    });

    it('[TC-U-512] HU-043 (BL-531): mandar la misma plantilla no escribe ni audita', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { plantilla: 'clasica' },
        ACTOR,
      );

      expect(tx.restaurante.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      expect(configuracion.plantilla).toBe('clasica');
    });

    it('[TC-U-537] HU-043 (BL-561): cambiar el nombre y la dirección del local los escribe en restaurante y los audita con antes y después', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { nombre: 'La Parrilla de Juan', direccion: '18 de Julio 1234' },
        ACTOR,
      );

      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID },
          data: {
            nombre: 'La Parrilla de Juan',
            direccion: '18 de Julio 1234',
          },
        }),
      );
      expect(tx.tenant.update).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          detalle: { campos: ['nombre', 'direccion'] },
          antes: {
            nombre: 'La Parrilla',
            direccion: 'Av. Italia 1234, Montevideo',
          },
          despues: {
            nombre: 'La Parrilla de Juan',
            direccion: '18 de Julio 1234',
          },
        }),
      );
      expect(configuracion).toMatchObject({
        nombre: 'La Parrilla de Juan',
        direccion: '18 de Julio 1234',
      });
      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
    });

    it('[TC-U-520] HU-043 (BL-532): un logo publicado del tenant se guarda, se audita con antes y después y se responde como URL firmada', async () => {
      const configuracion = await service.actualizar(
        TENANT_ID,
        { logoKey: KEY_LOGO },
        ACTOR,
      );

      expect(storage.existeImagen).toHaveBeenCalledWith(KEY_LOGO);
      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { logoKey: KEY_LOGO } }),
      );
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          detalle: { campos: ['logoKey'] },
          antes: { logoKey: null },
          despues: { logoKey: KEY_LOGO },
        }),
      );
      expect(storage.urlFirmadaDeLectura).toHaveBeenCalledWith(KEY_LOGO);
      expect(configuracion.logoUrl).toBe(URL_LOGO);
      expect(configuracion).not.toHaveProperty('logoKey');
      expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
    });

    it.each([
      [
        'de otro tenant',
        `bbbbbbbb-2222-4222-8222-222222222222/menu/marca/${UUID_LOGO}.webp`,
      ],
      ['de un ítem de la carta', `${TENANT_ID}/menu/${UUID_LOGO}.webp`],
      ['de la cuarentena', `incoming/${TENANT_ID}/${UUID_LOGO}`],
    ])(
      '[TC-U-521] HU-043 (BL-532): una key %s da 400 sin abrir la transacción',
      async (_caso, logoKey) => {
        await expect(
          service.actualizar(TENANT_ID, { logoKey }, ACTOR),
        ).rejects.toThrow(
          new BadRequestException(
            'El logo no es válido para este establecimiento',
          ),
        );
        expect(storage.existeImagen).not.toHaveBeenCalled();
        expect(contextos).toEqual([]);
        expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
      },
    );

    it('[TC-U-521] HU-043 (BL-532): un logo que no está en el bucket da 400 sin abrir la transacción', async () => {
      storage.existeImagen.mockResolvedValue(false);

      await expect(
        service.actualizar(TENANT_ID, { logoKey: KEY_LOGO }, ACTOR),
      ).rejects.toThrow(
        new BadRequestException('El logo indicado no existe. Volvé a subirlo.'),
      );
      expect(contextos).toEqual([]);
    });

    it('[TC-U-522] HU-043 (BL-532): null quita el logo, sin consultar el bucket', async () => {
      tx.restaurante.findUnique.mockResolvedValue({
        ...RESTAURANTE_ACTUAL,
        logoKey: KEY_LOGO,
      });

      const configuracion = await service.actualizar(
        TENANT_ID,
        { logoKey: null },
        ACTOR,
      );

      expect(storage.existeImagen).not.toHaveBeenCalled();
      expect(tx.restaurante.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { logoKey: null } }),
      );
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          antes: { logoKey: KEY_LOGO },
          despues: { logoKey: null },
        }),
      );
      expect(configuracion.logoUrl).toBeNull();
    });
  });
});

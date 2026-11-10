import 'reflect-metadata';
import {
  LimpiezaConfiguracionService,
  configuracionDelSeed,
  diferenciasConElSeed,
} from '../../src/testing/limpieza-configuracion.service';
import {
  LimpiezaUsuariosService,
  accionParaUsuario,
} from '../../src/testing/limpieza-usuarios.service';
import { LimpiezaPruebasController } from '../../src/testing/limpieza-pruebas.controller';

// BL-481 (BL-285, ADR 0011): configuración y usuarios de prueba.

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const ACTOR = 'kc-admin-1';

/** La configuración tal como la deja el seed del tenant A. */
function configuracionSeedA() {
  return {
    razonSocial: 'Restaurante Testing A SRL',
    rut: '214198620015',
    efectivoHabilitado: true,
    mercadoPagoHabilitado: true,
    posHabilitado: true,
    plexoHabilitado: false,
    handyHabilitado: false,
    mediosPagoDisponibles: ['EFECTIVO', 'MERCADO_PAGO'],
    propinasSugeridas: [],
    propinaPreseleccionada: false,
    cfeProveedor: 'SURTEC',
    proveedoresCfeDisponibles: ['SURTEC'],
    emailPrivacidad: 'privacidad@ejemplo.uy',
    limitePedidosEnPreparacion: null,
    umbralAlertaCola: 10,
    minutosPreparacionEstimados: 15,
    minutosEsperaAtencion: 30,
    minutosEsperaDemorado: 60,
    minutosEsperaDemoraAlta: 120,
  } as any;
}

describe('Configuración como el seed', () => {
  it('[TC-U-450] el seed de cada tenant de testing trae su razón social; otro tenant, no', () => {
    expect(configuracionDelSeed(TENANT_A).razonSocial).toBe(
      'Restaurante Testing A SRL',
    );
    expect(configuracionDelSeed(TENANT_B).razonSocial).toBe(
      'Restaurante Testing B SRL',
    );
    const otro = configuracionDelSeed('99999999-9999-4999-8999-999999999999');
    expect(otro).not.toHaveProperty('razonSocial');
    expect(otro).toEqual(
      expect.objectContaining({
        efectivoHabilitado: true,
        propinasSugeridas: [],
        // HU-022 (BL-496): la propina preseleccionada vuelve a apagada.
        propinaPreseleccionada: false,
        limitePedidosEnPreparacion: null,
      }),
    );
    // Nunca toca el correo de privacidad ni el RUT.
    expect(otro).not.toHaveProperty('emailPrivacidad');
    expect(otro).not.toHaveProperty('rut');
  });

  it('[TC-U-451] diferencias: solo los campos que cambiaron, con el valor del seed', () => {
    const seed = configuracionDelSeed(TENANT_A);
    expect(diferenciasConElSeed(configuracionSeedA(), seed)).toEqual({});

    const tocada = {
      ...configuracionSeedA(),
      razonSocial: 'Otra SRL',
      efectivoHabilitado: false,
      propinasSugeridas: [10, 15],
      propinaPreseleccionada: true,
      limitePedidosEnPreparacion: 3,
      emailPrivacidad: 'otro@ejemplo.uy',
    };
    expect(diferenciasConElSeed(tocada, seed)).toEqual({
      razonSocial: 'Restaurante Testing A SRL',
      efectivoHabilitado: true,
      propinasSugeridas: [],
      propinaPreseleccionada: false,
      limitePedidosEnPreparacion: null,
    });
  });
});

describe('LimpiezaConfiguracionService', () => {
  function armar(actual: Record<string, unknown>) {
    const configuracion = {
      obtener: jest.fn().mockResolvedValue(actual),
      actualizar: jest.fn().mockResolvedValue(actual),
    };
    return {
      configuracion,
      service: new LimpiezaConfiguracionService(configuracion as any),
    };
  }

  it('[TC-U-452] con cambios usa el servicio de Configuración (auditoría y cola); en dry-run solo los lista', async () => {
    const tocada = {
      ...configuracionSeedA(),
      mercadoPagoHabilitado: false,
      umbralAlertaCola: 3,
    };

    const enDryRun = armar(tocada);
    expect(await enDryRun.service.limpiar(TENANT_A, ACTOR, true)).toEqual({
      camposRestablecidos: ['mercadoPagoHabilitado', 'umbralAlertaCola'],
    });
    expect(enDryRun.configuracion.actualizar).not.toHaveBeenCalled();

    const deVerdad = armar(tocada);
    await deVerdad.service.limpiar(TENANT_A, ACTOR, false);
    expect(deVerdad.configuracion.actualizar).toHaveBeenCalledWith(
      TENANT_A,
      { mercadoPagoHabilitado: true, umbralAlertaCola: 10 },
      { id: ACTOR },
    );
  });

  it('[TC-U-453] como el seed, no llama a actualizar (respondería 400 «No hay cambios»)', async () => {
    const { configuracion, service } = armar(configuracionSeedA());

    expect(await service.limpiar(TENANT_A, ACTOR, false)).toEqual({
      camposRestablecidos: [],
    });
    expect(configuracion.actualizar).not.toHaveBeenCalled();
  });

  it('HU-022 (BL-496): una propina preseleccionada que dejó un E2E se restablece a apagada', async () => {
    const { configuracion, service } = armar({
      ...configuracionSeedA(),
      propinaPreseleccionada: true,
    });

    expect(await service.limpiar(TENANT_A, ACTOR, false)).toEqual({
      camposRestablecidos: ['propinaPreseleccionada'],
    });
    expect(configuracion.actualizar).toHaveBeenCalledWith(
      TENANT_A,
      { propinaPreseleccionada: false },
      { id: ACTOR },
    );
  });
});

describe('LimpiezaUsuariosService', () => {
  const usuario = (
    id: string,
    activo: boolean,
    pedidosComoMozo = 0,
    historial = 0,
  ) => ({ id, activo, _count: { pedidosComoMozo, historial } });

  it('[TC-U-454] sin historial se elimina; con historial se desactiva (o nada si ya está inactivo)', () => {
    expect(accionParaUsuario(usuario('a', true))).toBe('eliminar');
    expect(accionParaUsuario(usuario('b', false))).toBe('eliminar');
    expect(accionParaUsuario(usuario('c', true, 1))).toBe('desactivar');
    expect(accionParaUsuario(usuario('d', true, 0, 2))).toBe('desactivar');
    expect(accionParaUsuario(usuario('e', false, 1))).toBe('nada');
  });

  function armar(filas: ReturnType<typeof usuario>[]) {
    const tx = { usuario: { findMany: jest.fn().mockResolvedValue(filas) } };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: any) => fn(tx)),
    };
    const usuarios = {
      eliminar: jest.fn().mockResolvedValue({ eliminado: true }),
      desactivar: jest.fn().mockResolvedValue({}),
    };
    const service = new LimpiezaUsuariosService(
      tenantPrisma as any,
      usuarios as any,
    );
    return { tx, usuarios, service };
  }

  it('[TC-U-455] busca solo los «e2e-…» del tenant y usa el servicio de Usuarios (Keycloak, reglas y auditoría)', async () => {
    const { tx, usuarios, service } = armar([
      usuario('u1', true),
      usuario('u2', true, 3),
      usuario('u3', false, 1),
    ]);

    const resumen = await service.limpiar(TENANT_A, ACTOR, false);

    expect(tx.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: { startsWith: 'e2e-' } },
      }),
    );
    expect(usuarios.eliminar).toHaveBeenCalledWith(TENANT_A, ACTOR, 'u1');
    expect(usuarios.desactivar).toHaveBeenCalledWith(TENANT_A, ACTOR, 'u2');
    expect(usuarios.eliminar).toHaveBeenCalledTimes(1);
    expect(usuarios.desactivar).toHaveBeenCalledTimes(1);
    expect(resumen).toEqual({ eliminados: 1, desactivados: 1, conError: 0 });
  });

  it('[TC-U-456] dry-run no cambia nada; un error no corta a los demás y se cuenta', async () => {
    const enDryRun = armar([usuario('u1', true), usuario('u2', true, 1)]);
    expect(await enDryRun.service.limpiar(TENANT_A, ACTOR, true)).toEqual({
      eliminados: 1,
      desactivados: 1,
      conError: 0,
    });
    expect(enDryRun.usuarios.eliminar).not.toHaveBeenCalled();
    expect(enDryRun.usuarios.desactivar).not.toHaveBeenCalled();

    const conFalla = armar([usuario('u1', true), usuario('u2', true)]);
    conFalla.usuarios.eliminar
      .mockRejectedValueOnce(new Error('Keycloak no respondió'))
      .mockResolvedValueOnce({ eliminado: true });
    expect(await conFalla.service.limpiar(TENANT_A, ACTOR, false)).toEqual({
      eliminados: 1,
      desactivados: 0,
      conError: 1,
    });
    expect(conFalla.usuarios.eliminar).toHaveBeenCalledTimes(2);
  });
});

describe('LimpiezaPruebasController · configuración y usuarios', () => {
  const req = { user: { sub: ACTOR, tenantId: TENANT_A, roles: ['ADMIN'] } };

  it('[TC-U-457] limpia configuración y usuarios al final, con el dry-run pedido', async () => {
    const limpiezaConfiguracion = {
      limpiar: jest
        .fn()
        .mockResolvedValue({ camposRestablecidos: ['plexoHabilitado'] }),
    };
    const limpiezaUsuarios = {
      limpiar: jest
        .fn()
        .mockResolvedValue({ eliminados: 2, desactivados: 0, conError: 0 }),
    };
    const controller = new LimpiezaPruebasController(
      { limpiar: jest.fn() } as any,
      { limpiar: jest.fn() } as any,
      { limpiar: jest.fn() } as any,
      {} as any,
      {} as any,
      limpiezaConfiguracion as any,
      limpiezaUsuarios as any,
    );

    const respuesta = await controller.limpiar(req as any, {
      areas: ['configuracion', 'usuarios'],
      dryRun: true,
    });

    expect(limpiezaConfiguracion.limpiar).toHaveBeenCalledWith(
      TENANT_A,
      ACTOR,
      true,
    );
    expect(limpiezaUsuarios.limpiar).toHaveBeenCalledWith(
      TENANT_A,
      ACTOR,
      true,
    );
    expect(respuesta).toEqual({
      dryRun: true,
      configuracion: { camposRestablecidos: ['plexoHabilitado'] },
      usuarios: { eliminados: 2, desactivados: 0, conError: 0 },
    });
  });
});

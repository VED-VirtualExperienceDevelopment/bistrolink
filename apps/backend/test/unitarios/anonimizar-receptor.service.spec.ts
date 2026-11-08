import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnonimizarReceptorService } from '../../src/configuracion/anonimizar-receptor.service';
import { AnonimizarReceptorDto } from '../../src/configuracion/dto/anonimizar-receptor.dto';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// HU-009 (BL-453): el administrador anonimiza el RUT y la razón social de
// la e-Factura en los pedidos de su local.
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RUT = '219999830019';
const AHORA = new Date('2026-11-02T15:00:00Z');

describe('AnonimizarReceptorService', () => {
  let tx: { pedido: { updateMany: jest.Mock } };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: AnonimizarReceptorService;

  beforeEach(() => {
    tx = { pedido: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    auditLog = { registrarEnTx: jest.fn().mockResolvedValue(undefined) };
    service = new AnonimizarReceptorService(
      tenantPrisma as any,
      auditLog as any,
    );
  });

  it('borra RUT y razón social de los pedidos del tenant con ese RUT y deja la fecha', async () => {
    const resultado = await service.anonimizar(
      TENANT_ID,
      RUT,
      { id: 'kc-admin-1' },
      AHORA,
    );

    expect(resultado).toEqual({ pedidos: 2 });
    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, receptorRut: RUT },
      data: {
        receptorRut: null,
        receptorRazonSocial: null,
        receptorAnonimizadoEn: AHORA,
      },
    });
  });

  it('audita en la misma transacción, con la cantidad de pedidos y sin el RUT', async () => {
    await service.anonimizar(TENANT_ID, RUT, { id: 'kc-admin-1' }, AHORA);

    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
      action: AuditAction.PEDIDO_RECEPTOR_ANONIMIZADO,
      tenantId: TENANT_ID,
      actorKeycloakId: 'kc-admin-1',
      detalle: { pedidos: 2 },
    });
    expect(JSON.stringify(auditLog.registrarEnTx.mock.calls)).not.toContain(
      RUT,
    );
  });

  it('sin pedidos con ese RUT: responde 0 y queda auditado igual', async () => {
    tx.pedido.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.anonimizar(TENANT_ID, RUT, { id: 'kc-admin-1' }, AHORA),
    ).resolves.toEqual({ pedidos: 0 });
    expect(auditLog.registrarEnTx).toHaveBeenCalledTimes(1);
  });
});

describe('AnonimizarReceptorDto (HU-009, BL-453)', () => {
  const instancia = (rut: unknown) =>
    plainToInstance(AnonimizarReceptorDto, { rut });

  it('acepta el RUT con separadores y lo normaliza', async () => {
    const dto = instancia('21.999983.001-9');
    expect(await validate(dto)).toEqual([]);
    expect(dto.rut).toBe(RUT);
  });

  it.each(['219999830018', '', 21999983001])('rechaza %p', async (rut) => {
    const errores = await validate(instancia(rut));
    expect(errores.map((e) => e.property)).toEqual(['rut']);
  });
});

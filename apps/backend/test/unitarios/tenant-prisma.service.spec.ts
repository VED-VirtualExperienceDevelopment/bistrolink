import { PrismaClient } from '@prisma/client';
import { PrismaRuntimeClient } from '../../src/prisma/prisma-runtime.client';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

/**
 * Pool de conexiones compartido: TenantPrismaService (por request) usa el
 * PrismaRuntimeClient que recibe por inyección, en lugar de crear un
 * PrismaClient propio en cada request. No se conecta a ninguna base: el
 * cliente se reemplaza por uno simulado.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function clienteSimulado() {
  const executeRawUnsafe = jest.fn().mockResolvedValue(1);
  const tx = { $executeRawUnsafe: executeRawUnsafe };
  const transaction = jest.fn((fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );
  const cliente = {
    $transaction: transaction,
  } as unknown as PrismaRuntimeClient;
  return { cliente, transaction, executeRawUnsafe, tx };
}

describe('TenantPrismaService y PrismaRuntimeClient (pool compartido)', () => {
  it('[TC-U-145] dos instancias por request usan el mismo cliente inyectado y fijan el tenant en la transacción', async () => {
    const { cliente, transaction, executeRawUnsafe, tx } = clienteSimulado();
    const requestA = new TenantPrismaService(cliente);
    const requestB = new TenantPrismaService(cliente);

    const fn = jest.fn().mockResolvedValue('ok');
    await expect(requestA.runInTenantContext(TENANT_ID, fn)).resolves.toBe(
      'ok',
    );
    await requestB.runInTenantContext(TENANT_ID, jest.fn());

    // Las dos requests pasaron por el MISMO cliente: no se abrió otro pool.
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      `SELECT set_config('app.tenant_id', $1, true)`,
      TENANT_ID,
    );
    expect(fn).toHaveBeenCalledWith(tx);
  });

  it('[TC-U-146] runInTenantContext sin tenantId falla sin abrir una transacción', async () => {
    const { cliente, transaction } = clienteSimulado();
    const service = new TenantPrismaService(cliente);

    await expect(service.runInTenantContext('', jest.fn())).rejects.toThrow(
      'runInTenantContext: tenantId requerido',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('[TC-U-147] PrismaRuntimeClient cierra sus conexiones al apagarse la aplicación', async () => {
    const disconnect = jest
      .spyOn(PrismaClient.prototype, '$disconnect')
      .mockResolvedValue(undefined);
    const cliente = new PrismaRuntimeClient();

    await cliente.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
    disconnect.mockRestore();
  });
});

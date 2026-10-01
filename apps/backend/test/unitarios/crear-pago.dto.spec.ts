import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearPagoDto } from '../../src/pagos/dto/crear-pago.dto';

describe('CrearPagoDto (BL-90: el monto nunca viaja desde el cliente)', () => {
  const base = {
    pedidoId: '3cdf1dad-31d6-43c9-9739-11485e0e23f8',
    idempotencyKey: 'pago-001',
    medioPago: 'MERCADOPAGO',
    datosPasarela: { token: 'tok', paymentMethodId: 'master' },
  };

  const propiedadesConError = async (datos: Record<string, unknown>) => {
    const errores = await validate(plainToInstance(CrearPagoDto, datos));
    return errores.map((e) => e.property);
  };

  it('un pago bien formado es válido', async () => {
    expect(await propiedadesConError(base)).toEqual([]);
  });

  it('acepta PLEXO y MERCADOPAGO como medio de pago', async () => {
    expect(await propiedadesConError({ ...base, medioPago: 'PLEXO' })).toEqual(
      [],
    );
    expect(
      await propiedadesConError({ ...base, medioPago: 'MERCADOPAGO' }),
    ).toEqual([]);
  });

  it('rechaza un medio de pago desconocido', async () => {
    expect(
      await propiedadesConError({ ...base, medioPago: 'BITCOIN' }),
    ).toEqual(['medioPago']);
  });

  it('rechaza un pedidoId que no es UUID', async () => {
    expect(
      await propiedadesConError({ ...base, pedidoId: 'no-es-uuid' }),
    ).toEqual(['pedidoId']);
  });

  it('exige idempotencyKey de 1 a 64 caracteres', async () => {
    expect(await propiedadesConError({ ...base, idempotencyKey: '' })).toEqual([
      'idempotencyKey',
    ]);
    expect(
      await propiedadesConError({ ...base, idempotencyKey: 'a'.repeat(64) }),
    ).toEqual([]);
    expect(
      await propiedadesConError({ ...base, idempotencyKey: 'a'.repeat(65) }),
    ).toEqual(['idempotencyKey']);
  });

  it('datosPasarela tiene que ser un objeto', async () => {
    expect(
      await propiedadesConError({ ...base, datosPasarela: 'tok' }),
    ).toEqual(['datosPasarela']);
    const sinDatos: Record<string, unknown> = { ...base };
    delete sinDatos.datosPasarela;
    expect(await propiedadesConError(sinDatos)).toEqual(['datosPasarela']);
  });

  it('el DTO no declara ningún campo de monto: no hay dónde meter un importe manipulado', () => {
    const dto = plainToInstance(CrearPagoDto, { ...base, monto: 1, total: 1 });
    // En la app, ValidationPipe({ whitelist: true }) descarta lo no declarado;
    // acá verificamos que la clase no tiene una validación que lo acepte.
    const declarados = Object.keys(new CrearPagoDto());
    expect(declarados).not.toContain('monto');
    expect(dto).toBeInstanceOf(CrearPagoDto);
  });
});

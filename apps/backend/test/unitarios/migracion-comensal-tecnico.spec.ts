import {
  planDeMigracion,
  tenantDeNombreAnterior,
} from '../../src/auth-comensal/migracion-comensal-tecnico';
import { nombreComensalTecnico } from '../../src/auth-comensal/nombre-comensal-tecnico';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const SECRETO = 'secreto-de-prueba-del-nombre-del-comensal';

describe('migración del usuario técnico del comensal (BL-271, parte 3)', () => {
  it('[TC-U-566] reconoce el nombre anterior y saca el tenant; los demás no', () => {
    expect(tenantDeNombreAnterior(`comensal-${TENANT_A}`)).toBe(TENANT_A);
    // El nombre nuevo, un usuario del personal y nombres que solo se parecen.
    expect(
      tenantDeNombreAnterior(nombreComensalTecnico(TENANT_A, SECRETO)),
    ).toBeNull();
    expect(tenantDeNombreAnterior('admin-test')).toBeNull();
    expect(tenantDeNombreAnterior('comensal-testing')).toBeNull();
    expect(tenantDeNombreAnterior(`comensal-${TENANT_A}-x`)).toBeNull();
  });

  it('[TC-U-567] un paso por cada usuario con el nombre anterior, con el nombre nuevo calculado con el secreto', () => {
    const pasos = planDeMigracion(
      [
        {
          id: 'kc-b',
          username: `comensal-${TENANT_B}`,
          attributes: { tenant_id: [TENANT_B] },
        },
        {
          id: 'kc-a',
          username: `comensal-${TENANT_A}`,
          attributes: { tenant_id: [TENANT_A] },
        },
        { id: 'kc-admin', username: 'admin-test' },
      ],
      SECRETO,
    );
    expect(pasos).toEqual([
      {
        tenantId: TENANT_A,
        anterior: { id: 'kc-a', username: `comensal-${TENANT_A}` },
        nuevo: nombreComensalTecnico(TENANT_A, SECRETO),
        nuevoId: undefined,
        inconsistente: false,
      },
      {
        tenantId: TENANT_B,
        anterior: { id: 'kc-b', username: `comensal-${TENANT_B}` },
        nuevo: nombreComensalTecnico(TENANT_B, SECRETO),
        nuevoId: undefined,
        inconsistente: false,
      },
    ]);
  });

  it('[TC-U-568] si el usuario nuevo ya existe, el paso lo indica (correr dos veces no lo duplica)', () => {
    const nuevo = nombreComensalTecnico(TENANT_A, SECRETO);
    const [paso] = planDeMigracion(
      [
        { id: 'kc-a', username: `comensal-${TENANT_A}` },
        { id: 'kc-a-nuevo', username: nuevo },
      ],
      SECRETO,
    );
    expect(paso.nuevo).toBe(nuevo);
    expect(paso.nuevoId).toBe('kc-a-nuevo');
  });

  it('[TC-U-569] marca como inconsistente un tenant_id distinto del nombre, y sin secreto no arma el plan', () => {
    const [paso] = planDeMigracion(
      [
        {
          id: 'kc-a',
          username: `comensal-${TENANT_A}`,
          attributes: { tenant_id: [TENANT_B] },
        },
      ],
      SECRETO,
    );
    expect(paso.inconsistente).toBe(true);
    expect(() => planDeMigracion([], '')).toThrow('Falta el secreto');
  });
});

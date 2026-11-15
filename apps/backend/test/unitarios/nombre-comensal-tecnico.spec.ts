import {
  emailComensalTecnico,
  nombreComensalTecnico,
} from '../../src/auth-comensal/nombre-comensal-tecnico';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const SECRETO = 'secreto-de-prueba-del-nombre-del-comensal';

describe('nombre del usuario técnico del comensal (BL-271)', () => {
  it('[TC-U-553] sin secreto usa el nombre anterior, comensal-<tenantId>', () => {
    expect(nombreComensalTecnico(TENANT_A, undefined)).toBe(
      `comensal-${TENANT_A}`,
    );
    expect(nombreComensalTecnico(TENANT_A, '')).toBe(`comensal-${TENANT_A}`);
  });

  it('[TC-U-554] con secreto: comensal- y 24 caracteres hexadecimales, sin el tenantId y siempre el mismo', () => {
    const nombre = nombreComensalTecnico(TENANT_A, SECRETO);
    expect(nombre).toMatch(/^comensal-[0-9a-f]{24}$/);
    expect(nombre).not.toContain(TENANT_A);
    expect(nombre).not.toContain(TENANT_A.slice(0, 8));
    expect(nombreComensalTecnico(TENANT_A, SECRETO)).toBe(nombre);
  });

  it('[TC-U-555] cambia con el tenant y con el secreto', () => {
    const nombreA = nombreComensalTecnico(TENANT_A, SECRETO);
    expect(nombreComensalTecnico(TENANT_B, SECRETO)).not.toBe(nombreA);
    expect(nombreComensalTecnico(TENANT_A, `${SECRETO}-otro`)).not.toBe(
      nombreA,
    );
  });

  it('[TC-U-556] el correo usa el mismo nombre y el dominio técnico, también con la variable de entorno', () => {
    expect(emailComensalTecnico(TENANT_A, SECRETO)).toBe(
      `${nombreComensalTecnico(TENANT_A, SECRETO)}@tecnico.bistrolink.local`,
    );

    const anterior = process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET;
    process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET = SECRETO;
    try {
      expect(nombreComensalTecnico(TENANT_A)).toBe(
        nombreComensalTecnico(TENANT_A, SECRETO),
      );
      expect(emailComensalTecnico(TENANT_A)).toBe(
        emailComensalTecnico(TENANT_A, SECRETO),
      );
    } finally {
      if (anterior === undefined) {
        delete process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET;
      } else {
        process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET = anterior;
      }
    }
  });
});

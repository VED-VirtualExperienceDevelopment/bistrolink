import { QrMesaTokenService } from '../../src/qr-mesa/qr-mesa-token.service';

// Claves de prueba: 32 bytes fijos en base64, solo para los tests.
const CLAVE_A = Buffer.alloc(32, 7).toString('base64');
const CLAVE_B = Buffer.alloc(32, 9).toString('base64');

const DATOS = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  mesaId: '0b4f6a3e-1111-4c2d-9e8f-123456789abc',
  version: 1,
};

// El servicio cachea las subclaves: cada test usa una instancia nueva para
// tomar el valor de QR_TOKEN_KEY de ese test.
function servicioCon(clave: string | undefined): QrMesaTokenService {
  if (clave === undefined) {
    delete process.env.QR_TOKEN_KEY;
  } else {
    process.env.QR_TOKEN_KEY = clave;
  }
  return new QrMesaTokenService();
}

/** Cambia el carácter en la posición indicada por otro válido de base64url. */
function alterar(token: string, posicion: number): string {
  const actual = token[posicion];
  const reemplazo = actual === 'A' ? 'B' : 'A';
  return token.slice(0, posicion) + reemplazo + token.slice(posicion + 1);
}

describe('QrMesaTokenService (BL-204)', () => {
  const claveOriginal = process.env.QR_TOKEN_KEY;

  afterAll(() => {
    if (claveOriginal === undefined) {
      delete process.env.QR_TOKEN_KEY;
    } else {
      process.env.QR_TOKEN_KEY = claveOriginal;
    }
  });

  describe('cifrar y descifrar', () => {
    it('recupera exactamente los mismos datos', () => {
      const servicio = servicioCon(CLAVE_A);

      const token = servicio.cifrar(DATOS);

      expect(servicio.descifrar(token)).toEqual(DATOS);
    });

    it('genera un token de 87 caracteres en base64url', () => {
      const token = servicioCon(CLAVE_A).cifrar(DATOS);

      expect(token).toHaveLength(87);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('no expone los ids internos en el token', () => {
      const token = servicioCon(CLAVE_A).cifrar(DATOS);
      const bytes = Buffer.from(token, 'base64url').toString('hex');

      for (const id of [DATOS.tenantId, DATOS.mesaId]) {
        const hex = id.replace(/-/g, '');
        expect(token).not.toContain(id);
        expect(token.toLowerCase()).not.toContain(hex);
        expect(bytes).not.toContain(hex);
      }
    });

    it('es determinístico: misma mesa y versión dan el mismo token', () => {
      const servicio = servicioCon(CLAVE_A);

      expect(servicio.cifrar(DATOS)).toBe(servicio.cifrar(DATOS));
    });

    it('regenerar (versión + 1) produce un token distinto', () => {
      const servicio = servicioCon(CLAVE_A);

      const v1 = servicio.cifrar(DATOS);
      const v2 = servicio.cifrar({ ...DATOS, version: 2 });

      expect(v2).not.toBe(v1);
      expect(servicio.descifrar(v2)?.version).toBe(2);
    });

    it('dos mesas distintas tienen tokens distintos', () => {
      const servicio = servicioCon(CLAVE_A);
      const otraMesa = {
        ...DATOS,
        mesaId: '0b4f6a3e-2222-4c2d-9e8f-123456789abc',
      };

      expect(servicio.cifrar(otraMesa)).not.toBe(servicio.cifrar(DATOS));
    });
  });

  describe('rechazo de tokens inválidos (devuelve null)', () => {
    it.each([0, 1, 20, 50, 80])(
      'un carácter alterado en la posición %p',
      (posicion) => {
        const servicio = servicioCon(CLAVE_A);
        const token = servicio.cifrar(DATOS);

        expect(servicio.descifrar(alterar(token, posicion))).toBeNull();
      },
    );

    it('un token cifrado con otra clave', () => {
      const tokenDeOtraClave = servicioCon(CLAVE_B).cifrar(DATOS);

      expect(servicioCon(CLAVE_A).descifrar(tokenDeOtraClave)).toBeNull();
    });

    it.each([
      ['vacío', ''],
      ['texto cualquiera', 'hola'],
      ['caracteres fuera de base64url', 'abc+/=='],
      ['un UUID', DATOS.mesaId],
      ['demasiado largo', 'A'.repeat(500)],
    ])('%s', (_caso, token) => {
      expect(servicioCon(CLAVE_A).descifrar(token)).toBeNull();
    });

    it('un token recortado', () => {
      const servicio = servicioCon(CLAVE_A);
      const token = servicio.cifrar(DATOS);

      expect(servicio.descifrar(token.slice(0, -4))).toBeNull();
    });
  });

  describe('validación de entradas al cifrar', () => {
    it.each([0, -1, 1.5, 2 ** 32])('rechaza la versión %p', (version) => {
      expect(() => servicioCon(CLAVE_A).cifrar({ ...DATOS, version })).toThrow(
        'La versión del QR debe ser un entero positivo',
      );
    });

    it('rechaza ids que no son UUID', () => {
      expect(() =>
        servicioCon(CLAVE_A).cifrar({ ...DATOS, mesaId: 'mesa-1' }),
      ).toThrow('formato UUID');
    });
  });

  describe('configuración de la clave', () => {
    it('falla con un error claro si falta QR_TOKEN_KEY', () => {
      expect(() => servicioCon(undefined).cifrar(DATOS)).toThrow(
        'Falta QR_TOKEN_KEY en el entorno',
      );
    });

    it('al descifrar, la falta de clave no se confunde con un token inválido', () => {
      const token = servicioCon(CLAVE_A).cifrar(DATOS);

      expect(() => servicioCon(undefined).descifrar(token)).toThrow(
        'Falta QR_TOKEN_KEY en el entorno',
      );
    });

    it('rechaza una clave que no tiene 32 bytes', () => {
      const claveCorta = Buffer.alloc(16, 1).toString('base64');

      expect(() => servicioCon(claveCorta).cifrar(DATOS)).toThrow(
        'QR_TOKEN_KEY debe ser una clave de 32 bytes en base64',
      );
    });
  });
});

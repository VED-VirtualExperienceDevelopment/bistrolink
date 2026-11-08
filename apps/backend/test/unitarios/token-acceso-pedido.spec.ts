import {
  generarTokenAcceso,
  hashTokenAcceso,
  tokenAccesoCoincide,
} from '../../src/pedidos/token-acceso-pedido';

describe('token de acceso del pedido para retirar (BL-311, RD.05)', () => {
  it('genera un token de 256 bits en base64url y su SHA-256', () => {
    const { token, hash } = generarTokenAcceso();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashTokenAcceso(token));
  });

  it('cada token es distinto', () => {
    expect(generarTokenAcceso().token).not.toBe(generarTokenAcceso().token);
  });

  it('coincide solo con su propio hash', () => {
    const a = generarTokenAcceso();
    const b = generarTokenAcceso();
    expect(tokenAccesoCoincide(a.token, a.hash)).toBe(true);
    expect(tokenAccesoCoincide(a.token, b.hash)).toBe(false);
  });

  it('sin hash guardado (pedido de mesa o pedido viejo): nunca coincide', () => {
    expect(tokenAccesoCoincide(generarTokenAcceso().token, null)).toBe(false);
  });

  it('un hash guardado malformado no rompe: no coincide', () => {
    expect(tokenAccesoCoincide('x', 'no-es-hex')).toBe(false);
  });
});

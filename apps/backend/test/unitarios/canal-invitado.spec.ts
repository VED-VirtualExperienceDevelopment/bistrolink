import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import {
  exigirCanalParaPedidoNuevo,
  exigirCanalParaResumenDelLink,
  MENSAJE_LINK_NO_HACE_PEDIDOS,
  MENSAJE_RESUMEN_DE_OTRO_LINK,
  MENSAJE_RETIRO_DE_OTRO_RESTAURANTE,
} from '../../src/auth-comensal/canal-invitado';
import type { AuthenticatedUser } from '../../src/auth/keycloak-jwt.strategy';
import type { CanalInvitado } from '../../src/auth-comensal/token-invitado';
import {
  nuevoLinkPago,
  olvidarClaveLinkPago,
} from '../../src/link-pago/link-pago-token';

// HU-052 (BL-580): POST /pedidos y el resumen del link de pago, con el token
// de invitado fuera de su canal. Con el token de Keycloak (sin canal), nada
// cambia.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const OTRO_RESTAURANTE = 'a46faef3-7412-45ae-af80-3829cd27b990';
const PEDIDO_ID = '55555555-5555-4555-8555-555555555555';
const OTRO_PEDIDO = '66666666-6666-4666-8666-666666666666';

const usuario = (canal?: CanalInvitado): AuthenticatedUser => ({
  sub: 'comensal',
  tenantId: TENANT_ID,
  roles: ['COMENSAL'],
  canal,
});

describe('canal del token de invitado (HU-052, BL-580)', () => {
  const claveOriginal = process.env.QR_TOKEN_KEY;

  beforeAll(() => {
    process.env.QR_TOKEN_KEY = randomBytes(32).toString('base64');
    olvidarClaveLinkPago();
  });

  afterAll(() => {
    process.env.QR_TOKEN_KEY = claveOriginal;
    olvidarClaveLinkPago();
  });

  it('[TC-U-625] el token del link de pago no hace pedidos (403)', () => {
    expect(() =>
      exigirCanalParaPedidoNuevo(
        usuario({ tipo: 'link', pedidoId: PEDIDO_ID }),
        RESTAURANTE_ID,
      ),
    ).toThrow(MENSAJE_LINK_NO_HACE_PEDIDOS);
  });

  it('[TC-U-626] el token del retiro pide solo en su restaurante; el de la mesa y el de Keycloak, como antes', () => {
    const retiro = usuario({ tipo: 'retiro', restauranteId: RESTAURANTE_ID });
    expect(() => exigirCanalParaPedidoNuevo(retiro, OTRO_RESTAURANTE)).toThrow(
      MENSAJE_RETIRO_DE_OTRO_RESTAURANTE,
    );
    expect(() =>
      exigirCanalParaPedidoNuevo(retiro, RESTAURANTE_ID),
    ).not.toThrow();
    // Sin restauranteId en el body: el 400 lo da el servicio, como siempre.
    expect(() => exigirCanalParaPedidoNuevo(retiro, undefined)).not.toThrow();

    expect(() =>
      exigirCanalParaPedidoNuevo(
        usuario({ tipo: 'mesa', mesaId: 'm', sesionId: 's' }),
        undefined,
      ),
    ).not.toThrow();
    expect(() =>
      exigirCanalParaPedidoNuevo(usuario(), OTRO_RESTAURANTE),
    ).not.toThrow();
  });

  it('[TC-U-627] el resumen del link solo con el token de ese link; el de otro link, la mesa o el retiro → 403', () => {
    const { token } = nuevoLinkPago(TENANT_ID, PEDIDO_ID);

    expect(() =>
      exigirCanalParaResumenDelLink(
        usuario({ tipo: 'link', pedidoId: PEDIDO_ID }),
        token,
      ),
    ).not.toThrow();
    expect(() => exigirCanalParaResumenDelLink(usuario(), token)).not.toThrow();

    for (const canal of [
      { tipo: 'link', pedidoId: OTRO_PEDIDO },
      { tipo: 'mesa', mesaId: 'm', sesionId: 's' },
      { tipo: 'retiro', restauranteId: RESTAURANTE_ID },
    ] as CanalInvitado[]) {
      expect(() =>
        exigirCanalParaResumenDelLink(usuario(canal), token),
      ).toThrow(ForbiddenException);
    }
    // Un link ilegible tampoco es «el suyo».
    expect(() =>
      exigirCanalParaResumenDelLink(
        usuario({ tipo: 'link', pedidoId: PEDIDO_ID }),
        'no-es-un-link',
      ),
    ).toThrow(MENSAJE_RESUMEN_DE_OTRO_LINK);
  });
});

import { firmaWebhookMercadoPagoValida } from '../../src/pagos/webhooks/firma-webhook-mercadopago';

// Las firmas esperadas se calcularon FUERA de Node (Python hmac) con el
// manifiesto oficial, así el test no valida la implementación contra sí misma.
const SECRET = 'secreto-de-prueba';
const DATA_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3'; // así llega: en mayúsculas
const REQUEST_ID = '4ed4fa2b-0b31-42ec-a62f-ad793c486c59';
const TS = '1742505638683';

const FIRMA_COMPLETA =
  'a64fb8bd5bb2cdf324704fadfb1a1b7a55f55b0f4a13b9389dc0103d5eea6e84'; // id:ord01...;request-id:...;ts:...;
const FIRMA_SIN_REQUEST_ID =
  '93350e6fe2230669cf6f9e394d4a31447e9e3fd66b94ecb224d6e34cfb0916f4'; // id:ord01...;ts:...;
const FIRMA_SIN_DATA_ID =
  '16d62e56ac0eaf7b8de0ed3331612d0a41a48201c3b9a55bd176f83d96e99d55'; // request-id:...;ts:...;
const FIRMA_CON_ID_EN_MAYUSCULA =
  'e21a3886efef4482c4d709d2e43e4707851b686936fc60fd441d68b9f0af71a4'; // id:ORD01...;... (incorrecto)

const valida = {
  xSignature: `ts=${TS},v1=${FIRMA_COMPLETA}`,
  xRequestId: REQUEST_ID,
  dataId: DATA_ID,
  secret: SECRET,
};

describe('firmaWebhookMercadoPagoValida (BL-78: HMAC-SHA256)', () => {
  describe('firmas legítimas', () => {
    it('acepta una notificación con la firma correcta', () => {
      expect(firmaWebhookMercadoPagoValida(valida)).toBe(true);
    });

    it('el data.id llega en MAYÚSCULAS pero se firma en minúsculas', () => {
      expect(
        firmaWebhookMercadoPagoValida({ ...valida, dataId: DATA_ID }),
      ).toBe(true);
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          dataId: DATA_ID.toLowerCase(),
        }),
      ).toBe(true);
    });

    it('una firma calculada con el id en mayúsculas NO es válida (no es el formato oficial)', () => {
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: `ts=${TS},v1=${FIRMA_CON_ID_EN_MAYUSCULA}`,
        }),
      ).toBe(false);
    });

    it('no importa el orden ni los espacios del header x-signature', () => {
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: `v1=${FIRMA_COMPLETA},ts=${TS}`,
        }),
      ).toBe(true);
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: ` ts=${TS} , v1=${FIRMA_COMPLETA} `,
        }),
      ).toBe(true);
    });

    it('los pares ausentes se omiten del manifiesto: sin x-request-id', () => {
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xRequestId: undefined,
          xSignature: `ts=${TS},v1=${FIRMA_SIN_REQUEST_ID}`,
        }),
      ).toBe(true);
    });

    it('los pares ausentes se omiten del manifiesto: sin data.id', () => {
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          dataId: undefined,
          xSignature: `ts=${TS},v1=${FIRMA_SIN_DATA_ID}`,
        }),
      ).toBe(true);
    });
  });

  describe('notificaciones falsificadas o alteradas', () => {
    it('firma alterada (un carácter distinto)', () => {
      const alterada =
        FIRMA_COMPLETA.slice(0, -1) +
        (FIRMA_COMPLETA.endsWith('4') ? '5' : '4');
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: `ts=${TS},v1=${alterada}`,
        }),
      ).toBe(false);
    });

    it.each([
      ['otro data.id (otra order)', { dataId: 'ORD01OTRAORDEN' }],
      [
        'otro x-request-id',
        { xRequestId: '00000000-0000-0000-0000-000000000000' },
      ],
      [
        'otro timestamp',
        { xSignature: `ts=1742505638684,v1=${FIRMA_COMPLETA}` },
      ],
      ['otro secret', { secret: 'otro-secreto' }],
    ])('%s', (_caso, cambio) => {
      expect(firmaWebhookMercadoPagoValida({ ...valida, ...cambio })).toBe(
        false,
      );
    });

    it('firma de otra longitud (truncada o con basura) => inválida, sin lanzar', () => {
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: `ts=${TS},v1=${FIRMA_COMPLETA.slice(0, 20)}`,
        }),
      ).toBe(false);
      expect(
        firmaWebhookMercadoPagoValida({
          ...valida,
          xSignature: `ts=${TS},v1=${FIRMA_COMPLETA}00`,
        }),
      ).toBe(false);
    });
  });

  describe('falla cerrado (datos faltantes o mal formados)', () => {
    it('sin secret configurado NUNCA se acepta una notificación', () => {
      expect(
        firmaWebhookMercadoPagoValida({ ...valida, secret: undefined }),
      ).toBe(false);
      expect(firmaWebhookMercadoPagoValida({ ...valida, secret: '' })).toBe(
        false,
      );
    });

    it.each([
      ['sin header x-signature', { xSignature: undefined }],
      ['header vacío', { xSignature: '' }],
      ['sin v1', { xSignature: `ts=${TS}` }],
      ['sin ts', { xSignature: `v1=${FIRMA_COMPLETA}` }],
      ['header sin formato', { xSignature: 'basura' }],
    ])('%s', (_caso, cambio) => {
      expect(firmaWebhookMercadoPagoValida({ ...valida, ...cambio })).toBe(
        false,
      );
    });

    it('sin ningún dato no lanza: devuelve false', () => {
      expect(firmaWebhookMercadoPagoValida({})).toBe(false);
    });
  });
});

import {
  NUMERO_WHATSAPP,
  normalizarNumeroWhatsapp,
  numeroParaWaMe,
} from '../../src/whatsapp/numero-whatsapp';
import { botConectadoParaTenant } from '../../src/whatsapp/configuracion-whatsapp';

// HU-010 (BL-613): número del bot de WhatsApp del local.

const TENANT = '11111111-1111-1111-1111-111111111111';
const ENV_COMPLETO = {
  EVOLUTION_API_URL: 'http://evolution.test',
  EVOLUTION_API_KEY: 'clave-de-prueba',
  EVOLUTION_INSTANCIAS: `local=${TENANT}`,
  WHATSAPP_WEBHOOK_SECRETO: 's'.repeat(32),
  WHATSAPP_TELEFONO_CLAVE: 't'.repeat(32),
};

describe('número del bot de WhatsApp (BL-613)', () => {
  it('[TC-U-689] lo pasa a formato internacional como lo escriba el administrador, y a wa.me sin el +', () => {
    expect(normalizarNumeroWhatsapp('099 123 456')).toBe('+59899123456');
    expect(normalizarNumeroWhatsapp('(099) 123-456')).toBe('+59899123456');
    expect(normalizarNumeroWhatsapp('99.123.456')).toBe('+59899123456');
    expect(normalizarNumeroWhatsapp('59899123456')).toBe('+59899123456');
    expect(normalizarNumeroWhatsapp('+34 612 345 678')).toBe('+34612345678');
    expect(normalizarNumeroWhatsapp('   ')).toBeNull();
    // Un fijo o algo sin prefijo queda como está y no pasa la validación.
    expect(normalizarNumeroWhatsapp('2900 1234')).toBe('2900 1234');
    expect(NUMERO_WHATSAPP.test('2900 1234')).toBe(false);
    expect(NUMERO_WHATSAPP.test('+59899123456')).toBe(true);
    expect(numeroParaWaMe('+59899123456')).toBe('59899123456');
  });

  it('[TC-U-689] el bot está conectado para el tenant solo con la configuración completa y una instancia suya', () => {
    expect(botConectadoParaTenant(ENV_COMPLETO, TENANT)).toBe(true);
    expect(botConectadoParaTenant(ENV_COMPLETO, TENANT.toUpperCase())).toBe(
      true,
    );
    expect(
      botConectadoParaTenant(
        ENV_COMPLETO,
        'b02579f2-2bb0-496b-abf2-33c494c93122',
      ),
    ).toBe(false);
    expect(
      botConectadoParaTenant(
        { ...ENV_COMPLETO, EVOLUTION_API_KEY: '' },
        TENANT,
      ),
    ).toBe(false);
    expect(botConectadoParaTenant({}, TENANT)).toBe(false);
  });
});

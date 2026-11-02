import { Writable } from 'node:stream';
import pino from 'pino';
import { CAMPOS_PERSONALES_EN_LOGS } from '../../src/logs-datos-personales';

// HU-036 (BL-206): los datos personales no quedan en texto plano en los
// logs (Ley 18.331). Se prueba con una instancia real de Pino configurada
// con la misma lista que usa LoggerModule (app.module.ts).

function logger() {
  const lineas: string[] = [];
  const destino = new Writable({
    write(chunk, _enc, listo) {
      lineas.push(chunk.toString());
      listo();
    },
  });
  const log = pino(
    { redact: { paths: CAMPOS_PERSONALES_EN_LOGS, censor: '[REDACTED]' } },
    destino,
  );
  return { log, salida: () => lineas.join('') };
}

describe('logs sin datos personales (HU-036, BL-206)', () => {
  it('reemplaza correo, RUT, razón social, teléfono y documento, en la raíz y un nivel abajo', () => {
    const { log, salida } = logger();

    log.info(
      {
        email: 'comensal@correo.com',
        rut: '219999990016',
        datosPasarela: {
          payerEmail: 'pagador@correo.com',
          identificationNumber: '12345672',
        },
        cliente: { razonSocial: 'Juan Pérez', telefono: '099123456' },
        pedidoId: 'pedido-1',
      },
      'pago creado',
    );

    const texto = salida();
    for (const dato of [
      'comensal@correo.com',
      '219999990016',
      'pagador@correo.com',
      '12345672',
      'Juan Pérez',
      '099123456',
    ]) {
      expect(texto).not.toContain(dato);
    }
    expect(texto).toContain('[REDACTED]');
    // Lo que no es personal se sigue viendo.
    expect(texto).toContain('pedido-1');
  });
});

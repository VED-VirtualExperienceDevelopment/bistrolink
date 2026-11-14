import { Writable } from 'node:stream';
import pino from 'pino';
import {
  CABECERAS_CON_IP_EN_LOGS,
  CAMPOS_PERSONALES_EN_LOGS,
} from '../../src/logs-datos-personales';

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
    {
      redact: {
        paths: [...CAMPOS_PERSONALES_EN_LOGS, ...CABECERAS_CON_IP_EN_LOGS],
        censor: '[REDACTED]',
      },
    },
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

  it('HU-009 (BL-453): reemplaza el receptor de la e-Factura (pedido y cliente de Surtec)', () => {
    const { log, salida } = logger();

    log.info(
      {
        pedido: {
          receptorRut: '211234560012',
          receptorRazonSocial: 'Comensal Ejemplo SAS',
        },
        cliente: { nro_doc: '219999830019', denominacion: 'Otra Ejemplo SRL' },
        pagoId: 'pago-1',
      },
      'emisión de e-Factura',
    );

    const texto = salida();
    for (const dato of [
      '211234560012',
      'Comensal Ejemplo SAS',
      '219999830019',
      'Otra Ejemplo SRL',
    ]) {
      expect(texto).not.toContain(dato);
    }
    expect(texto).toContain('pago-1');
  });

  it('HU-040 (BL-210): reemplaza el nombre y el contacto del pedido para retirar', () => {
    const { log, salida } = logger();

    log.info(
      {
        pedido: { retiroNombre: 'Ana Ejemplo', retiroContacto: '099765432' },
        body: {
          contactoRetiro: { nombre: 'Otra Ejemplo', contacto: 'otra@ej.uy' },
        },
        pedidoId: 'pedido-2',
      },
      'pedido para retirar',
    );

    const texto = salida();
    for (const dato of [
      'Ana Ejemplo',
      '099765432',
      'Otra Ejemplo',
      'otra@ej.uy',
    ]) {
      expect(texto).not.toContain(dato);
    }
    expect(texto).toContain('pedido-2');
  });

  it('[TC-U-466] BL-214: reemplaza la IP del usuario en las cabeceras del request', () => {
    const { log, salida } = logger();

    log.info(
      {
        req: {
          method: 'GET',
          url: '/menu',
          headers: {
            host: 'bistrolink-api-staging.up.railway.app',
            'x-forwarded-for': '203.0.113.7, 198.51.100.20',
            'x-real-ip': '203.0.113.7',
          },
        },
      },
      'request completed',
    );

    const texto = salida();
    expect(texto).not.toContain('203.0.113.7');
    expect(texto).not.toContain('198.51.100.20');
    expect(texto).toContain('[REDACTED]');
    // El resto del request se sigue viendo.
    expect(texto).toContain('bistrolink-api-staging.up.railway.app');
    expect(texto).toContain('/menu');
  });
});

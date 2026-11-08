import {
  AlertasPendientes,
  VIGENCIA_ALERTA_MS,
  type LlamadoPendiente,
} from '../../src/pedidos/alertas-pendientes';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTRO_TENANT = 'b02579f2-2bb0-496b-abf2-33c494c93122';

function atencion(mesaId: string, mesaNumero: number, ts: number) {
  return { mesaId, mesaNumero, ts } satisfies LlamadoPendiente;
}

function efectivo(
  mesaId: string,
  mesaNumero: number,
  ts: number,
  pedidoId: string,
) {
  return {
    mesaId,
    mesaNumero,
    ts,
    motivo: 'PAGO_EFECTIVO' as const,
    pedidoId,
    total: '590.00',
    pagaCon: '1000.00',
  } satisfies LlamadoPendiente;
}

describe('AlertasPendientes (BL-441)', () => {
  let ahora: number;
  let alertas: AlertasPendientes;

  beforeEach(() => {
    ahora = 1_000_000_000;
    alertas = new AlertasPendientes(() => ahora);
  });

  describe('agregar y snapshot', () => {
    it('sin alertas, el snapshot está vacío', () => {
      expect(alertas.snapshot(TENANT, [])).toEqual([]);
    });

    it('un llamado agregado aparece en el snapshot (sobrevive a un refresco)', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));

      expect(alertas.snapshot(TENANT, [])).toEqual([atencion('m1', 1, ahora)]);
    });

    it('una alerta por mesa: el segundo llamado conserva la hora del primero', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora - 5000));
      alertas.agregar(TENANT, atencion('m1', 1, ahora - 1000));

      expect(alertas.snapshot(TENANT, [])).toEqual([
        atencion('m1', 1, ahora - 5000),
      ]);
    });

    it('la más antigua va primero', () => {
      alertas.agregar(TENANT, atencion('m2', 2, ahora - 10));
      alertas.agregar(TENANT, atencion('m1', 1, ahora - 500));

      expect(alertas.snapshot(TENANT, []).map((a) => a.mesaNumero)).toEqual([
        1, 2,
      ]);
    });

    it('cada establecimiento ve solo las suyas', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));
      alertas.agregar(OTRO_TENANT, atencion('m9', 9, ahora));

      expect(alertas.snapshot(TENANT, []).map((a) => a.mesaId)).toEqual(['m1']);
      expect(alertas.snapshot(OTRO_TENANT, []).map((a) => a.mesaId)).toEqual([
        'm9',
      ]);
    });
  });

  describe('resolver', () => {
    it('al aceptar o desestimar, la alerta sale del snapshot', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));

      const quitada = alertas.resolver(TENANT, 'm1');

      expect(quitada).toEqual(atencion('m1', 1, ahora));
      expect(alertas.snapshot(TENANT, [])).toEqual([]);
    });

    it('resolver una mesa sin alerta no falla y devuelve undefined', () => {
      expect(alertas.resolver(TENANT, 'm1')).toBeUndefined();
    });

    it('resolver dos veces la misma alerta es inofensivo (dos mozos a la vez)', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));

      expect(alertas.resolver(TENANT, 'm1')).toBeDefined();
      expect(alertas.resolver(TENANT, 'm1')).toBeUndefined();
      expect(alertas.snapshot(TENANT, [])).toEqual([]);
    });

    it('no afecta a las alertas de otro establecimiento', () => {
      alertas.agregar(OTRO_TENANT, atencion('m1', 1, ahora));

      alertas.resolver(TENANT, 'm1');

      expect(alertas.snapshot(OTRO_TENANT, [])).toHaveLength(1);
    });
  });

  describe('efectivo (viene de la base)', () => {
    it('un aviso de efectivo de la base aparece en el snapshot', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');

      expect(alertas.snapshot(TENANT, [aviso])).toEqual([aviso]);
    });

    it('un aviso ya atendido no vuelve a aparecer al refrescar', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');

      alertas.resolver(TENANT, 'm1', 'p1');

      expect(alertas.snapshot(TENANT, [aviso])).toEqual([]);
    });

    it('si la alerta guardada ya traía el pedido, no hace falta pasárselo a resolver', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');
      alertas.agregar(TENANT, aviso);

      alertas.resolver(TENANT, 'm1');

      expect(alertas.snapshot(TENANT, [aviso])).toEqual([]);
    });

    it('un aviso de efectivo nuevo del mismo pedido vuelve a ser pendiente', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');
      alertas.resolver(TENANT, 'm1', 'p1');

      alertas.agregar(TENANT, efectivo('m1', 1, ahora + 10, 'p1'));

      expect(alertas.snapshot(TENANT, [aviso])).toHaveLength(1);
    });

    it('si la mesa tiene un llamado guardado y un aviso de efectivo, queda el de efectivo con la hora más antigua', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora - 5000));
      const aviso = efectivo('m1', 1, ahora, 'p1');

      expect(alertas.snapshot(TENANT, [aviso])).toEqual([
        { ...aviso, ts: ahora - 5000 },
      ]);
    });

    it('al cobrarse el pedido, desaparece la alerta y su marca', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');
      alertas.agregar(TENANT, aviso);

      alertas.pedidoCobrado(TENANT, 'p1');

      expect(alertas.snapshot(TENANT, [])).toEqual([]);
    });
  });

  describe('cerrarMesa', () => {
    it('saca la alerta de la mesa y su marca de atendido', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));
      alertas.resolver(TENANT, 'm2', 'p2');
      alertas.agregar(TENANT, atencion('m2', 2, ahora));

      alertas.cerrarMesa(TENANT, 'm1');
      alertas.cerrarMesa(TENANT, 'm2');

      expect(alertas.snapshot(TENANT, [])).toEqual([]);
      // La marca de p2 se fue con la mesa: un aviso de p2 vuelve a contar.
      expect(
        alertas.snapshot(TENANT, [efectivo('m2', 2, ahora, 'p2')]),
      ).toHaveLength(1);
    });

    it('no toca a las otras mesas', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));
      alertas.agregar(TENANT, atencion('m2', 2, ahora));

      alertas.cerrarMesa(TENANT, 'm1');

      expect(alertas.snapshot(TENANT, []).map((a) => a.mesaId)).toEqual(['m2']);
    });
  });

  describe('vigencia', () => {
    it('una alerta de más de 12 horas deja de mostrarse', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));

      ahora += VIGENCIA_ALERTA_MS + 1;

      expect(alertas.snapshot(TENANT, [])).toEqual([]);
    });

    it('una alerta justo en el límite todavía se muestra', () => {
      alertas.agregar(TENANT, atencion('m1', 1, ahora));

      ahora += VIGENCIA_ALERTA_MS;

      expect(alertas.snapshot(TENANT, [])).toHaveLength(1);
    });

    it('la marca de atendido también vence', () => {
      const aviso = efectivo('m1', 1, ahora, 'p1');
      alertas.resolver(TENANT, 'm1', 'p1');

      ahora += VIGENCIA_ALERTA_MS + 1;

      // El aviso de la base es de hace más de 12 h: vuelve a mostrarse (la
      // base es la fuente de verdad de lo que sigue sin cobrar).
      expect(alertas.snapshot(TENANT, [aviso])).toHaveLength(1);
    });
  });
});

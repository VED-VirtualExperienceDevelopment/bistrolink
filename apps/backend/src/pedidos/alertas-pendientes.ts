/**
 * BL-441: alertas que esperan al mozo (llamados de mesa y avisos de pago en
 * efectivo), guardadas en el servidor por establecimiento.
 *
 * Por qué existe: el llamado de una mesa solo se emitía por WebSocket. Quien
 * estaba conectado lo recibía y lo tenía en la memoria del navegador, así que
 * un refresco de la página, un corte de conexión o una pestaña cerrada lo
 * perdían, y el servidor no tenía qué reenviar. Con este almacén, el snapshot
 * que se manda al conectar incluye todas las alertas pendientes.
 *
 * Una alerta por mesa: si la mesa vuelve a llamar, queda el último llamado
 * pero con la hora del primero (conserva su lugar en la lista).
 *
 * Los avisos de efectivo ya se reconstruyen desde la base (pedidos con el
 * efectivo solicitado y sin pagar). Eso crea el problema contrario: un aviso
 * que el mozo ya aceptó volvería a aparecer al refrescar. Por eso se anota
 * qué pedidos de efectivo ya se atendieron y se los excluye del snapshot hasta
 * que el pedido se cobra o la mesa se cierra.
 *
 * Vive en la memoria del proceso: un reinicio del servidor las pierde y con
 * más de una instancia cada una tendría las suyas. El registro persistente
 * (con métricas) es BL-456. No guarda datos de personas: ni quién llamó ni
 * quién atendió.
 *
 * Sin dependencias de Nest ni de la base: se prueba sola.
 */

/** Mismo contenido que el evento `llamado:nuevo` y que `llamados:snapshot`. */
export interface LlamadoPendiente {
  mesaId: string;
  mesaNumero: number;
  /** Hora del primer llamado de la mesa, en milisegundos. */
  ts: number;
  motivo?: 'PAGO_EFECTIVO';
  pedidoId?: string;
  total?: string;
  pagaCon?: string | null;
}

/**
 * Una alerta que nadie atiende en este tiempo deja de mostrarse: el mozo ya no
 * puede estar esperando. Evita que una alerta olvidada quede para siempre.
 */
export const VIGENCIA_ALERTA_MS = 12 * 60 * 60 * 1000;

interface AtendidoEfectivo {
  mesaId: string;
  desde: number;
}

export class AlertasPendientes {
  private readonly pendientes = new Map<
    string,
    Map<string, LlamadoPendiente>
  >();
  // tenantId → pedidoId de efectivo ya atendido.
  private readonly atendidos = new Map<string, Map<string, AtendidoEfectivo>>();

  constructor(private readonly ahora: () => number = Date.now) {}

  /**
   * Agrega o actualiza la alerta de la mesa. Conserva la hora del primer
   * llamado. Un aviso de efectivo nuevo vuelve a ser pendiente aunque el
   * anterior ya se hubiera atendido.
   */
  agregar(tenantId: string, llamado: LlamadoPendiente): void {
    const delTenant = this.pendientesDe(tenantId);
    const anterior = delTenant.get(llamado.mesaId);
    delTenant.set(llamado.mesaId, {
      ...llamado,
      ts: anterior ? Math.min(anterior.ts, llamado.ts) : llamado.ts,
    });
    if (llamado.pedidoId) {
      this.atendidos.get(tenantId)?.delete(llamado.pedidoId);
    }
  }

  /**
   * El mozo aceptó o desestimó la alerta de la mesa: ya no está pendiente.
   * `pedidoEfectivoId` es el pedido de efectivo de la mesa, si lo tiene (viene
   * de la alerta guardada o de la base): se anota como atendido para que el
   * snapshot no lo vuelva a mostrar. Devuelve la alerta que se sacó, si estaba.
   */
  resolver(
    tenantId: string,
    mesaId: string,
    pedidoEfectivoId?: string,
  ): LlamadoPendiente | undefined {
    const delTenant = this.pendientes.get(tenantId);
    const quitada = delTenant?.get(mesaId);
    delTenant?.delete(mesaId);

    const pedidoId = quitada?.pedidoId ?? pedidoEfectivoId;
    if (pedidoId) {
      this.atendidosDe(tenantId).set(pedidoId, {
        mesaId,
        desde: this.ahora(),
      });
    }
    return quitada;
  }

  /** La mesa se cerró: no queda nada que atender en ella. */
  cerrarMesa(tenantId: string, mesaId: string): void {
    this.pendientes.get(tenantId)?.delete(mesaId);
    const atendidos = this.atendidos.get(tenantId);
    if (!atendidos) return;
    for (const [pedidoId, dato] of atendidos) {
      if (dato.mesaId === mesaId) atendidos.delete(pedidoId);
    }
  }

  /** El pedido se cobró: su aviso de efectivo y su marca de atendido sobran. */
  pedidoCobrado(tenantId: string, pedidoId: string): void {
    this.atendidos.get(tenantId)?.delete(pedidoId);
    const delTenant = this.pendientes.get(tenantId);
    if (!delTenant) return;
    for (const [mesaId, alerta] of delTenant) {
      if (alerta.pedidoId === pedidoId) delTenant.delete(mesaId);
    }
  }

  /**
   * Lo que se manda al conectar: las alertas guardadas más los avisos de
   * efectivo de la base que no se atendieron, una por mesa y la más antigua
   * primero. Si una mesa está en los dos lados, queda el aviso de efectivo
   * (tiene el total) con la hora más antigua.
   */
  snapshot(
    tenantId: string,
    efectivoDeLaBase: LlamadoPendiente[],
  ): LlamadoPendiente[] {
    this.descartarVencidas(tenantId);

    const porMesa = new Map<string, LlamadoPendiente>(
      this.pendientes.get(tenantId) ?? [],
    );
    const atendidos = this.atendidos.get(tenantId);

    for (const aviso of efectivoDeLaBase) {
      if (aviso.pedidoId && atendidos?.has(aviso.pedidoId)) continue;
      const guardada = porMesa.get(aviso.mesaId);
      porMesa.set(aviso.mesaId, {
        ...aviso,
        ts: guardada ? Math.min(guardada.ts, aviso.ts) : aviso.ts,
      });
    }

    return [...porMesa.values()].sort((a, b) => a.ts - b.ts);
  }

  private descartarVencidas(tenantId: string): void {
    const limite = this.ahora() - VIGENCIA_ALERTA_MS;
    const delTenant = this.pendientes.get(tenantId);
    if (delTenant) {
      for (const [mesaId, alerta] of delTenant) {
        if (alerta.ts < limite) delTenant.delete(mesaId);
      }
    }
    const atendidos = this.atendidos.get(tenantId);
    if (atendidos) {
      for (const [pedidoId, dato] of atendidos) {
        if (dato.desde < limite) atendidos.delete(pedidoId);
      }
    }
  }

  private pendientesDe(tenantId: string): Map<string, LlamadoPendiente> {
    let delTenant = this.pendientes.get(tenantId);
    if (!delTenant) {
      delTenant = new Map();
      this.pendientes.set(tenantId, delTenant);
    }
    return delTenant;
  }

  private atendidosDe(tenantId: string): Map<string, AtendidoEfectivo> {
    let delTenant = this.atendidos.get(tenantId);
    if (!delTenant) {
      delTenant = new Map();
      this.atendidos.set(tenantId, delTenant);
    }
    return delTenant;
  }
}

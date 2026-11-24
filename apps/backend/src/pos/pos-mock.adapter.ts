import { randomUUID } from 'node:crypto';
import {
  ConsultaVentasPos,
  PosAdapter,
  PosNoDisponibleError,
  PosRechazoError,
  VentaDelPos,
  VentaPos,
  VentaRegistradaPos,
} from './pos.adapter';

/** Una venta guardada en el POS de prueba. */
export interface VentaEnMock {
  idPos: string;
  venta: VentaPos;
  anulada: boolean;
  /**
   * BL-489: establecimiento de una venta hecha en el POS. Null en las que
   * mandó BistroLink (VentaPos no trae el tenant): se listan en todos y la
   * importación las descarta por su referencia.
   */
  establecimiento: string | null;
  /** Alta o anulación, lo último. */
  actualizadaEn: Date;
}

/** BL-489: una venta hecha en el POS de prueba (para la demo y los tests). */
export interface VentaPropiaMock {
  total: number;
  medioPago: string;
  fecha?: Date;
}

/**
 * HU-011 (BL-488): POS de prueba en memoria (POS_ADAPTER=mock). No hay un
 * POS real ni un sandbox (spike BL-212): este adaptador cumple el mismo
 * contrato que el HTTP, para desarrollo, pruebas y la demo.
 *
 * - Idempotente por referencia, como se espera de un POS real.
 * - `disponible = false` simula el POS caído: todo falla con
 *   PosNoDisponibleError (POS_MOCK_DISPONIBLE=false, o desde un test).
 * - Las ventas viven en la memoria del proceso: se pierden al reiniciar la
 *   API, igual que un POS que se resetea.
 * - BL-489: `simularVentaPropia` crea una venta como si se hubiera hecho en
 *   el POS (sin referencia), para traerla al dashboard.
 */
export class PosMockAdapter implements PosAdapter {
  readonly nombre = 'mock';
  private readonly ventas = new Map<string, VentaEnMock>();

  constructor(public disponible = true) {}

  async registrarVenta(venta: VentaPos): Promise<VentaRegistradaPos> {
    this.comprobarDisponible();
    const existente = [...this.ventas.values()].find(
      (v) => v.venta.referencia === venta.referencia,
    );
    if (existente) return { idPos: existente.idPos };
    const idPos = `MOCK-${randomUUID()}`;
    this.ventas.set(idPos, {
      idPos,
      venta,
      anulada: false,
      establecimiento: null,
      actualizadaEn: new Date(),
    });
    return { idPos };
  }

  async anularVenta(idPos: string): Promise<void> {
    this.comprobarDisponible();
    const venta = this.ventas.get(idPos);
    if (!venta) throw new PosRechazoError('El POS no tiene esa venta', 404);
    if (venta.anulada) return;
    venta.anulada = true;
    venta.actualizadaEn = new Date();
  }

  async listarVentas({
    establecimiento,
    desde,
    limite,
  }: ConsultaVentasPos): Promise<VentaDelPos[]> {
    this.comprobarDisponible();
    return [...this.ventas.values()]
      .filter(
        (v) =>
          (v.establecimiento === null ||
            v.establecimiento === establecimiento) &&
          v.actualizadaEn.getTime() >= desde.getTime(),
      )
      .sort((a, b) => a.actualizadaEn.getTime() - b.actualizadaEn.getTime())
      .slice(0, limite)
      .map((v) => ({
        idPos: v.idPos,
        referencia: v.establecimiento === null ? v.venta.referencia : null,
        fecha: v.venta.fecha,
        total: v.venta.total,
        medioPago: v.venta.medioPago,
        anulada: v.anulada,
        actualizadaEn: v.actualizadaEn.toISOString(),
      }));
  }

  /**
   * BL-489: una venta hecha directamente en el POS de prueba (mostrador, por
   * ejemplo). No la mandó BistroLink: no tiene referencia.
   */
  simularVentaPropia(
    establecimiento: string,
    { total, medioPago, fecha = new Date() }: VentaPropiaMock,
  ): VentaEnMock {
    this.comprobarDisponible();
    const idPos = `MOCK-${randomUUID()}`;
    const venta: VentaEnMock = {
      idPos,
      venta: {
        referencia: idPos,
        fecha: fecha.toISOString(),
        moneda: 'UYU',
        total,
        medioPago,
        mesa: null,
        lineas: [],
      },
      anulada: false,
      establecimiento,
      actualizadaEn: new Date(),
    };
    this.ventas.set(idPos, venta);
    return venta;
  }

  /** Para los tests y el diagnóstico: lo que tiene el POS de prueba. */
  ventasRegistradas(): VentaEnMock[] {
    return [...this.ventas.values()];
  }

  private comprobarDisponible(): void {
    if (!this.disponible) {
      throw new PosNoDisponibleError('El POS de prueba está fuera de línea');
    }
  }
}

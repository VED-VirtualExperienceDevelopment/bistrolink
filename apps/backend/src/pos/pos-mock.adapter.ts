import { randomUUID } from 'node:crypto';
import {
  PosAdapter,
  PosNoDisponibleError,
  PosRechazoError,
  VentaPos,
  VentaRegistradaPos,
} from './pos.adapter';

/** Una venta guardada en el POS de prueba. */
export interface VentaEnMock {
  idPos: string;
  venta: VentaPos;
  anulada: boolean;
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
    this.ventas.set(idPos, { idPos, venta, anulada: false });
    return { idPos };
  }

  async anularVenta(idPos: string): Promise<void> {
    this.comprobarDisponible();
    const venta = this.ventas.get(idPos);
    if (!venta) throw new PosRechazoError('El POS no tiene esa venta', 404);
    venta.anulada = true;
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

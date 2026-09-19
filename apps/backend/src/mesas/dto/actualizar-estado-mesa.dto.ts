import { IsIn } from 'class-validator';
import { MesaEstado } from '@prisma/client';

const ESTADOS_MESA_VALIDOS: string[] = Object.values(MesaEstado);

/**
 * PROVISORIO (HU-016 → HU-017): este DTO respalda el endpoint mock
 * `PATCH /mesas/:id/estado`. El disparo real de estos cambios de estado
 * (mesa ocupada al crear un pedido, en proceso de pago al iniciar el cobro,
 * libre al cerrar la cuenta) lo va a implementar HU-017 llamando
 * directamente a `MesasService.actualizarEstado()` desde el flujo de
 * pedidos/pagos — no a través de este endpoint HTTP. Mientras esa historia
 * no esté lista, este endpoint permite ejercitar manualmente la emisión del
 * evento WebSocket `mesa:estado_actualizado` (demos, Postman, e2e).
 */
export class ActualizarEstadoMesaDto {
  @IsIn(ESTADOS_MESA_VALIDOS, {
    message: `estado debe ser una de: ${ESTADOS_MESA_VALIDOS.join(', ')}`,
  })
  estado: MesaEstado;
}

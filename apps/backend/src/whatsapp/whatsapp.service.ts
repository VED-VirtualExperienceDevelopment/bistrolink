import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { LinkPagoService } from '../link-pago/link-pago.service';
import { sinBarraFinal } from '../link-pago/link-pago';
import {
  FILTRO_CATEGORIAS_DEL_COMENSAL,
  ITEMS_DEL_COMENSAL,
} from '../menu/menu.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { mensajeRetiroNoDisponible, retiroAbierto } from '../pedidos/retiro';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantEstadoService } from '../tenant-estado/tenant-estado.service';
import {
  configuracionWhatsapp,
  hashTelefono,
  motivoDelError,
  type ConfiguracionWhatsapp,
} from './configuracion-whatsapp';
import {
  ESTADO_INICIAL,
  responder,
  textoPedidoCreado,
  textoPedidoRechazado,
  type CartaParaElBot,
  type EstadoConversacion,
  type LineaCarrito,
  type PasoConversacion,
} from './conversacion';
import { EvolutionClienteService } from './evolution-cliente.service';
import { telefonoParaLog, type MensajeEntrante } from './mensaje-evolution';

/** Minutos sin mensajes hasta que la conversación se olvida. */
export const MINUTOS_CONVERSACION = 30;

/** Quién genera el link de pago en la auditoría (no hay una persona). */
export const ACTOR_WHATSAPP = 'sistema:whatsapp';

export const MENSAJE_LOCAL_NO_DISPONIBLE =
  'Este local no está tomando pedidos por WhatsApp en este momento.';

const MENSAJE_ERROR_INESPERADO =
  'Tuvimos un problema para registrar el pedido. Probá de nuevo en un momento.';

interface DatosDelLocal {
  restauranteId: string;
  zonaHoraria: string;
  carta: CartaParaElBot;
}

/** Lo que pasó con el mensaje (para los tests y los logs). */
export type ResultadoMensaje =
  | 'apagado'
  | 'instancia-desconocida'
  | 'local-no-disponible'
  | 'repetido'
  | 'respondido'
  | 'pedido-creado'
  | 'pedido-rechazado';

/**
 * HU-010 (BL-112): procesa un mensaje que llegó por el webhook de Evolution.
 *
 * 1. La instancia dice de qué tenant es (EVOLUTION_INSTANCIAS).
 * 2. En el contexto del tenant (RLS): borra las conversaciones vencidas,
 *    lee la de este teléfono (por el hash) y descarta el mensaje si es el
 *    mismo que el último procesado (Evolution reintenta).
 * 3. La conversación (función pura) decide qué responder.
 * 4. Si el comensal confirmó, crea el pedido para retirar con el canal
 *    WHATSAPP (las mismas reglas que el retiro web: franja, stock, precios
 *    del servidor) y le manda el link de pago de HU-033.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenantEstado: TenantEstadoService,
    private readonly pedidos: PedidosService,
    private readonly linkPago: LinkPagoService,
    private readonly evolution: EvolutionClienteService,
  ) {}

  /** La configuración del entorno, o null si el bot está apagado. */
  configuracion(): ConfiguracionWhatsapp | null {
    return configuracionWhatsapp(process.env);
  }

  async procesar(
    mensaje: MensajeEntrante,
    ahora: Date = new Date(),
  ): Promise<ResultadoMensaje> {
    const config = this.configuracion();
    if (!config) return 'apagado';
    const tenantId = config.instancias.get(mensaje.instancia);
    if (!tenantId) {
      this.logger.warn(
        `Mensaje de WhatsApp de una instancia sin tenant configurado: ${mensaje.instancia}`,
      );
      return 'instancia-desconocida';
    }
    const enviar = (mensajes: string[]) =>
      this.evolution.enviar(
        config,
        mensaje.instancia,
        mensaje.telefono,
        mensajes,
      );

    if (await this.tenantEstado.estaSuspendido(tenantId)) {
      await enviar([MENSAJE_LOCAL_NO_DISPONIBLE]);
      return 'local-no-disponible';
    }

    const telefonoHash = hashTelefono(
      config.claveTelefono,
      tenantId,
      mensaje.telefono,
    );
    const turno = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await tx.conversacionWhatsapp.deleteMany({
          where: { venceEn: { lt: ahora } },
        });
        const guardada = await tx.conversacionWhatsapp.findUnique({
          where: { tenantId_telefonoHash: { tenantId, telefonoHash } },
        });
        if (guardada?.ultimoMensajeId === mensaje.mensajeId) return null;

        const local = await this.datosDelLocal(tx, tenantId, ahora);
        if (!local) return 'sin-local' as const;

        const estado = guardada ? estadoGuardado(guardada) : ESTADO_INICIAL;
        const resultado = responder(estado, mensaje.texto, local.carta);
        await this.guardar(
          tx,
          tenantId,
          telefonoHash,
          resultado.estado,
          mensaje.mensajeId,
          ahora,
        );
        return { local, ...resultado };
      },
    );

    if (turno === null) return 'repetido';
    if (turno === 'sin-local') {
      await enviar([MENSAJE_LOCAL_NO_DISPONIBLE]);
      return 'local-no-disponible';
    }
    await enviar(turno.mensajes);
    if (turno.accion?.tipo !== 'crear-pedido') return 'respondido';

    return this.crearPedido({
      tenantId,
      telefonoHash,
      mensaje,
      local: turno.local,
      estado: turno.estado,
      lineas: turno.accion.lineas,
      enviar,
      ahora,
    });
  }

  private async crearPedido(params: {
    tenantId: string;
    telefonoHash: string;
    mensaje: MensajeEntrante;
    local: DatosDelLocal;
    estado: EstadoConversacion;
    lineas: LineaCarrito[];
    enviar: (mensajes: string[]) => Promise<number>;
    ahora: Date;
  }): Promise<ResultadoMensaje> {
    const { tenantId, telefonoHash, mensaje, local, estado, enviar } = params;
    let texto: string;
    let creado = false;
    try {
      const pedido = await this.pedidos.crear(
        tenantId,
        {
          restauranteId: local.restauranteId,
          idempotencyKey: claveIdempotencia(tenantId, mensaje.mensajeId),
          items: params.lineas,
          // Aceptó el aviso de privacidad (HU-036): el número queda en el
          // pedido para avisarle cuando esté listo, como en el retiro web.
          contactoRetiro: {
            nombre: 'Pedido por WhatsApp',
            contacto: `+${mensaje.telefono}`,
            consentimiento: true,
          },
        },
        undefined,
        'WHATSAPP',
      );
      const link = await this.linkPago.generar({
        tenantId,
        keycloakId: ACTOR_WHATSAPP,
        pedidoId: pedido.id,
        // Si Evolution reintenta la confirmación, el pedido es el mismo y
        // el link nuevo reemplaza al anterior (es el mismo comensal).
        reemplazar: true,
        ahora: params.ahora,
      });
      texto = textoPedidoCreado(
        link.url,
        new Date(link.venceEn),
        local.zonaHoraria,
      );
      creado = true;
    } catch (error) {
      texto =
        error instanceof HttpException && error.getStatus() < 500
          ? textoPedidoRechazado(motivoParaElComensal(error))
          : MENSAJE_ERROR_INESPERADO;
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        this.logger.error(
          `No se pudo crear el pedido de WhatsApp de ${telefonoParaLog(mensaje.telefono)}: ${motivoDelError(error)}`,
        );
      }
    }

    // Con el pedido creado, la conversación arranca de cero (sigue con el
    // consentimiento: el comensal puede pedir otra cosa enseguida). Si no se
    // pudo, vuelve a armar con el mismo carrito.
    const siguiente: EstadoConversacion = creado
      ? { paso: 'ARMANDO', consentido: true, carrito: [] }
      : { ...estado, paso: 'ARMANDO' };
    await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.guardar(
        tx,
        tenantId,
        telefonoHash,
        siguiente,
        mensaje.mensajeId,
        params.ahora,
      ),
    );
    await enviar([texto]);
    return creado ? 'pedido-creado' : 'pedido-rechazado';
  }

  /** El restaurante y su carta como la ve el bot, o null si no hay local. */
  private async datosDelLocal(
    tx: PrismaClient,
    tenantId: string,
    ahora: Date,
  ): Promise<DatosDelLocal | null> {
    const restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: {
        id: true,
        nombre: true,
        timezone: true,
        retiroHabilitado: true,
        retiroHoraDesde: true,
        retiroHoraHasta: true,
      },
    });
    if (!restaurante) return null;
    const categorias = await tx.categoriaCarta.findMany({
      where: {
        restauranteId: restaurante.id,
        ...FILTRO_CATEGORIAS_DEL_COMENSAL,
      },
      orderBy: { orden: 'asc' },
      select: {
        nombre: true,
        items: {
          ...ITEMS_DEL_COMENSAL,
          select: { id: true, nombre: true, precio: true, disponible: true },
        },
      },
    });
    const abierto = retiroAbierto(restaurante, ahora, restaurante.timezone);
    return {
      restauranteId: restaurante.id,
      zonaHoraria: restaurante.timezone,
      carta: {
        restaurante: restaurante.nombre,
        items: categorias.flatMap((categoria) =>
          categoria.items.map((item) => ({
            id: item.id,
            nombre: item.nombre,
            precio: item.precio.toString(),
            disponible: item.disponible,
            categoria: categoria.nombre,
          })),
        ),
        retiro: {
          abierto,
          mensaje: abierto ? null : mensajeRetiroNoDisponible(restaurante),
        },
        urlPrivacidad: urlPrivacidad(tenantId, restaurante.id),
      },
    };
  }

  private async guardar(
    tx: PrismaClient,
    tenantId: string,
    telefonoHash: string,
    estado: EstadoConversacion,
    mensajeId: string,
    ahora: Date,
  ): Promise<void> {
    const datos = {
      paso: estado.paso,
      consentido: estado.consentido,
      carrito: estado.carrito as unknown as Prisma.InputJsonValue,
      ultimoMensajeId: mensajeId,
      venceEn: new Date(ahora.getTime() + MINUTOS_CONVERSACION * 60_000),
    };
    await tx.conversacionWhatsapp.upsert({
      where: { tenantId_telefonoHash: { tenantId, telefonoHash } },
      create: { tenantId, telefonoHash, ...datos },
      update: datos,
    });
  }
}

const PASOS: readonly PasoConversacion[] = [
  'INICIO',
  'PRIVACIDAD',
  'ARMANDO',
  'CONFIRMAR',
];

/** La fila de la base como estado de la conversación (defensivo con el JSON). */
export function estadoGuardado(fila: {
  paso: string;
  consentido: boolean;
  carrito: unknown;
}): EstadoConversacion {
  const paso = PASOS.find((p) => p === fila.paso) ?? 'INICIO';
  const carrito = Array.isArray(fila.carrito)
    ? fila.carrito.flatMap((linea: unknown) => {
        const l = linea as Partial<LineaCarrito> | null;
        return typeof l?.itemCartaId === 'string' &&
          Number.isInteger(l.cantidad) &&
          (l.cantidad ?? 0) > 0
          ? [{ itemCartaId: l.itemCartaId, cantidad: l.cantidad as number }]
          : [];
      })
    : [];
  return fila.consentido
    ? { paso, consentido: true, carrito }
    : {
        ...ESTADO_INICIAL,
        paso: paso === 'PRIVACIDAD' ? 'PRIVACIDAD' : 'INICIO',
      };
}

/**
 * La idempotencyKey del pedido: única en toda la base, así que lleva el
 * tenant. Si Evolution manda dos veces la confirmación, es el mismo pedido.
 */
export function claveIdempotencia(tenantId: string, mensajeId: string): string {
  const hash = createHash('sha256')
    .update(`${tenantId}:${mensajeId}`)
    .digest('hex')
    .slice(0, 40);
  return `wa:${hash}`;
}

/** Aviso de privacidad del local en el frontend (la misma página del QR). */
export function urlPrivacidad(tenantId: string, restauranteId: string): string {
  const base = sinBarraFinal(process.env.FRONTEND_URL ?? '');
  return `${base}/privacidad?t=${tenantId}&r=${restauranteId}`;
}

/** El mensaje de un 4xx de la API, para el comensal. */
function motivoParaElComensal(error: HttpException): string {
  const cuerpo = error.getResponse();
  const mensaje =
    typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo
      ? (cuerpo as { message: unknown }).message
      : cuerpo;
  if (Array.isArray(mensaje)) return mensaje.join('. ');
  return typeof mensaje === 'string' ? mensaje : error.message;
}

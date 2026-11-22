/**
 * HU-010 (BL-112): la conversación del bot de pedidos para retirar, como
 * función pura: con el estado guardado, el texto que llegó y la carta,
 * devuelve el estado nuevo, los mensajes para mandar y, si corresponde, el
 * pedido para crear. No toca la base ni WhatsApp (eso es WhatsappService),
 * así se prueba entera con tests unitarios.
 *
 * Pasos:
 * 0. INICIO: todavía no se le mostró el aviso de privacidad. Cualquier
 *    mensaje (aunque sea «1») recibe el aviso: no se puede aceptar algo que
 *    no se leyó.
 * 1. PRIVACIDAD: el comensal acepta el aviso de privacidad (HU-036). Sin
 *    aceptarlo no se toma el pedido, porque el teléfono hace falta para
 *    avisarle cuando esté listo.
 * 2. ARMANDO: manda el número de un plato de la carta («3», «3 x2»). Con
 *    «0» termina.
 * 3. CONFIRMAR: ve el resumen y confirma (1), sigue agregando (2) o vacía
 *    el pedido (3). Al confirmar se crea el pedido y se manda el link de
 *    pago (HU-033).
 *
 * En cualquier paso: «menu» vuelve a mandar la carta y «cancelar» vacía el
 * pedido. Los textos son fijos (no son plantillas HSM de Meta: Evolution
 * se conecta como WhatsApp Web; ver la CR de HU-010).
 */

import { CANTIDAD_MAXIMA_POR_ITEM } from '../pedidos/dto/crear-pedido.dto';

export type PasoConversacion =
  'INICIO' | 'PRIVACIDAD' | 'ARMANDO' | 'CONFIRMAR';

export interface LineaCarrito {
  itemCartaId: string;
  cantidad: number;
}

export interface EstadoConversacion {
  paso: PasoConversacion;
  consentido: boolean;
  carrito: LineaCarrito[];
}

export const ESTADO_INICIAL: EstadoConversacion = {
  paso: 'INICIO',
  consentido: false,
  carrito: [],
};

export interface ItemParaElBot {
  id: string;
  nombre: string;
  /** Decimal como texto, tal como viene de Prisma («350.00»). */
  precio: string;
  disponible: boolean;
  categoria: string;
}

export interface CartaParaElBot {
  restaurante: string;
  /** En el orden de la carta: el número de cada plato es su posición + 1. */
  items: ItemParaElBot[];
  retiro: {
    abierto: boolean;
    /** Por qué no se toman pedidos ahora (null si está abierto). */
    mensaje: string | null;
  };
  urlPrivacidad: string;
}

export type AccionConversacion = {
  tipo: 'crear-pedido';
  lineas: LineaCarrito[];
} | null;

export interface RespuestaConversacion {
  estado: EstadoConversacion;
  mensajes: string[];
  accion: AccionConversacion;
}

/** Tope de platos distintos en un pedido por WhatsApp. */
export const LINEAS_MAXIMAS = 20;

/** Largo máximo de cada mensaje (WhatsApp corta en 4096). */
export const LARGO_MAXIMO_MENSAJE = 3500;

const SI = new Set(['1', 'si', 'acepto', 'ok', 'dale']);
const NO = new Set(['2', 'no', 'no acepto']);
const MENU = new Set(['menu', 'carta', 'hola', 'buenas', 'inicio']);
const CANCELAR = new Set(['cancelar', 'vaciar', 'borrar']);

const LETRA_O_NUMERO = /[\p{L}\p{N}]/u;

/** Minúsculas, sin tildes ni signos alrededor: «¡Menú!» → «menu». */
export function normalizarTexto(texto: string): string {
  const caracteres = [
    ...texto.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase(),
  ];
  // Recorre los extremos en lugar de una regex con dos clases negadas
  // (backtracking cuadrático con textos llenos de signos, Sonar S8786).
  let inicio = 0;
  while (
    inicio < caracteres.length &&
    !LETRA_O_NUMERO.test(caracteres[inicio])
  ) {
    inicio += 1;
  }
  let fin = caracteres.length;
  while (fin > inicio && !LETRA_O_NUMERO.test(caracteres[fin - 1])) {
    fin -= 1;
  }
  return caracteres.slice(inicio, fin).join('').trim();
}

function centesimos(precio: string): number {
  return Math.round(Number(precio) * 100);
}

/** 105000 → «$ 1.050»; 12050 → «$ 120,50». */
export function formatearPesos(centavos: number): string {
  const conDecimales = centavos % 100 !== 0;
  return `$ ${(centavos / 100).toLocaleString('es-UY', {
    minimumFractionDigits: conDecimales ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * «3» → plato 3, una unidad. «3 x2», «3x2», «3 * 2» y «3 2» → dos
 * unidades. Null si no es un pedido de plato.
 */
export function leerPlato(
  texto: string,
): { numero: number; cantidad: number } | null {
  const coincide = /^(\d{1,3})(?:(?:\s*[x*]\s*|\s+)(\d{1,3}))?$/i.exec(
    texto.trim(),
  );
  if (!coincide) return null;
  const numero = Number(coincide[1]);
  const cantidad = coincide[2] === undefined ? 1 : Number(coincide[2]);
  return { numero, cantidad };
}

/** Parte un texto largo en mensajes, cortando entre líneas. */
export function partirMensaje(
  texto: string,
  largoMaximo: number = LARGO_MAXIMO_MENSAJE,
): string[] {
  const partes: string[] = [];
  let actual = '';
  for (const linea of texto.split('\n')) {
    const candidato = actual === '' ? linea : `${actual}\n${linea}`;
    if (candidato.length > largoMaximo && actual !== '') {
      partes.push(actual);
      actual = linea.slice(0, largoMaximo);
    } else {
      actual = candidato.slice(0, largoMaximo);
    }
  }
  if (actual.trim() !== '') partes.push(actual);
  return partes;
}

/**
 * La carta para WhatsApp (BL-604): las instrucciones arriba, las categorías
 * en negrita y mayúsculas, y sin los platos agotados (no se pueden pedir y
 * alargan la lista). El número de cada plato es su posición en la carta
 * completa, así no cambia si otro plato se agota mientras el comensal elige
 * (por eso puede haber saltos: 1, 2, 4).
 */
export function textoCarta(carta: CartaParaElBot): string[] {
  const lineas = [
    `*${carta.restaurante}* · Pedido para retirar`,
    'Mandá el número del plato (ej.: *3*) o *3 x2* para dos.',
  ];
  let categoria: string | null = null;
  let hayDisponibles = false;
  carta.items.forEach((item, indice) => {
    if (!item.disponible) return;
    hayDisponibles = true;
    if (item.categoria !== categoria) {
      categoria = item.categoria;
      lineas.push('', `*${categoria.toLocaleUpperCase('es-UY')}*`);
    }
    lineas.push(
      `${indice + 1}. ${item.nombre} · ${formatearPesos(centesimos(item.precio))}`,
    );
  });
  if (!hayDisponibles) {
    return [
      `*${carta.restaurante}*\nAhora no hay platos disponibles para pedir. Probá de nuevo más tarde.`,
    ];
  }
  lineas.push(
    '',
    'Cuando termines, mandá *0*. Para ver la carta otra vez: *menu*.',
  );
  return partirMensaje(lineas.join('\n'));
}

function textoPrivacidad(carta: CartaParaElBot): string {
  return [
    `¡Hola! Soy el asistente de pedidos para retirar de ${carta.restaurante}.`,
    '',
    'Para tomar tu pedido guardamos tu número de WhatsApp, solo para avisarte cuando esté listo. ' +
      `Podés leer el aviso de privacidad acá: ${carta.urlPrivacidad}`,
    '',
    '*1* Acepto',
    '*2* No acepto',
  ].join('\n');
}

interface LineaResuelta {
  item: ItemParaElBot;
  cantidad: number;
  subtotal: number;
}

/** El carrito con los platos que siguen en la carta. */
function lineasResueltas(
  carrito: LineaCarrito[],
  carta: CartaParaElBot,
): LineaResuelta[] {
  const porId = new Map(carta.items.map((item) => [item.id, item]));
  return carrito.flatMap((linea) => {
    const item = porId.get(linea.itemCartaId);
    return item
      ? [
          {
            item,
            cantidad: linea.cantidad,
            subtotal: centesimos(item.precio) * linea.cantidad,
          },
        ]
      : [];
  });
}

function total(lineas: LineaResuelta[]): number {
  return lineas.reduce((suma, linea) => suma + linea.subtotal, 0);
}

function textoResumen(lineas: LineaResuelta[]): string {
  return [
    '*Tu pedido para retirar*',
    ...lineas.map(
      (l) => `${l.cantidad} × ${l.item.nombre} — ${formatearPesos(l.subtotal)}`,
    ),
    `*Total: ${formatearPesos(total(lineas))}*`,
    '',
    '*1* Confirmar y pagar',
    '*2* Seguir agregando',
    '*3* Vaciar el pedido',
  ].join('\n');
}

const AYUDA_ARMANDO =
  'Mandá el número de un plato de la carta (por ejemplo «3» o «3 x2»), *0* para terminar o «menu» para ver la carta otra vez.';

function respuesta(
  estado: EstadoConversacion,
  mensajes: string[],
  accion: AccionConversacion = null,
): RespuestaConversacion {
  return { estado, mensajes, accion };
}

function agregarPlato(
  estado: EstadoConversacion,
  plato: { numero: number; cantidad: number },
  carta: CartaParaElBot,
): RespuestaConversacion {
  const item = carta.items[plato.numero - 1];
  if (!item) {
    return respuesta(estado, [
      `No hay un plato con el número ${plato.numero}. ${AYUDA_ARMANDO}`,
    ]);
  }
  if (!item.disponible) {
    return respuesta(estado, [
      `${item.nombre} está agotado. Elegí otro plato de la carta.`,
    ]);
  }
  if (plato.cantidad < 1 || plato.cantidad > CANTIDAD_MAXIMA_POR_ITEM) {
    return respuesta(estado, [
      `La cantidad tiene que ser de 1 a ${CANTIDAD_MAXIMA_POR_ITEM}.`,
    ]);
  }
  const existente = estado.carrito.find((l) => l.itemCartaId === item.id);
  const cantidadNueva = (existente?.cantidad ?? 0) + plato.cantidad;
  if (cantidadNueva > CANTIDAD_MAXIMA_POR_ITEM) {
    return respuesta(estado, [
      `Podés pedir hasta ${CANTIDAD_MAXIMA_POR_ITEM} de ${item.nombre}.`,
    ]);
  }
  if (!existente && estado.carrito.length >= LINEAS_MAXIMAS) {
    return respuesta(estado, [
      `El pedido puede tener hasta ${LINEAS_MAXIMAS} platos distintos. Mandá *0* para terminar.`,
    ]);
  }
  const carrito = existente
    ? estado.carrito.map((l) =>
        l.itemCartaId === item.id ? { ...l, cantidad: cantidadNueva } : l,
      )
    : [...estado.carrito, { itemCartaId: item.id, cantidad: plato.cantidad }];
  const lineas = lineasResueltas(carrito, carta);
  return respuesta({ ...estado, paso: 'ARMANDO', carrito }, [
    `Agregué ${plato.cantidad} × ${item.nombre}. Llevás ${formatearPesos(total(lineas))}.\n` +
      'Mandá otro número, o *0* para terminar.',
  ]);
}

function terminar(
  estado: EstadoConversacion,
  carta: CartaParaElBot,
): RespuestaConversacion {
  const lineas = lineasResueltas(estado.carrito, carta);
  if (lineas.length === 0) {
    return respuesta({ ...estado, paso: 'ARMANDO', carrito: [] }, [
      `Tu pedido está vacío. ${AYUDA_ARMANDO}`,
    ]);
  }
  const carrito = lineas.map((l) => ({
    itemCartaId: l.item.id,
    cantidad: l.cantidad,
  }));
  return respuesta({ ...estado, paso: 'CONFIRMAR', carrito }, [
    textoResumen(lineas),
  ]);
}

function confirmar(
  estado: EstadoConversacion,
  opcion: string,
  carta: CartaParaElBot,
): RespuestaConversacion {
  if (opcion === '1') {
    const lineas = lineasResueltas(estado.carrito, carta);
    if (lineas.length === 0) return terminar(estado, carta);
    // El carrito se vacía recién cuando WhatsappService crea el pedido.
    return respuesta(estado, [], {
      tipo: 'crear-pedido',
      lineas: lineas.map((l) => ({
        itemCartaId: l.item.id,
        cantidad: l.cantidad,
      })),
    });
  }
  if (opcion === '2') {
    return respuesta({ ...estado, paso: 'ARMANDO' }, [
      'Dale. Mandá el número del plato que quieras agregar, o *0* para terminar.',
    ]);
  }
  if (opcion === '3') {
    return respuesta({ ...estado, paso: 'ARMANDO', carrito: [] }, [
      `Listo, vacié tu pedido. ${AYUDA_ARMANDO}`,
    ]);
  }
  return terminar(estado, carta);
}

/** Antes de aceptar el aviso de privacidad. */
function responderSinConsentimiento(
  estado: EstadoConversacion,
  comando: string,
  carta: CartaParaElBot,
): RespuestaConversacion {
  if (estado.paso === 'PRIVACIDAD') {
    if (SI.has(comando)) {
      const aceptado: EstadoConversacion = {
        paso: 'ARMANDO',
        consentido: true,
        carrito: [],
      };
      if (!carta.retiro.abierto) {
        return respuesta(aceptado, [
          carta.retiro.mensaje ?? 'Ahora no estamos tomando pedidos.',
        ]);
      }
      return respuesta(aceptado, ['¡Gracias!', ...textoCarta(carta)]);
    }
    if (NO.has(comando)) {
      return respuesta(ESTADO_INICIAL, [
        'Entendido: sin aceptar no podemos tomar tu pedido por WhatsApp. Si cambiás de idea, escribinos de nuevo.',
      ]);
    }
  }
  return respuesta({ ...ESTADO_INICIAL, paso: 'PRIVACIDAD' }, [
    textoPrivacidad(carta),
  ]);
}

export function responder(
  estado: EstadoConversacion,
  texto: string,
  carta: CartaParaElBot,
): RespuestaConversacion {
  const comando = normalizarTexto(texto);
  if (!estado.consentido) {
    return responderSinConsentimiento(estado, comando, carta);
  }

  if (!carta.retiro.abierto) {
    return respuesta(estado, [
      carta.retiro.mensaje ?? 'Ahora no estamos tomando pedidos.',
    ]);
  }
  if (MENU.has(comando)) {
    return respuesta({ ...estado, paso: 'ARMANDO' }, textoCarta(carta));
  }
  if (CANCELAR.has(comando)) {
    return respuesta({ ...estado, paso: 'ARMANDO', carrito: [] }, [
      `Listo, vacié tu pedido. ${AYUDA_ARMANDO}`,
    ]);
  }
  if (estado.paso === 'CONFIRMAR') {
    return confirmar(estado, comando, carta);
  }
  if (comando === '0') return terminar(estado, carta);

  const plato = leerPlato(comando);
  if (plato) return agregarPlato(estado, plato, carta);
  return respuesta({ ...estado, paso: 'ARMANDO' }, [AYUDA_ARMANDO]);
}

/** Lo que se le manda al comensal con el link de pago. */
export function textoPedidoCreado(
  url: string,
  venceEn: Date,
  zonaHoraria: string,
): string {
  const hora = venceEn.toLocaleTimeString('es-UY', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zonaHoraria,
  });
  return [
    '¡Listo! Registramos tu pedido.',
    `Pagalo desde este link (vence a las ${hora}): ${url}`,
    'Cuando se apruebe el pago te mandamos el código para retirarlo.',
  ].join('\n');
}

/** El pedido no se pudo crear: el motivo y que el carrito sigue. */
export function textoPedidoRechazado(motivo: string): string {
  return `No pudimos registrar el pedido: ${motivo}\nTu pedido sigue guardado. Mandá *0* para revisarlo o «menu» para ver la carta.`;
}

import {
  configuracionWhatsapp,
  hashTelefono,
  leerInstancias,
  secretoWebhookValido,
} from '../../src/whatsapp/configuracion-whatsapp';
import {
  ESTADO_INICIAL,
  formatearPesos,
  LINEAS_MAXIMAS,
  leerPlato,
  normalizarTexto,
  partirMensaje,
  responder,
  textoCarta,
  textoPedidoCreado,
  type CartaParaElBot,
  type EstadoConversacion,
} from '../../src/whatsapp/conversacion';
import {
  leerMensajeEntrante,
  telefonoParaLog,
} from '../../src/whatsapp/mensaje-evolution';

const TENANT = '11111111-1111-1111-1111-111111111111';
const MILANESA = 'aaaaaaaa-0000-4000-8000-000000000001';
const FLAN = 'aaaaaaaa-0000-4000-8000-000000000002';
const AGUA = 'aaaaaaaa-0000-4000-8000-000000000003';

function carta(parcial: Partial<CartaParaElBot> = {}): CartaParaElBot {
  return {
    restaurante: 'La Cantina',
    items: [
      {
        id: MILANESA,
        nombre: 'Milanesa',
        precio: '350.00',
        disponible: true,
        categoria: 'Platos',
      },
      {
        id: FLAN,
        nombre: 'Flan',
        precio: '120.50',
        disponible: true,
        categoria: 'Postres',
      },
      {
        id: AGUA,
        nombre: 'Agua',
        precio: '90.00',
        disponible: false,
        categoria: 'Postres',
      },
    ],
    retiro: { abierto: true, mensaje: null },
    urlPrivacidad: 'https://bistrolink.test/privacidad?t=x&r=y',
    ...parcial,
  };
}

const ACEPTADO: EstadoConversacion = {
  paso: 'ARMANDO',
  consentido: true,
  carrito: [],
};

function evento(parcial: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'bistrolink-staging',
    data: {
      key: {
        remoteJid: '598991234567@s.whatsapp.net',
        fromMe: false,
        id: '3EB0ABC123',
      },
      message: { conversation: '  hola   menú ' },
    },
    ...parcial,
  };
}

describe('WhatsApp: mensaje de Evolution y configuración (HU-010, BL-112)', () => {
  it('[TC-U-651] leerMensajeEntrante toma el texto de un chat individual y descarta lo propio, grupos, estados y lo que no es texto', () => {
    expect(leerMensajeEntrante(evento())).toEqual({
      instancia: 'bistrolink-staging',
      mensajeId: '3EB0ABC123',
      telefono: '598991234567',
      texto: 'hola menú',
    });
    // Texto «extendido» (con link o respuesta citada).
    expect(
      leerMensajeEntrante(
        evento({
          data: {
            key: {
              remoteJid: '598991234567@s.whatsapp.net',
              fromMe: false,
              id: 'X1',
            },
            message: { extendedTextMessage: { text: '3 x2' } },
          },
        }),
      )?.texto,
    ).toBe('3 x2');
    // Evento con el nombre en mayúsculas (WEBHOOK_GLOBAL).
    expect(leerMensajeEntrante(evento({ event: 'MESSAGES_UPSERT' }))).not.toBe(
      null,
    );

    const conClave = (key: Record<string, unknown>) =>
      evento({ data: { key, message: { conversation: 'hola' } } });
    expect(
      leerMensajeEntrante(
        conClave({
          remoteJid: '598991234567@s.whatsapp.net',
          fromMe: true,
          id: 'A',
        }),
      ),
    ).toBeNull();
    expect(
      leerMensajeEntrante(
        conClave({ remoteJid: '1203630@g.us', fromMe: false, id: 'A' }),
      ),
    ).toBeNull();
    expect(
      leerMensajeEntrante(
        conClave({ remoteJid: 'status@broadcast', fromMe: false, id: 'A' }),
      ),
    ).toBeNull();
    expect(
      leerMensajeEntrante(
        evento({
          data: {
            key: {
              remoteJid: '598991234567@s.whatsapp.net',
              fromMe: false,
              id: 'A',
            },
            message: { audioMessage: {} },
          },
        }),
      ),
    ).toBeNull();
    expect(leerMensajeEntrante(evento({ event: 'connection.update' }))).toBe(
      null,
    );
    expect(leerMensajeEntrante(null)).toBeNull();
    expect(leerMensajeEntrante('texto')).toBeNull();
    // Texto largo: se recorta.
    const largo = leerMensajeEntrante(
      evento({
        data: {
          key: {
            remoteJid: '598991234567@s.whatsapp.net',
            fromMe: false,
            id: 'L',
          },
          message: { conversation: 'a'.repeat(5000) },
        },
      }),
    );
    expect(largo?.texto).toHaveLength(200);
    // En los logs, solo los últimos 3 dígitos.
    expect(telefonoParaLog('598991234567')).toBe('***567');
  });

  it('[TC-U-652] configuracionWhatsapp: el bot queda apagado si falta algo o los secretos son cortos', () => {
    const completa = {
      EVOLUTION_API_URL: 'https://evo.test/',
      EVOLUTION_API_KEY: 'clave',
      EVOLUTION_INSTANCIAS: `bistrolink-staging=${TENANT}`,
      WHATSAPP_WEBHOOK_SECRETO: 's'.repeat(32),
      WHATSAPP_TELEFONO_CLAVE: 'c'.repeat(32),
    };
    const config = configuracionWhatsapp(completa);
    expect(config?.evolutionUrl).toBe('https://evo.test');
    expect(config?.instancias.get('bistrolink-staging')).toBe(TENANT);

    for (const variable of Object.keys(completa)) {
      expect(
        configuracionWhatsapp({ ...completa, [variable]: undefined }),
      ).toBeNull();
    }
    expect(
      configuracionWhatsapp({
        ...completa,
        WHATSAPP_WEBHOOK_SECRETO: 'corto',
      }),
    ).toBeNull();
    expect(
      configuracionWhatsapp({ ...completa, EVOLUTION_API_URL: 'evo.test' }),
    ).toBeNull();

    // Instancias: se descartan las mal formadas.
    const instancias = leerInstancias(
      `a=${TENANT}, b=no-es-uuid, c d=${TENANT}, =x, e=${TENANT.toUpperCase()}`,
    );
    expect([...instancias.keys()]).toEqual(['a', 'e']);
    expect(instancias.get('e')).toBe(TENANT);
  });

  it('[TC-U-653] el secreto del webhook se compara completo y el teléfono se guarda como HMAC por tenant', () => {
    const secreto = 'x'.repeat(40);
    expect(secretoWebhookValido(secreto, secreto)).toBe(true);
    expect(secretoWebhookValido(`${secreto}y`, secreto)).toBe(false);
    expect(secretoWebhookValido('', secreto)).toBe(false);
    expect(secretoWebhookValido(undefined, secreto)).toBe(false);
    expect(secretoWebhookValido(secreto, undefined)).toBe(false);

    const clave = 'k'.repeat(32);
    const hash = hashTelefono(clave, TENANT, '598991234567');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('598991234567');
    expect(hashTelefono(clave, TENANT, '598991234567')).toBe(hash);
    // El mismo número en otro local da otro hash.
    expect(
      hashTelefono(
        clave,
        '22222222-2222-2222-2222-222222222222',
        '598991234567',
      ),
    ).not.toBe(hash);
  });
});

describe('WhatsApp: conversación del pedido para retirar (HU-010, BL-112)', () => {
  it('[TC-U-654] textos de apoyo: normalizar, leer el plato, pesos y mensajes largos', () => {
    expect(normalizarTexto('¡Menú!')).toBe('menu');
    expect(normalizarTexto('  Sí. ')).toBe('si');
    expect(leerPlato('3')).toEqual({ numero: 3, cantidad: 1 });
    expect(leerPlato('3 x2')).toEqual({ numero: 3, cantidad: 2 });
    expect(leerPlato('3x2')).toEqual({ numero: 3, cantidad: 2 });
    expect(leerPlato('3 * 2')).toEqual({ numero: 3, cantidad: 2 });
    expect(leerPlato('3 2')).toEqual({ numero: 3, cantidad: 2 });
    expect(leerPlato('tres')).toBeNull();
    expect(leerPlato('3 x')).toBeNull();
    expect(formatearPesos(105000)).toBe('$ 1.050');
    expect(formatearPesos(12050)).toBe('$ 120,50');

    const partes = partirMensaje(
      Array.from({ length: 50 }, (_, i) => `línea ${i}`).join('\n'),
      100,
    );
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.every((p) => p.length <= 100)).toBe(true);
    expect(partes.join('\n').split('\n')).toHaveLength(50);

    const textoDeLaCarta = textoCarta(carta()).join('\n');
    expect(textoDeLaCarta).toContain('1. Milanesa — $ 350');
    expect(textoDeLaCarta).toContain('2. Flan — $ 120,50');
    expect(textoDeLaCarta).toContain('3. Agua — agotado');
  });

  it('[TC-U-655] primero el aviso de privacidad: aunque el primer mensaje sea «1», no se acepta sin haberlo mostrado', () => {
    const primero = responder(ESTADO_INICIAL, '1', carta());
    expect(primero.estado).toEqual({
      paso: 'PRIVACIDAD',
      consentido: false,
      carrito: [],
    });
    expect(primero.mensajes[0]).toContain('aviso de privacidad');
    expect(primero.mensajes[0]).toContain(carta().urlPrivacidad);
    expect(primero.accion).toBeNull();

    const acepta = responder(primero.estado, 'Sí', carta());
    expect(acepta.estado).toEqual(ACEPTADO);
    expect(acepta.mensajes.join('\n')).toContain('1. Milanesa');

    const noAcepta = responder(primero.estado, '2', carta());
    expect(noAcepta.estado).toEqual(ESTADO_INICIAL);
    expect(noAcepta.mensajes[0]).toContain('sin aceptar no podemos');

    // Sin aceptar, un número de plato no arma nada: vuelve el aviso.
    const sinAceptar = responder(ESTADO_INICIAL, '1 x3', carta());
    expect(sinAceptar.estado.carrito).toEqual([]);
    expect(sinAceptar.mensajes[0]).toContain('aviso de privacidad');
  });

  it('[TC-U-656] armar el pedido: suma cantidades del mismo plato y rechaza números inexistentes, agotados y cantidades fuera de rango', () => {
    let r = responder(ACEPTADO, '1 x2', carta());
    expect(r.estado.carrito).toEqual([{ itemCartaId: MILANESA, cantidad: 2 }]);
    expect(r.mensajes[0]).toContain('Agregué 2 × Milanesa. Llevás $ 700.');

    r = responder(r.estado, '1', carta());
    expect(r.estado.carrito).toEqual([{ itemCartaId: MILANESA, cantidad: 3 }]);

    r = responder(r.estado, '2', carta());
    expect(r.estado.carrito).toHaveLength(2);
    expect(r.mensajes[0]).toContain('Llevás $ 1.170,50');

    const antes = r.estado;
    expect(responder(antes, '9', carta()).mensajes[0]).toContain(
      'No hay un plato con el número 9',
    );
    expect(responder(antes, '3', carta()).mensajes[0]).toContain(
      'Agua está agotado',
    );
    expect(responder(antes, '1 x0', carta()).mensajes[0]).toContain(
      'de 1 a 99',
    );
    expect(responder(antes, '1 x97', carta()).mensajes[0]).toContain(
      'hasta 99 de Milanesa',
    );
    for (const texto of ['9', '3', '1 x0', '1 x97', 'quiero pizza']) {
      expect(responder(antes, texto, carta()).estado.carrito).toEqual(
        antes.carrito,
      );
    }

    // Tope de platos distintos.
    const muchos = carta({
      items: Array.from({ length: LINEAS_MAXIMAS + 1 }, (_, i) => ({
        id: `id-${i}`,
        nombre: `Plato ${i}`,
        precio: '10.00',
        disponible: true,
        categoria: 'Platos',
      })),
    });
    let lleno = ACEPTADO;
    for (let i = 1; i <= LINEAS_MAXIMAS; i += 1) {
      lleno = responder(lleno, String(i), muchos).estado;
    }
    const pasado = responder(lleno, String(LINEAS_MAXIMAS + 1), muchos);
    expect(pasado.estado.carrito).toHaveLength(LINEAS_MAXIMAS);
    expect(pasado.mensajes[0]).toContain(`hasta ${LINEAS_MAXIMAS} platos`);
  });

  it('[TC-U-657] terminar y confirmar: resumen con total, seguir agregando, vaciar y crear el pedido solo con «1»', () => {
    const conPlatos = responder(
      responder(ACEPTADO, '1 x2', carta()).estado,
      '2',
      carta(),
    ).estado;

    const vacio = responder(ACEPTADO, '0', carta());
    expect(vacio.estado.paso).toBe('ARMANDO');
    expect(vacio.mensajes[0]).toContain('Tu pedido está vacío');

    const resumen = responder(conPlatos, '0', carta());
    expect(resumen.estado.paso).toBe('CONFIRMAR');
    expect(resumen.mensajes[0]).toContain('2 × Milanesa — $ 700');
    expect(resumen.mensajes[0]).toContain('1 × Flan — $ 120,50');
    expect(resumen.mensajes[0]).toContain('Total: $ 820,50');
    expect(resumen.accion).toBeNull();

    const sigue = responder(resumen.estado, '2', carta());
    expect(sigue.estado).toEqual({ ...resumen.estado, paso: 'ARMANDO' });

    const vacia = responder(resumen.estado, '3', carta());
    expect(vacia.estado).toEqual(ACEPTADO);

    const otraCosa = responder(resumen.estado, 'mmm', carta());
    expect(otraCosa.estado.paso).toBe('CONFIRMAR');
    expect(otraCosa.accion).toBeNull();

    const confirma = responder(resumen.estado, '1', carta());
    expect(confirma.accion).toEqual({
      tipo: 'crear-pedido',
      lineas: [
        { itemCartaId: MILANESA, cantidad: 2 },
        { itemCartaId: FLAN, cantidad: 1 },
      ],
    });
    // El carrito se vacía recién cuando se crea el pedido.
    expect(confirma.estado.carrito).toHaveLength(2);

    // Un plato que salió de la carta no entra al pedido.
    const sinFlan = carta({
      items: carta().items.filter((i) => i.id !== FLAN),
    });
    expect(responder(resumen.estado, '1', sinFlan).accion).toEqual({
      tipo: 'crear-pedido',
      lineas: [{ itemCartaId: MILANESA, cantidad: 2 }],
    });
  });

  it('[TC-U-658] «menu» y «cancelar» en cualquier paso; con el retiro cerrado no se arma nada y se dice el horario', () => {
    const conPlatos = responder(ACEPTADO, '1', carta()).estado;
    const confirmando = responder(conPlatos, '0', carta()).estado;

    const menu = responder(confirmando, 'Menú', carta());
    expect(menu.estado.paso).toBe('ARMANDO');
    expect(menu.estado.carrito).toEqual(conPlatos.carrito);
    expect(menu.mensajes.join('\n')).toContain('Carta de La Cantina');

    expect(responder(confirmando, 'cancelar', carta()).estado).toEqual(
      ACEPTADO,
    );

    const cerrado = carta({
      retiro: {
        abierto: false,
        mensaje: 'Este local toma pedidos para retirar de 19:00 a 23:00.',
      },
    });
    const r = responder(conPlatos, '1', cerrado);
    expect(r.estado).toEqual(conPlatos);
    expect(r.mensajes).toEqual([
      'Este local toma pedidos para retirar de 19:00 a 23:00.',
    ]);
    expect(responder(confirmando, '1', cerrado).accion).toBeNull();
    // Al aceptar el aviso con el local cerrado: el horario, no la carta.
    const aviso = responder(ESTADO_INICIAL, 'hola', cerrado).estado;
    expect(responder(aviso, '1', cerrado).mensajes).toEqual([
      'Este local toma pedidos para retirar de 19:00 a 23:00.',
    ]);
  });

  it('[TC-U-659] el mensaje con el link de pago dice la hora de vencimiento en la zona del local', () => {
    const texto = textoPedidoCreado(
      'https://bistrolink.test/pagar/abc',
      new Date('2026-11-21T15:30:00Z'),
      'America/Montevideo',
    );
    expect(texto).toContain('https://bistrolink.test/pagar/abc');
    expect(texto).toContain('12:30');
  });
});

// BL-77 — Pruebas del pago con Mercado Pago contra el SANDBOX, de punta a
// punta, usando la API de staging igual que lo haría el comensal:
//
//   aprobado      pago aprobado → CFE emitido por Surtec (serie y número)
//   idempotencia  la misma idempotency key enviada 3 veces (2 a la vez y
//                 1 después) → un solo pago y una sola order en Mercado Pago
//   fondos        titular FUND → 402 con mensaje claro y sin cargo; después
//                 el mismo pedido se puede pagar con otra tarjeta
//
// Cada escenario crea su propio pedido para retirar (canal WEB) en el tenant
// de testing A, tokeniza una tarjeta de prueba de Uruguay contra Mercado Pago
// y paga con POST /pedidos/:id/pagos. Al final imprime un resumen en
// Markdown para pegar como evidencia en Linear o Kiwi.
//
// Uso (desde apps/backend):
//   MP_PUBLIC_KEY=<public key de la app de prueba> npx ts-node scripts/sandbox-pagos.ts [escenario...]
//
// Variables:
//   MP_PUBLIC_KEY   obligatoria. La misma que NEXT_PUBLIC_MP_PUBLIC_KEY de staging.
//   API_URL         por defecto, la API de staging.
//   TENANT_ID, RESTAURANTE_ID   por defecto, el tenant de testing A del seed.
//
// Nunca contra producción: el script se niega si API_URL no es staging o local.
import { randomUUID } from 'node:crypto';

const API_URL = (
  process.env.API_URL ?? 'https://bistrolink-api-staging.up.railway.app'
).replace(/\/$/, '');
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY;
const TENANT_ID =
  process.env.TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID =
  process.env.RESTAURANTE_ID ?? '22222222-2222-2222-2222-222222222222';

// Tarjeta de prueba de Uruguay (Mastercard crédito). El resultado lo decide
// el NOMBRE del titular: APRO aprueba, FUND rechaza por fondos insuficientes.
// https://www.mercadopago.com.uy/developers/es/docs/checkout-api-orders/resources/test-cards
const TARJETA = {
  card_number: '5031755734530604',
  security_code: '123',
  expiration_month: 11,
  expiration_year: 2030,
  paymentMethodId: 'master',
};

const ESCENARIOS = ['aprobado', 'idempotencia', 'fondos'] as const;
type Escenario = (typeof ESCENARIOS)[number];

interface Respuesta {
  status: number;
  body: any;
}

interface Resultado {
  escenario: Escenario;
  ok: boolean;
  lineas: string[];
}

function esEntornoPermitido(url: string): boolean {
  const host = new URL(url).hostname;
  return (
    host === 'localhost' || host === '127.0.0.1' || host.includes('staging')
  );
}

async function http(
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Respuesta> {
  const respuesta = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await respuesta.text();
  let datos: unknown = texto;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // respuesta no JSON: se deja el texto
  }
  return { status: respuesta.status, body: datos };
}

function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(mensaje);
}

async function tokenComensal(): Promise<string> {
  const r = await http('POST', `${API_URL}/auth/comensal`, {
    tenantId: TENANT_ID,
    restauranteId: RESTAURANTE_ID,
  });
  exigir(
    r.status === 200 && r.body?.accessToken,
    `No se pudo obtener el token de comensal (HTTP ${r.status}): ${JSON.stringify(r.body)}`,
  );
  return r.body.accessToken;
}

async function primerItemDisponible(): Promise<{
  id: string;
  nombre: string;
  precio: string;
}> {
  const r = await http(
    'GET',
    `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
  );
  exigir(r.status === 200, `No se pudo leer el menú (HTTP ${r.status})`);
  for (const categoria of r.body?.categorias ?? []) {
    const item = (categoria.items ?? []).find((i: any) => i.disponible);
    if (item) return { id: item.id, nombre: item.nombre, precio: item.precio };
  }
  throw new Error('El menú del tenant no tiene ítems disponibles');
}

// BL-311 (RD.05): token de acceso de cada pedido para retirar, tal como lo
// devuelve POST /pedidos. Sin él (header X-Pedido-Token) no se puede pagar.
const tokensDeAcceso = new Map<string, string>();

async function crearPedido(token: string, itemId: string): Promise<string> {
  const r = await http(
    'POST',
    `${API_URL}/pedidos`,
    {
      restauranteId: RESTAURANTE_ID,
      idempotencyKey: `sandbox-pedido-${randomUUID()}`,
      items: [{ itemCartaId: itemId, cantidad: 1 }],
    },
    token,
  );
  const id = r.body?.id ?? r.body?.pedido?.id;
  exigir(
    r.status < 300 && id,
    `No se pudo crear el pedido (HTTP ${r.status}): ${JSON.stringify(r.body)}`,
  );
  exigir(
    r.body?.tokenAcceso,
    'POST /pedidos no devolvió tokenAcceso (¿la API es anterior a BL-311?)',
  );
  tokensDeAcceso.set(id, r.body.tokenAcceso);
  return id;
}

async function tokenizarTarjeta(titular: 'APRO' | 'FUND'): Promise<string> {
  const r = await http(
    'POST',
    `https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(MP_PUBLIC_KEY ?? '')}`,
    {
      card_number: TARJETA.card_number,
      security_code: TARJETA.security_code,
      expiration_month: TARJETA.expiration_month,
      expiration_year: TARJETA.expiration_year,
      cardholder: {
        name: titular,
        identification: { type: 'CI', number: '12345678' },
      },
    },
  );
  exigir(
    r.status < 300 && r.body?.id,
    `Mercado Pago no tokenizó la tarjeta (HTTP ${r.status}): ${JSON.stringify(r.body)}`,
  );
  return r.body.id;
}

function pagar(
  token: string,
  pedidoId: string,
  idempotencyKey: string,
  cardToken: string,
): Promise<Respuesta> {
  return http(
    'POST',
    `${API_URL}/pedidos/${pedidoId}/pagos`,
    {
      idempotencyKey,
      medioPago: 'MERCADOPAGO',
      datosPasarela: {
        token: cardToken,
        paymentMethodId: TARJETA.paymentMethodId,
        paymentMethodType: 'credit_card',
        payerEmail: 'test@testuser.com',
      },
    },
    token,
    { 'X-Pedido-Token': tokensDeAcceso.get(pedidoId) ?? '' },
  );
}

function resumirPago(r: Respuesta): string {
  const b = r.body ?? {};
  return `HTTP ${r.status} · pago ${b.id ?? '-'} · estado ${b.estado ?? '-'} · order MP ${b.pasarelaReferencia ?? '-'}`;
}

async function escenarioAprobado(token: string, itemId: string) {
  const lineas: string[] = [];
  const pedidoId = await crearPedido(token, itemId);
  lineas.push(`Pedido ${pedidoId}`);

  const r = await pagar(
    token,
    pedidoId,
    `sandbox-${randomUUID()}`,
    await tokenizarTarjeta('APRO'),
  );
  lineas.push(resumirPago(r));
  const c = r.body?.comprobante;
  lineas.push(
    c
      ? `CFE ${c.serie}-${c.numero} · consulta: ${c.urlConsulta ?? '(sin URL)'}`
      : 'CFE: NO se emitió (comprobante null). Revisá en Railway los logs de CfeService: si Surtec rechaza el emisor, el tenant tiene un RUT que Surtec no acepta.',
  );

  const ok =
    r.status < 300 && r.body?.estado === 'APROBADO' && Boolean(c?.serie);
  return { ok, lineas };
}

async function escenarioIdempotencia(token: string, itemId: string) {
  const lineas: string[] = [];
  const pedidoId = await crearPedido(token, itemId);
  const clave = `sandbox-${randomUUID()}`;
  const tarjeta = await tokenizarTarjeta('APRO');
  lineas.push(`Pedido ${pedidoId} · idempotency key ${clave}`);

  // Dos requests a la vez (doble clic / reintento de red) y uno después.
  const [a, b] = await Promise.all([
    pagar(token, pedidoId, clave, tarjeta),
    pagar(token, pedidoId, clave, tarjeta),
  ]);
  const c = await pagar(token, pedidoId, clave, tarjeta);
  lineas.push(`1º (simultáneo): ${resumirPago(a)}`);
  lineas.push(`2º (simultáneo): ${resumirPago(b)}`);
  lineas.push(`3º (después):    ${resumirPago(c)}`);

  const respuestas = [a, b, c];
  const ids = new Set(respuestas.map((r) => r.body?.id));
  const orders = new Set(
    respuestas.map((r) => r.body?.pasarelaReferencia).filter(Boolean),
  );
  const todasOk = respuestas.every((r) => r.status < 300);
  lineas.push(
    `Pagos distintos: ${ids.size} · orders de Mercado Pago distintas: ${orders.size} (esperado: 1 y 1)`,
  );
  lineas.push(
    'Confirmar en el panel de Mercado Pago (Tus integraciones → Actividad) que hay UNA sola operación para esa order.',
  );
  return { ok: todasOk && ids.size === 1 && orders.size === 1, lineas };
}

async function escenarioFondos(token: string, itemId: string) {
  const lineas: string[] = [];
  const pedidoId = await crearPedido(token, itemId);
  lineas.push(`Pedido ${pedidoId}`);

  const rechazo = await pagar(
    token,
    pedidoId,
    `sandbox-${randomUUID()}`,
    await tokenizarTarjeta('FUND'),
  );
  lineas.push(
    `Con titular FUND: HTTP ${rechazo.status} · motivo ${rechazo.body?.motivo ?? '-'}`,
  );
  lineas.push(`Mensaje al comensal: "${rechazo.body?.message ?? '-'}"`);

  // Sin cargo: el pago quedó RECHAZADO, así que el pedido NO figura como
  // pagado y se puede volver a pagar con otra tarjeta.
  const reintento = await pagar(
    token,
    pedidoId,
    `sandbox-${randomUUID()}`,
    await tokenizarTarjeta('APRO'),
  );
  lineas.push(`Reintento con otra tarjeta (APRO): ${resumirPago(reintento)}`);

  const ok =
    rechazo.status === 402 &&
    rechazo.body?.motivo === 'insufficient_amount' &&
    /fondos suficientes/i.test(String(rechazo.body?.message)) &&
    reintento.status < 300 &&
    reintento.body?.estado === 'APROBADO';
  return { ok, lineas };
}

async function main() {
  exigir(
    MP_PUBLIC_KEY,
    'Falta MP_PUBLIC_KEY (la public key de la app de prueba de Mercado Pago).',
  );
  exigir(
    esEntornoPermitido(API_URL),
    `API_URL=${API_URL} no es staging ni local: este script nunca corre contra producción.`,
  );

  const elegidos = process.argv
    .slice(2)
    .filter((a): a is Escenario =>
      (ESCENARIOS as readonly string[]).includes(a),
    );
  const aCorrer = elegidos.length > 0 ? elegidos : [...ESCENARIOS];

  const token = await tokenComensal();
  const item = await primerItemDisponible();
  console.log(`API: ${API_URL}`);
  console.log(`Ítem usado: ${item.nombre} ($ ${item.precio})\n`);

  const resultados: Resultado[] = [];
  for (const escenario of aCorrer) {
    process.stdout.write(`▶ ${escenario}… `);
    try {
      const fn = {
        aprobado: escenarioAprobado,
        idempotencia: escenarioIdempotencia,
        fondos: escenarioFondos,
      }[escenario];
      const { ok, lineas } = await fn(token, item.id);
      resultados.push({ escenario, ok, lineas });
      console.log(ok ? 'OK' : 'FALLÓ');
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      resultados.push({ escenario, ok: false, lineas: [`Error: ${mensaje}`] });
      console.log('ERROR');
    }
  }

  const fecha = new Date().toISOString().replace('T', ' ').slice(0, 16);
  console.log(
    `\n## Evidencia BL-77 — sandbox de Mercado Pago (${fecha} UTC)\n`,
  );
  console.log(`API: \`${API_URL}\` · tenant de testing A\n`);
  for (const r of resultados) {
    console.log(`### ${r.ok ? '✅' : '❌'} ${r.escenario}\n`);
    for (const linea of r.lineas) console.log(`- ${linea}`);
    console.log('');
  }

  process.exitCode = resultados.every((r) => r.ok) ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

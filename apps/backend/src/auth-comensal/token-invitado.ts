import { createHash, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';

/**
 * HU-052 (BL-577): token de invitado del comensal, firmado por la API.
 *
 * Reemplaza al token del comensal técnico de Keycloak, que se obtenía con el
 * password grant de OAuth 2.0 (el RFC 9700 §2.4 dice que no debe usarse).
 * Keycloak sigue autenticando al personal y a la plataforma.
 *
 * - Lo firma y lo verifica solo la API: HS256 con una clave propia.
 * - Tiene su propio emisor (`iss`) y audiencia (`aud`), distintos de los de
 *   Keycloak: la verificación elige la clave por el emisor y nunca acepta
 *   uno firmado como el otro (sub-issue 2).
 * - El rol NO sale del token: quien lo verifica recibe siempre COMENSAL.
 *   Aunque se filtrara la clave, no se puede fabricar un Administrador.
 * - Cada comensal recibe un `sub` propio, y el token queda atado al canal
 *   por el que se emitió: la mesa y su sesión, el pedido del link de pago o
 *   el restaurante del retiro (sub-issue 4).
 * - Rotación sin cortar sesiones: se acepta la clave actual y la anterior.
 *   Cada token lleva en `kid` cuál de las dos lo firmó.
 */

export const ISSUER_TOKEN_INVITADO = 'bistrolink-api';
export const AUDIENCIA_TOKEN_INVITADO = 'bistrolink-comensal';
/** 60 minutos, igual que el token de Keycloak (decisión del 16/11/2026). */
export const DURACION_TOKEN_INVITADO_S = 3600;
export const LARGO_MINIMO_CLAVE_BYTES = 32;
export const ALGORITMO_TOKEN_INVITADO = 'HS256';
/** Tolerancia por diferencias de reloj entre réplicas de la API. */
export const TOLERANCIA_RELOJ_TOKEN_INVITADO_S = 5;

export type CanalInvitado =
  | { tipo: 'retiro'; restauranteId: string }
  | { tipo: 'mesa'; mesaId: string; sesionId: string }
  | { tipo: 'link'; pedidoId: string };

export interface DatosTokenInvitado {
  tenantId: string;
  restauranteId?: string;
  canal: CanalInvitado;
}

export interface TokenInvitadoEmitido {
  accessToken: string;
  /** Segundos de vida del token. */
  expiresIn: number;
}

export interface InvitadoVerificado {
  /** Id propio de este comensal (no es un usuario de Keycloak). */
  sub: string;
  tenantId: string;
  restauranteId?: string;
  /** Siempre COMENSAL: no se lee del token. */
  roles: ['COMENSAL'];
  canal: CanalInvitado;
}

export interface OpcionesTokenInvitado {
  claveActual: string;
  /** La clave que se está rotando. Sus tokens valen hasta que vencen. */
  claveAnterior?: string;
}

export class TokenInvitadoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInvitadoInvalidoError';
    Object.setPrototypeOf(this, TokenInvitadoInvalidoError.prototype);
  }
}

/** Identificador público de una clave: no permite reconstruirla. */
export function kidDeClave(clave: string): string {
  return createHash('sha256').update(clave, 'utf8').digest('hex').slice(0, 16);
}

function validarClave(clave: string | undefined, nombre: string): string {
  if (!clave || Buffer.byteLength(clave, 'utf8') < LARGO_MINIMO_CLAVE_BYTES) {
    throw new Error(
      `${nombre}: la clave del token de invitado tiene que tener al menos ${LARGO_MINIMO_CLAVE_BYTES} bytes`,
    );
  }
  return clave;
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

function leerCanal(valor: unknown): CanalInvitado | null {
  if (!valor || typeof valor !== 'object') return null;
  const canal = valor as Record<string, unknown>;
  switch (canal.tipo) {
    case 'retiro':
      return esTexto(canal.restaurante_id)
        ? { tipo: 'retiro', restauranteId: canal.restaurante_id }
        : null;
    case 'mesa':
      return esTexto(canal.mesa_id) && esTexto(canal.sesion_id)
        ? { tipo: 'mesa', mesaId: canal.mesa_id, sesionId: canal.sesion_id }
        : null;
    case 'link':
      return esTexto(canal.pedido_id)
        ? { tipo: 'link', pedidoId: canal.pedido_id }
        : null;
    default:
      return null;
  }
}

function canalAClaim(canal: CanalInvitado): Record<string, string> {
  switch (canal.tipo) {
    case 'retiro':
      return { tipo: 'retiro', restaurante_id: canal.restauranteId };
    case 'mesa':
      return { tipo: 'mesa', mesa_id: canal.mesaId, sesion_id: canal.sesionId };
    case 'link':
      return { tipo: 'link', pedido_id: canal.pedidoId };
  }
}

export class TokenInvitado {
  private readonly claveActual: string;
  private readonly claves: Map<string, string>;

  constructor(opciones: OpcionesTokenInvitado) {
    this.claveActual = validarClave(opciones.claveActual, 'clave actual');
    this.claves = new Map([[kidDeClave(this.claveActual), this.claveActual]]);

    if (opciones.claveAnterior) {
      const anterior = validarClave(opciones.claveAnterior, 'clave anterior');
      if (anterior === this.claveActual) {
        throw new Error(
          'La clave anterior tiene que ser distinta de la actual',
        );
      }
      this.claves.set(kidDeClave(anterior), anterior);
    }
  }

  /** Firma un token de invitado nuevo, siempre con la clave actual. */
  emitir(datos: DatosTokenInvitado): TokenInvitadoEmitido {
    const payload: Record<string, unknown> = {
      tenant_id: datos.tenantId,
      canal: canalAClaim(datos.canal),
    };
    if (datos.restauranteId) payload.restaurante_id = datos.restauranteId;

    const accessToken = jwt.sign(payload, this.claveActual, {
      algorithm: ALGORITMO_TOKEN_INVITADO,
      expiresIn: DURACION_TOKEN_INVITADO_S,
      issuer: ISSUER_TOKEN_INVITADO,
      audience: AUDIENCIA_TOKEN_INVITADO,
      subject: randomUUID(),
      jwtid: randomUUID(),
      keyid: kidDeClave(this.claveActual),
    });

    return { accessToken, expiresIn: DURACION_TOKEN_INVITADO_S };
  }

  /**
   * Verifica un token de invitado. Cualquier problema (firma, algoritmo,
   * emisor, audiencia, vencimiento, clave desconocida o claims incompletos)
   * termina en TokenInvitadoInvalidoError, sin decir cuál fue.
   */
  verificar(token: string): InvitadoVerificado {
    const decodificado = jwt.decode(token, { complete: true });
    const kid = decodificado?.header?.kid;
    const clave = kid ? this.claves.get(kid) : undefined;
    if (!clave) {
      throw new TokenInvitadoInvalidoError('Token de invitado inválido');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, clave, {
        algorithms: [ALGORITMO_TOKEN_INVITADO],
        issuer: ISSUER_TOKEN_INVITADO,
        audience: AUDIENCIA_TOKEN_INVITADO,
        clockTolerance: TOLERANCIA_RELOJ_TOKEN_INVITADO_S,
      }) as jwt.JwtPayload;
    } catch {
      throw new TokenInvitadoInvalidoError('Token de invitado inválido');
    }

    return invitadoDesdePayload(payload);
  }

  /**
   * La clave que corresponde a un `kid`, si es la actual o la anterior. La
   * usa la estrategia HTTP (sub-issue 2), que verifica con passport-jwt.
   */
  claveDelKid(kid: string | undefined): string | undefined {
    return kid ? this.claves.get(kid) : undefined;
  }
}

/**
 * Arma el invitado a partir de los claims de un token YA verificado (firma,
 * algoritmo, emisor, audiencia y vencimiento). El rol no se lee del token:
 * siempre es COMENSAL. Si faltan claims, TokenInvitadoInvalidoError.
 */
export function invitadoDesdePayload(
  payload: jwt.JwtPayload,
): InvitadoVerificado {
  const canal = leerCanal(payload.canal);
  if (!esTexto(payload.sub) || !esTexto(payload.tenant_id) || !canal) {
    throw new TokenInvitadoInvalidoError('Token de invitado inválido');
  }

  return {
    sub: payload.sub,
    tenantId: payload.tenant_id,
    restauranteId: esTexto(payload.restaurante_id)
      ? payload.restaurante_id
      : undefined,
    roles: ['COMENSAL'],
    canal,
  };
}

/**
 * true si el token dice venir de la API (sin verificarlo todavía). Sirve
 * solo para elegir con qué verificarlo: la firma la comprueba después
 * TokenInvitado, y un token de la API nunca se verifica contra Keycloak.
 */
export function esTokenDeInvitado(token: string): boolean {
  const payload = jwt.decode(token, { complete: true })?.payload;
  return (
    typeof payload === 'object' &&
    payload !== null &&
    payload.iss === ISSUER_TOKEN_INVITADO
  );
}

/**
 * HU-052 (BL-578): el TokenInvitado con las claves del entorno
 * (`COMENSAL_TOKEN_CLAVE` y, durante una rotación,
 * `COMENSAL_TOKEN_CLAVE_ANTERIOR`). Sin clave devuelve null: la API no
 * acepta tokens de invitado. Con una clave inválida (corta, o la anterior
 * igual a la actual) lanza un error, para que la API no arranque mal
 * configurada.
 */
export function tokenInvitadoDesdeEntorno(
  env: NodeJS.ProcessEnv = process.env,
): TokenInvitado | null {
  const claveActual = env.COMENSAL_TOKEN_CLAVE?.trim();
  if (!claveActual) return null;
  const claveAnterior = env.COMENSAL_TOKEN_CLAVE_ANTERIOR?.trim() || undefined;
  return new TokenInvitado({ claveActual, claveAnterior });
}

/**
 * HU-052 (BL-579): quién emite el token del comensal en /auth/comensal.
 * `keycloak` (por defecto): el usuario técnico del tenant, como hasta ahora.
 * `api`: el token de invitado que firma la API. Volver a `keycloak` es la
 * vuelta atrás, sin deploy de código.
 */
export const EMISORES_TOKEN_COMENSAL = ['keycloak', 'api'] as const;
export type EmisorTokenComensal = (typeof EMISORES_TOKEN_COMENSAL)[number];

/**
 * Lee `COMENSAL_TOKEN_EMISOR`. Vacía o sin definir: `keycloak`. Un valor
 * que no es ninguno de los dos lanza un error, para que la API no arranque
 * con un emisor que nadie eligió.
 */
export function emisorTokenComensalDesdeEntorno(
  env: NodeJS.ProcessEnv = process.env,
): EmisorTokenComensal {
  const valor = env.COMENSAL_TOKEN_EMISOR?.trim().toLowerCase();
  if (!valor) return 'keycloak';
  if ((EMISORES_TOKEN_COMENSAL as readonly string[]).includes(valor)) {
    return valor as EmisorTokenComensal;
  }
  throw new Error(
    `COMENSAL_TOKEN_EMISOR debe ser ${EMISORES_TOKEN_COMENSAL.join(' o ')}`,
  );
}

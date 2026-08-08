import type { ApiErrorBody } from '@/types/usuario';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Wrapper de fetch que adjunta el Bearer token y normaliza errores.
 * El backend (ver KeycloakAdminService / UsuariosService) devuelve el shape
 * estándar de Nest para excepciones: { statusCode, message, error }. Esto
 * incluye el 409 de RF.19 (último Admin) y el 409 de username/email
 * duplicado — ambos llegan acá como ApiError con el mensaje ya redactado
 * por el backend para mostrarse tal cual al usuario.
 */
export async function apiFetch<T>(
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  if (!token) {
    throw new ApiError(401, 'No hay sesión activa');
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = await res.json();
    } catch {
      // el body puede no ser JSON en errores de infraestructura (502, etc.)
    }
    const message = Array.isArray(body?.message)
      ? body!.message.join(', ')
      : (body?.message ?? `Error ${res.status}`);
    throw new ApiError(res.status, message);
  }

  // 204 No Content (no aplica hoy en /usuarios, pero por las dudas)
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}
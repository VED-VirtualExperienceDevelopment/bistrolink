import { HttpException } from '@nestjs/common';
import {
  circuitBreaker,
  ConsecutiveBreaker,
  handleWhen,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

export interface OpcionesResiliencia {
  timeoutMs: number;
  halfOpenAfterMs: number;
  fallosParaAbrir: number;
}

const OPCIONES_POR_DEFECTO: OpcionesResiliencia = {
  timeoutMs: 10_000,
  halfOpenAfterMs: 30_000,
  fallosParaAbrir: 3,
};

// Solo cuentan como fallo de la pasarela los errores técnicos (timeouts,
// caídas, 5xx). Un dato inválido del cliente (4xx) no debe abrir el
// circuito para todos los demás comensales.
const esFalloTecnico = (error: unknown) =>
  !(error instanceof HttpException) || error.getStatus() >= 500;

// BL-77: pasarela lenta (>10s) o caída => modo degradado. Tras 3 fallos
// seguidos el circuito se abre 30s: no se intenta llamar a la pasarela.
export function crearPoliticaResiliencia(
  opciones: Partial<OpcionesResiliencia> = {},
) {
  const { timeoutMs, halfOpenAfterMs, fallosParaAbrir } = {
    ...OPCIONES_POR_DEFECTO,
    ...opciones,
  };
  const politicaTimeout = timeout(timeoutMs, TimeoutStrategy.Aggressive);
  const politicaCircuito = circuitBreaker(handleWhen(esFalloTecnico), {
    halfOpenAfter: halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(fallosParaAbrir),
  });
  // El breaker va AFUERA y el timeout ADENTRO, así el breaker cuenta los
  // timeouts como fallos.
  return wrap(politicaCircuito, politicaTimeout);
}

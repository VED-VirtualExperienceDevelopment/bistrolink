import {
  circuitBreaker,
  ConsecutiveBreaker,
  handleAll,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

// BL-77: pasarela lenta (>10s) o caída => modo degradado. Tras 3 fallos
// seguidos el circuito se abre 30s: no se intenta llamar a la pasarela.
export function crearPoliticaResiliencia() {
  const politicaTimeout = timeout(10_000, TimeoutStrategy.Aggressive);
  const politicaCircuito = circuitBreaker(handleAll, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(3),
  });
  // El breaker va AFUERA y el timeout ADENTRO, así el breaker cuenta los
  // timeouts como fallos (verificado: al revés, nunca se abría).
  return wrap(politicaCircuito, politicaTimeout);
}

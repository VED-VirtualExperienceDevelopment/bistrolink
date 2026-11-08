/**
 * BL-76: pantallas a las que Plexo redirige tras el checkout
 * (settings.redirects.defaultUrl / cancelUrl en plexo.gateway.ts).
 * Son Server Components sin datos: alcanza con verificar que renderizan
 * el mensaje correcto y que exportan su título.
 */
import PagoCompletadoPage, {
  metadata as metaCompletado,
} from '@/app/pago-completado/page';
import PagoCanceladoPage, {
  metadata as metaCancelado,
} from '@/app/pago-cancelado/page';

function textoDe(nodo: unknown): string {
  if (typeof nodo === 'string') return nodo;
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(' ');
  if (nodo && typeof nodo === 'object' && 'props' in nodo) {
    return textoDe((nodo as { props: { children?: unknown } }).props.children);
  }
  return '';
}

describe('pantallas de resultado de pago (BL-76)', () => {
  it('pago completado NO afirma que el pago salió bien (Plexo redirige acá también tras un rechazo)', () => {
    expect(metaCompletado.title).toBe('Verificando tu pago');
    const texto = textoDe(PagoCompletadoPage());
    expect(texto).toContain('Estamos verificando tu pago');
    expect(texto).toContain('no se realizó ningún cobro');
    expect(texto).not.toContain('Pago recibido');
  });

  it('pago cancelado aclara que no hubo cobro', () => {
    expect(metaCancelado.title).toBe('Pago cancelado');
    expect(textoDe(PagoCanceladoPage())).toContain('No se realizó ningún cobro');
  });
});
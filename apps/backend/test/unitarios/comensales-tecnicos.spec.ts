import { comensalesTecnicosABorrar } from '../../src/plataforma/comensales-tecnicos';

// BL-581: el script borrar-comensales-tecnicos.ts borra solo usuarios que
// son, sin duda, comensales técnicos. Nunca una cuenta del personal.

const usuario = (username: string, roles: string[], id = username) => ({
  id,
  username,
  tenantId: '11111111-1111-1111-1111-111111111111',
  roles,
});

describe('comensales técnicos para borrar (BL-581)', () => {
  it('[TC-U-640] borra solo los «comensal-…» con el rol COMENSAL y sin roles del personal; el resto queda para revisar a mano', () => {
    const tecnicoAnterior = usuario(
      'comensal-11111111-1111-1111-1111-111111111111',
      ['COMENSAL', 'default-roles-bistrolink'],
    );
    const tecnicoBl271 = usuario('comensal-3f9a0c1d2e4b5a6978c0d1e2', [
      'COMENSAL',
    ]);
    const conRolDelPersonal = usuario('comensal-raro', ['COMENSAL', 'ADMIN']);
    const sinPrefijo = usuario('mozo-test', ['COMENSAL']);
    const sinRolComensal = usuario('comensal-sin-rol', ['MOZO']);

    const { borrar, revisarAMano } = comensalesTecnicosABorrar([
      tecnicoAnterior,
      tecnicoBl271,
      conRolDelPersonal,
      sinPrefijo,
      sinRolComensal,
    ]);

    expect(borrar).toEqual([tecnicoAnterior, tecnicoBl271]);
    expect(revisarAMano).toEqual([
      conRolDelPersonal,
      sinPrefijo,
      sinRolComensal,
    ]);
  });

  it('sin usuarios no hay nada que borrar', () => {
    expect(comensalesTecnicosABorrar([])).toEqual({
      borrar: [],
      revisarAMano: [],
    });
  });
});

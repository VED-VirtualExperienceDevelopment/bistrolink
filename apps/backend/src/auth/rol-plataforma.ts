/**
 * BL-163 (HU-027): rol de los usuarios del equipo que dan de alta
 * establecimientos. No pertenece a ningún tenant y solo sirve en
 * /plataforma/* (PlataformaJwtStrategy). Archivo aparte para que los
 * servicios lo usen sin cargar Passport.
 */
export const ROL_PLATAFORMA = 'PLATAFORMA';

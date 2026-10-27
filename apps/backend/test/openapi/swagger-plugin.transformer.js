// BL-211: el plugin de @nestjs/swagger (el mismo que usa `nest build`, ver
// nest-cli.json) como transformer de ts-jest, para que el test que genera el
// contrato vea los DTOs igual que la app compilada. Formato que pide ts-jest:
// https://docs.nestjs.com/openapi/cli-plugin#integration-with-ts-jest-e2e-tests
const transformer = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-transformer';
// Cambiar la versión invalida el caché de ts-jest si cambian las opciones.
module.exports.version = 1;

module.exports.factory = (cs) =>
  transformer.before(
    { classValidatorShim: true, introspectComments: true },
    cs.program,
  );

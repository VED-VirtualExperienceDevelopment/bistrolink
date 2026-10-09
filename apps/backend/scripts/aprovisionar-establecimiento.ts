import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { PlataformaModule } from '../src/plataforma/plataforma.module';
import {
  AprovisionamientoService,
  CredencialesIniciales,
} from '../src/plataforma/aprovisionamiento.service';
import { AprovisionarEstablecimientoDto } from '../src/plataforma/dto/aprovisionar-establecimiento.dto';

/**
 * BL-163 (HU-027), entrega 1: alta de un establecimiento desde un archivo
 * JSON. Usa el mismo servicio que el futuro endpoint de plataforma.
 *
 * Uso (desde la raíz del repo):
 *   npm run aprovisionar --workspace=backend -- scripts/datos/<archivo>.json
 *
 * Variables de entorno (las lee del .env del backend):
 * - RUNTIME_DATABASE_URL: la base, con el rol de la aplicación (RLS).
 * - KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET:
 *   la cuenta de servicio de bistrolink-backend.
 * - KEYCLOAK_COMENSAL_PASSWORD: contraseña del comensal técnico.
 * - Las que nombre el archivo en `admin.passwordEnv` y `cocina.passwordEnv`
 *   (por ejemplo DEV_DAIANA_ADMIN_PASSWORD): se cargan en la terminal antes
 *   de correr el script, desde KeePass. Si una no está, se genera una
 *   contraseña temporal.
 *
 * Es idempotente: correrlo de nuevo con el mismo archivo no duplica nada ni
 * cambia contraseñas. Si falla a mitad de camino, se vuelve a correr.
 *
 * Contraseñas generadas: se escriben en apps/backend/.aprovisionamiento/
 * (ignorada por git), nunca en la consola. Pasarlas a KeePass y borrar el
 * archivo.
 */

interface UsuarioEnArchivo {
  username: string;
  email?: string;
  nombre?: string;
  apellido?: string;
  /** Nombre de la variable de entorno con la contraseña (nunca el valor). */
  passwordEnv?: string;
}

type EstablecimientoEnArchivo = Omit<
  AprovisionarEstablecimientoDto,
  'admin' | 'cocina'
> & {
  admin: UsuarioEnArchivo;
  cocina: UsuarioEnArchivo;
};

const CARPETA_CREDENCIALES = resolve(__dirname, '..', '.aprovisionamiento');

function leerPassword(
  usuario: UsuarioEnArchivo,
  rol: string,
): string | undefined {
  if (!usuario.passwordEnv) {
    return undefined;
  }
  const valor = process.env[usuario.passwordEnv];
  if (!valor) {
    console.warn(
      `⚠️  Falta la variable de entorno con la contraseña del usuario ${rol}: si es nuevo, se le genera una contraseña temporal.`,
    );
    return undefined;
  }
  return valor;
}

function aplanarErrores(errores: ValidationError[], prefijo = ''): string[] {
  return errores.flatMap((e) => {
    const ruta = prefijo ? `${prefijo}.${e.property}` : e.property;
    const propios = Object.values(e.constraints ?? {}).map(
      (m) => `${ruta}: ${m}`,
    );
    return [...propios, ...aplanarErrores(e.children ?? [], ruta)];
  });
}

async function main() {
  const [, , rutaArchivo] = process.argv;
  if (!rutaArchivo) {
    console.error(
      'Uso: npm run aprovisionar --workspace=backend -- scripts/datos/<archivo>.json',
    );
    process.exit(1);
  }

  const archivo = JSON.parse(
    readFileSync(resolve(rutaArchivo), 'utf8'),
  ) as EstablecimientoEnArchivo;

  const credenciales: CredencialesIniciales = {
    admin: leerPassword(archivo.admin, 'admin'),
    cocina: leerPassword(archivo.cocina, 'cocina'),
  };

  // passwordEnv no es parte del DTO: se quita antes de validar.
  const { admin, cocina, ...resto } = archivo;
  const sinPasswordEnv = (u?: UsuarioEnArchivo) => {
    if (!u) return u;
    const datos: Partial<UsuarioEnArchivo> = { ...u };
    delete datos.passwordEnv;
    return datos;
  };
  const dto = plainToInstance(AprovisionarEstablecimientoDto, {
    ...resto,
    admin: sinPasswordEnv(admin),
    cocina: sinPasswordEnv(cocina),
  });
  const errores = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errores.length > 0) {
    console.error('❌ El archivo tiene datos inválidos:');
    for (const linea of aplanarErrores(errores)) {
      console.error(`   - ${linea}`);
    }
    process.exit(1);
  }

  // Nest sin servidor HTTP: mismo módulo y mismo servicio que el endpoint.
  const app = await NestFactory.createApplicationContext(PlataformaModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    // resolve() y no get(): el servicio depende de TenantPrismaService, que
    // es por request.
    const servicio = await app.resolve(AprovisionamientoService);
    const resultado = await servicio.aprovisionar(
      dto,
      credenciales,
      `script:${userInfo().username}`,
    );

    const marca = (creado: boolean) => (creado ? 'creado' : 'ya existía');
    console.log('\n✅ Establecimiento listo');
    console.log(
      `   Tenant       ${resultado.tenantId} (${marca(resultado.tenantCreado)})`,
    );
    console.log(
      `   Restaurante  ${resultado.restauranteId} (${marca(resultado.restauranteCreado)})`,
    );
    console.log(`   Mesa virtual ${resultado.mesaVirtualId}`);
    for (const u of resultado.usuarios) {
      const perfil = u.perfilCompletado ? ', perfil completado' : '';
      console.log(
        `   ${u.rol.padEnd(12)} ${u.username} (${marca(u.creado)}${perfil})`,
      );
    }

    const generadas = resultado.usuarios.filter((u) => u.passwordGenerada);
    if (generadas.length > 0) {
      mkdirSync(CARPETA_CREDENCIALES, { recursive: true, mode: 0o700 });
      const rutaCredenciales = join(
        CARPETA_CREDENCIALES,
        `${resultado.tenantId}-credenciales.json`,
      );
      writeFileSync(
        rutaCredenciales,
        JSON.stringify(
          generadas.map((u) => ({
            rol: u.rol,
            username: u.username,
            passwordTemporal: u.passwordGenerada,
          })),
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log(
        `\n🔑 Contraseñas temporales en ${rutaCredenciales}\n   Pasalas a KeePass y borrá el archivo. Keycloak pide cambiarlas en el primer login.`,
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });

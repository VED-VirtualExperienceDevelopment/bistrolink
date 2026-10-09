import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { PlataformaModule } from '../src/plataforma/plataforma.module';
import { UsuarioPlataformaService } from '../src/plataforma/usuario-plataforma.service';
import { CrearUsuarioPlataformaDto } from '../src/plataforma/dto/crear-usuario-plataforma.dto';

/**
 * BL-163 (HU-027), entrega 2: alta de un usuario de plataforma (rol
 * PLATAFORMA), uno por persona del equipo.
 *
 * Uso (desde la raíz del repo):
 *   npm run crear-usuario-plataforma --workspace=backend -- <username> <email> <nombre> <apellido>
 *   (ejemplo: dev-daiana-plataforma daiana@ejemplo.com Daiana Silvera)
 *
 * Contraseña: si está la variable PLATAFORMA_PASSWORD (cargada en la
 * terminal, nunca en el .env), queda como contraseña permanente. Si no, se
 * genera una temporal y se escribe en apps/backend/.aprovisionamiento/
 * (ignorada por git), nunca en la consola.
 *
 * En el primer login Keycloak obliga a configurar el OTP.
 * Es idempotente: si el usuario ya existe, solo le asegura el rol.
 */

const CARPETA_CREDENCIALES = resolve(__dirname, '..', '.aprovisionamiento');

async function main() {
  const [, , username, email, nombre, apellido] = process.argv;
  const dto = plainToInstance(CrearUsuarioPlataformaDto, {
    username,
    email,
    nombre,
    apellido,
  });
  const errores = await validate(dto);
  if (errores.length > 0) {
    console.error(
      'Uso: npm run crear-usuario-plataforma --workspace=backend -- <username> <email> <nombre> <apellido>',
    );
    for (const e of errores) {
      for (const mensaje of Object.values(e.constraints ?? {})) {
        console.error(`   - ${e.property}: ${mensaje}`);
      }
    }
    process.exit(1);
  }

  const password = process.env.PLATAFORMA_PASSWORD || undefined;

  const app = await NestFactory.createApplicationContext(PlataformaModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const servicio = app.get(UsuarioPlataformaService);
    const resultado = await servicio.asegurar(dto, password);

    const estado = resultado.creado
      ? 'creado'
      : `ya existía${resultado.perfilCompletado ? ', perfil completado' : ''}`;
    console.log(`\n✅ Usuario de plataforma ${dto.username} (${estado})`);
    if (resultado.creado) {
      console.log('   En el primer login Keycloak pide configurar el OTP.');
    }

    if (resultado.passwordGenerada) {
      mkdirSync(CARPETA_CREDENCIALES, { recursive: true, mode: 0o700 });
      const ruta = join(
        CARPETA_CREDENCIALES,
        `${dto.username}-credenciales.json`,
      );
      writeFileSync(
        ruta,
        JSON.stringify(
          {
            username: dto.username,
            passwordTemporal: resultado.passwordGenerada,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      console.log(
        `\n🔑 Contraseña temporal en ${ruta}\n   Pasala a KeePass y borrá el archivo. Keycloak pide cambiarla en el primer login.`,
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

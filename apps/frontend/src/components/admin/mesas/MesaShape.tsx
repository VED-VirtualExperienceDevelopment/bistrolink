'use client';

import { forwardRef } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { EstadoMesa, FormaMesa } from '@/types/mesa';
import { COLOR_POR_ESTADO } from './mapa-mesas.utils';

const COLOR_SELECCION = '#8069BF'; // primary de tailwind.config.ts, para consistencia visual con el resto del admin
const COLOR_BORDE = '#494551'; // on-surface-variant

export interface MesaShapeProps {
  numero: number;
  estado: EstadoMesa;
  x: number;
  y: number;
  forma: FormaMesa;
  ancho: number;
  alto: number;
  rotacion: number;
  seleccionada: boolean;
  editable: boolean;
  onSeleccionar: () => void;
  onArrastrar: (x: number, y: number) => void;
  onTransformar: (cambios: { x: number; y: number; ancho: number; alto: number; rotacion: number }) => void;
  onEditarNumero: () => void;
}

/**
 * Cada mesa es un Group de Konva (no un Rect/Circle suelto) para que el
 * Transformer pueda escalar/rotar la forma y el número como una sola
 * unidad. La forma vive centrada en el origen del Group (offset = mitad de
 * sus dimensiones) para que "x, y" siempre represente el CENTRO de la mesa
 * sin importar si es un círculo o un rectángulo — más natural para un mapa
 * de mesas, y hace que la rotación gire alrededor del centro en vez de una
 * esquina.
 *
 * El número se contra-rota (rotation={-rotacion}) para quedar siempre
 * legible en pantalla aunque la mesa esté rotada — girar los dígitos junto
 * con una mesa rectangular no ayuda a nadie a leerlos.
 */
export const MesaShape = forwardRef<Konva.Group, MesaShapeProps>(function MesaShape(
  {
    numero,
    estado,
    x,
    y,
    forma,
    ancho,
    alto,
    rotacion,
    seleccionada,
    editable,
    onSeleccionar,
    onArrastrar,
    onTransformar,
    onEditarNumero,
  },
  ref,
) {
  const fill = COLOR_POR_ESTADO[estado];
  const strokeWidth = seleccionada ? 3 : 1.5;
  const stroke = seleccionada ? COLOR_SELECCION : COLOR_BORDE;

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = e.target as Konva.Group;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Konva expresa un resize como escala (scaleX/scaleY), no como cambio de
    // width/height — si no la "consumimos" acá reseteándola a 1, el próximo
    // resize se compone sobre una escala que ya no arranca en 1 y las
    // dimensiones divergen de lo que se ve en pantalla.
    node.scaleX(1);
    node.scaleY(1);

    onTransformar({
      x: node.x(),
      y: node.y(),
      ancho: Math.max(20, ancho * scaleX),
      alto: Math.max(20, alto * scaleY),
      rotacion: node.rotation(),
    });
  };

  return (
    <Group
      ref={ref}
      x={x}
      y={y}
      rotation={rotacion}
      draggable={editable}
      onClick={onSeleccionar}
      onTap={onSeleccionar}
      onDragEnd={(e) => onArrastrar(e.target.x(), e.target.y())}
      onDblClick={editable ? onEditarNumero : undefined}
      onDblTap={editable ? onEditarNumero : undefined}
      onTransformEnd={handleTransformEnd}
    >
      {forma === 'CIRCULO' ? (
        <Circle radius={ancho / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      ) : (
        <Rect
          width={ancho}
          height={alto}
          offsetX={ancho / 2}
          offsetY={alto / 2}
          cornerRadius={forma === 'RECTANGULO' ? 6 : 4}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      <Text
        text={String(numero)}
        rotation={-rotacion}
        width={80}
        align="center"
        offsetX={40}
        offsetY={8}
        fontSize={16}
        fontStyle="bold"
        fill="#ffffff"
        listening={false}
      />
    </Group>
  );
});
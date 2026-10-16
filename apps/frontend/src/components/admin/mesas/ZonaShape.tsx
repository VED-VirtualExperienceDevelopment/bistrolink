"use client";

import { forwardRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { ZonaPlano } from "@/types/plano";
import { limitarCentroEnPantalla, type Lienzo } from "./mapa-mesas.utils";
import {
  dimensionesZonaTrasTransformar,
  semiExtensionZona,
} from "./plano.utils";

const COLOR_RELLENO = "rgba(128, 105, 191, 0.08)"; // primary, muy suave
const COLOR_BORDE = "#79747E"; // outline
const COLOR_SELECCION = "#8069BF"; // primary
const COLOR_TEXTO = "#494551"; // on-surface-variant

export interface ZonaShapeProps {
  zona: ZonaPlano;
  seleccionada: boolean;
  editable: boolean;
  lienzo: Lienzo;
  zoom: number;
  onSeleccionar: () => void;
  onCambiar: (cambios: Partial<ZonaPlano>) => void;
}

/**
 * HU-028 (BL-173): zona del salón (Patio, Terraza, Barra…). Es un
 * rectángulo con nombre que se dibuja DEBAJO de las mesas: el editor la
 * agrega a la capa antes que ellas. Como MesaShape, x / y son el centro.
 * No se rota: las zonas siempre quedan alineadas con el salón.
 */
export const ZonaShape = forwardRef<Konva.Group, ZonaShapeProps>(
  function ZonaShape(
    { zona, seleccionada, editable, lienzo, zoom, onSeleccionar, onCambiar },
    ref,
  ) {
    const { ancho, alto } = zona;

    const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target as Konva.Group;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      // Igual que en MesaShape: se "consume" la escala para que el próximo
      // resize arranque de 1.
      node.scaleX(1);
      node.scaleY(1);
      onCambiar({
        x: node.x(),
        y: node.y(),
        ...dimensionesZonaTrasTransformar(ancho, alto, scaleX, scaleY),
      });
    };

    return (
      <Group
        ref={ref}
        x={zona.x}
        y={zona.y}
        draggable={editable}
        // En modo solo lectura la zona no recibe clics: así un clic sobre
        // ella llega al fondo del mapa, como si no estuviera.
        listening={editable}
        dragBoundFunc={(pos) =>
          limitarCentroEnPantalla(pos, semiExtensionZona(zona), lienzo, zoom)
        }
        onClick={onSeleccionar}
        onTap={onSeleccionar}
        onDragEnd={(e) => onCambiar({ x: e.target.x(), y: e.target.y() })}
        onTransformEnd={handleTransformEnd}
      >
        <Rect
          width={ancho}
          height={alto}
          offsetX={ancho / 2}
          offsetY={alto / 2}
          cornerRadius={8}
          fill={COLOR_RELLENO}
          stroke={seleccionada ? COLOR_SELECCION : COLOR_BORDE}
          strokeWidth={seleccionada ? 2.5 : 1.5}
          dash={[8, 6]}
        />
        <Text
          text={zona.etiqueta}
          x={-ancho / 2 + 10}
          y={-alto / 2 + 8}
          width={Math.max(ancho - 20, 0)}
          wrap="none"
          ellipsis
          fontSize={14}
          fontStyle="bold"
          fill={COLOR_TEXTO}
          listening={false}
        />
      </Group>
    );
  },
);

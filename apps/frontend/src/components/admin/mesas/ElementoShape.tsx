"use client";

import { forwardRef } from "react";
import { Group, Path, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { ElementoPlano } from "@/types/plano";
import { limitarCentroEnPantalla, type Lienzo } from "./mapa-mesas.utils";
import { ICONO_POR_ELEMENTO } from "./plano-iconos";
import {
  dimensionesElementoTrasTransformar,
  disposicionElemento,
  semiExtensionElemento,
} from "./plano.utils";

const COLOR_RELLENO = "#E7E0EC"; // surface-variant
const COLOR_BORDE = "#79747E"; // outline
const COLOR_SELECCION = "#8069BF"; // primary
const COLOR_CONTENIDO = "#494551"; // on-surface-variant

export interface ElementoShapeProps {
  elemento: ElementoPlano;
  seleccionado: boolean;
  editable: boolean;
  lienzo: Lienzo;
  zoom: number;
  onSeleccionar: () => void;
  onCambiar: (cambios: Partial<ElementoPlano>) => void;
}

/**
 * HU-028 (BL-173): elemento fijo del salón (puerta, baño, cocina, caja,
 * barra). Mismo esquema que MesaShape: Group centrado en x / y que se
 * arrastra, se agranda y se rota con el Transformer, acotado al lienzo con
 * las funciones de BL-58. El ícono y el nombre se contra-rotan para quedar
 * siempre derechos.
 */
export const ElementoShape = forwardRef<Konva.Group, ElementoShapeProps>(
  function ElementoShape(
    {
      elemento,
      seleccionado,
      editable,
      lienzo,
      zoom,
      onSeleccionar,
      onCambiar,
    },
    ref,
  ) {
    const { ancho, alto, rotacion } = elemento;
    const { etiqueta, trazo } = ICONO_POR_ELEMENTO[elemento.tipo];
    const disposicion = disposicionElemento(elemento, etiqueta);
    const escalaIcono = disposicion.icono.tamano / 24; // trazo de 24x24

    const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target as Konva.Group;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      onCambiar({
        x: node.x(),
        y: node.y(),
        ...dimensionesElementoTrasTransformar(ancho, alto, scaleX, scaleY),
        rotacion: node.rotation(),
      });
    };

    return (
      <Group
        ref={ref}
        x={elemento.x}
        y={elemento.y}
        rotation={rotacion}
        draggable={editable}
        listening={editable}
        dragBoundFunc={(pos) =>
          limitarCentroEnPantalla(
            pos,
            semiExtensionElemento(elemento),
            lienzo,
            zoom,
          )
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
          cornerRadius={4}
          fill={COLOR_RELLENO}
          stroke={seleccionado ? COLOR_SELECCION : COLOR_BORDE}
          strokeWidth={seleccionado ? 2.5 : 1.5}
        />
        <Group rotation={-rotacion} listening={false}>
          <Path
            data={trazo}
            x={disposicion.icono.x}
            y={disposicion.icono.y}
            scaleX={escalaIcono}
            scaleY={escalaIcono}
            fill={COLOR_CONTENIDO}
          />
          {disposicion.etiqueta && (
            <Text
              text={etiqueta}
              x={disposicion.etiqueta.x}
              y={disposicion.etiqueta.y}
              width={disposicion.etiqueta.ancho}
              align={disposicion.etiqueta.alineacion}
              wrap="none"
              fontSize={12}
              fontStyle="bold"
              fill={COLOR_CONTENIDO}
            />
          )}
        </Group>
      </Group>
    );
  },
);

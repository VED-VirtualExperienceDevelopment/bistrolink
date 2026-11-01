'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  anuncioCancelado,
  anuncioLevantado,
  anuncioSobre,
  anuncioSoltado,
  INSTRUCCIONES_ARRASTRE,
} from './gestion-carta.utils';

interface ListaOrdenableProps {
  /** Ids en el orden en que se muestran. */
  readonly ids: readonly string[];
  /** Nombre de cada elemento, para los avisos al lector de pantalla. */
  readonly nombreDe: (id: string) => string;
  /** «lista» (categorías, una debajo de otra) o «grilla» (ítems, en columnas). */
  readonly disposicion: 'lista' | 'grilla';
  /** Se soltó `id` en el lugar de `destinoId`. */
  readonly onSoltar: (id: string, destinoId: string) => void;
  readonly children: ReactNode;
}

/**
 * BL-399 (parte 2): lista que se ordena arrastrando desde la manija, con el
 * mouse, con el dedo o con el teclado (Espacio para levantar, flechas para
 * mover, Espacio para soltar, Escape para cancelar). Los avisos al lector
 * de pantalla están en español.
 */
export function ListaOrdenable({
  ids,
  nombreDe,
  disposicion,
  onSoltar,
  children,
}: ListaOrdenableProps) {
  // Id fijo: si no, dnd-kit genera uno distinto en el servidor y en el
  // navegador, y React avisa que no coinciden.
  const idContexto = useId();
  const sensores = useSensors(
    // 5 px de margen: un toque o un clic en la manija no empieza a arrastrar.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const total = ids.length;
  const posicion = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const nombre = (id: UniqueIdentifier) => nombreDe(String(id));

  const anuncios: Announcements = {
    onDragStart: ({ active }) =>
      anuncioLevantado(nombre(active.id), posicion(active.id), total),
    onDragOver: ({ active, over }) =>
      over
        ? anuncioSobre(nombre(active.id), posicion(over.id), total)
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? anuncioSoltado(nombre(active.id), posicion(over.id), total)
        : anuncioCancelado(nombre(active.id)),
    onDragCancel: ({ active }) => anuncioCancelado(nombre(active.id)),
  };

  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onSoltar(String(active.id), String(over.id));
    }
  };

  return (
    <DndContext
      id={idContexto}
      sensors={sensores}
      collisionDetection={closestCenter}
      onDragEnd={alSoltar}
      accessibility={{
        announcements: anuncios,
        screenReaderInstructions: { draggable: INSTRUCCIONES_ARRASTRE },
      }}
    >
      <SortableContext
        items={[...ids]}
        strategy={
          disposicion === 'grilla'
            ? rectSortingStrategy
            : verticalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface PartesOrdenable {
  /** Para el elemento que se mueve (la sección o la tarjeta). */
  readonly ref: (elemento: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly arrastrando: boolean;
  /** La manija «⠿», o null si no se puede ordenar. */
  readonly manija: ReactNode;
}

interface OrdenableProps {
  readonly id: string;
  /** Para el lector de pantalla: «Mover Flan». */
  readonly etiqueta: string;
  /** Sin permiso o con filtros: no se muestra la manija. */
  readonly deshabilitado: boolean;
  readonly children: (partes: PartesOrdenable) => ReactNode;
}

/**
 * BL-399 (parte 2): un elemento de una ListaOrdenable. Le da al contenido
 * la referencia, el estilo mientras se mueve y la manija para arrastrar
 * (48 px de alto, como el resto de los controles).
 */
export function Ordenable({
  id,
  etiqueta,
  deshabilitado,
  children,
}: OrdenableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: deshabilitado,
    attributes: { roleDescription: 'elemento ordenable' },
  });

  const manija = deshabilitado ? null : (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={etiqueta}
      {...attributes}
      {...listeners}
      // touch-none: en el celular, arrastrar la manija no desplaza la página.
      className="flex h-12 w-8 flex-none cursor-grab touch-none items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
    >
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        drag_indicator
      </span>
    </button>
  );

  return children({
    ref: setNodeRef,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
      // Lo que se arrastra pasa por encima del resto.
      position: 'relative',
      zIndex: isDragging ? 30 : undefined,
    },
    arrastrando: isDragging,
    manija,
  });
}

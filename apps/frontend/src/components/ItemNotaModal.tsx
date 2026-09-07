'use client';

import { useState, useEffect, useRef } from 'react';
import { Inter, Public_Sans } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], weight: ['600', '700'] });
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['500', '600'] });

interface ItemNotaModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly itemName: string;
  readonly currentNote: string;
  readonly onSave: (note: string) => void;
}

const MAX_CHARS = 300;
const WARNING_THRESHOLD = 0.9;

export default function ItemNotaModal({
  isOpen,
  onClose,
  itemName,
  currentNote,
  onSave,
}: ItemNotaModalProps) {
  const [note, setNote] = useState(currentNote);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // El elemento <dialog> nativo maneja la tecla Escape automáticamente.
  // Solo necesitamos controlar su apertura/cierre y el estado del texto.
  useEffect(() => {
    if (isOpen) {
      setNote(currentNote);
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [isOpen, currentNote]);

  const charCount = note.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isNearLimit = charCount >= MAX_CHARS * WARNING_THRESHOLD && !isOverLimit;

  const handleSave = () => {
    if (!isOverLimit) {
      onSave(note.trim() || '');
      onClose();
    }
  };

  // Detectar clic en el backdrop (fuera del contenido del modal)
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  const getCounterColor = () => {
    if (isOverLimit) return 'text-[#BA1A1A]';
    if (isNearLimit) return 'text-[#755b00]';
    return 'text-[#494551]';
  };

  const getBorderClasses = () => {
    if (isOverLimit) return 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20';
    if (isNearLimit) return 'border-2 border-[#755b00] bg-[#F1ECF4] focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20';
    return 'border-2 border-[#cac4d2] bg-[#F1ECF4] focus:border-[#644da1] focus:ring-2 focus:ring-[#644da1]/20';
  };

  if (!isOpen) return null;

  return (
    // FIX SONARQUBE: Usamos el elemento nativo <dialog>. 
    // Tailwind 'open:flex' lo muestra cuando tiene el atributo 'open', y 'hidden' lo oculta por defecto.
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      className="fixed inset-0 z-50 m-0 p-0 w-full h-full bg-black/40 backdrop-blur-sm open:flex hidden items-end sm:items-center justify-center"
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3
            id="item-note-title"
            className={`${inter.className} text-xl font-semibold text-[#1C1B20]`}
          >
            Nota para: {itemName}
          </h3>
          <button
            onClick={onClose}
            className="text-[#494551] hover:text-[#1C1B20] transition-colors"
            aria-label="Cerrar modal"
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej: Sin cebolla, poca sal, bien cocido..."
          className={`w-full h-32 p-3 rounded-lg ${inter.className} text-base resize-none outline-none transition-all duration-200 text-[#1C1B20] placeholder:text-[#7a7582] ${getBorderClasses()}`}
          maxLength={MAX_CHARS + 20}
          autoFocus
        />

        <div className="flex justify-end mt-2">
          <span className={`${publicSans.className} text-sm font-semibold ${getCounterColor()}`}>
            {charCount}/{MAX_CHARS}
          </span>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className={`flex-1 px-4 py-3 rounded-lg ${publicSans.className} font-semibold transition-colors bg-[#F1ECF4] text-[#644da1] hover:bg-[#ebe6ee]`}
            type="button"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isOverLimit}
            className={`flex-1 px-4 py-3 rounded-lg ${publicSans.className} font-semibold text-white transition-all ${isOverLimit ? 'bg-[#cac4d2] cursor-not-allowed opacity-50' : 'bg-[#644da1] hover:opacity-90'}`}
            type="button"
          >
            Guardar nota
          </button>
        </div>
      </div>
    </dialog>
  );
}
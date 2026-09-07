'use client';

import { useState, useEffect, useRef } from 'react';
import { Inter, Public_Sans } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], weight: ['600', '700'] });
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['500', '600'] });

interface ItemNotaModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  currentNote: string;
  onSave: (note: string) => void;
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
  const [isSelectingText, setIsSelectingText] = useState(false);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote(currentNote);
    }
  }, [isOpen, currentNote]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Detectar inicio de selección de texto
  const handleMouseDown = (e: React.MouseEvent) => {
    // Si el clic es en el textarea, marcar que se está seleccionando
    if (e.target === textareaRef.current) {
      setIsSelectingText(true);
    }
  };

  // Detectar fin de selección de texto
  const handleMouseUp = () => {
    // Pequeño delay para permitir que la selección se complete
    setTimeout(() => {
      setIsSelectingText(false);
    }, 100);
  };

  // Detectar si hay texto seleccionado
  const handleMouseUpWithSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      setIsSelectingText(true);
      setTimeout(() => setIsSelectingText(false), 200);
    }
  };

  if (!isOpen) return null;

  const charCount = note.length;
  const isOverLimit = charCount > MAX_CHARS;
  const isNearLimit = charCount >= MAX_CHARS * WARNING_THRESHOLD && !isOverLimit;

  const handleSave = () => {
    if (!isOverLimit) {
      onSave(note.trim() || '');
      onClose();
    }
  };

  // FIX: Solo cerrar si:
  // 1. El clic fue EXACTAMENTE en el backdrop
  // 2. NO se está seleccionando texto
  // 3. NO se hizo clic en un elemento interactivo
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // No cerrar si se está seleccionando texto
    if (isSelectingText) {
      return;
    }
    
    // No cerrar si el clic fue en el contenido del modal
    if (e.target !== e.currentTarget) {
      return;
    }
    
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-note-title"
    >
      {/* Contenido del modal */}
      <div 
        ref={modalContentRef}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
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

        {/* Textarea con handlers específicos */}
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUpWithSelection}
          onSelect={handleMouseUpWithSelection}
          placeholder="Ej: Sin cebolla, poca sal, bien cocido..."
          className={`w-full h-32 p-3 rounded-lg font-[Inter] text-base resize-none outline-none transition-all duration-200 text-[#1C1B20] placeholder:text-[#7a7582]
            ${
              isOverLimit
                ? 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20'
                : isNearLimit
                ? 'border-2 border-[#755b00] bg-[#F1ECF4] focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20'
                : 'border-2 border-[#cac4d2] bg-[#F1ECF4] focus:border-[#644da1] focus:ring-2 focus:ring-[#644da1]/20'
            }`}
          maxLength={MAX_CHARS + 20}
          autoFocus
        />

        {/* Contador de caracteres */}
        <div className="flex justify-end mt-2">
          <span
            className={`${publicSans.className} text-sm font-semibold
              ${
                isOverLimit
                  ? 'text-[#BA1A1A]'
                  : isNearLimit
                  ? 'text-[#755b00]'
                  : 'text-[#494551]'
              }`}
          >
            {charCount}/{MAX_CHARS}
          </span>
        </div>

        {/* Botones de acción */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className={`flex-1 px-4 py-3 rounded-lg ${publicSans.className} font-semibold transition-colors
              bg-[#F1ECF4] text-[#644da1] hover:bg-[#ebe6ee]`}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isOverLimit}
            className={`flex-1 px-4 py-3 rounded-lg ${publicSans.className} font-semibold text-white transition-all
              ${
                isOverLimit
                  ? 'bg-[#cac4d2] cursor-not-allowed opacity-50'
                  : 'bg-[#644da1] hover:opacity-90'
              }`}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  );
}
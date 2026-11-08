// BL-222: TypeScript 6 (el que usa VS Code) exige declarar los imports de CSS
// sin variable, como import "./globals.css" en app/layout.tsx. Next.js no
// trae esa declaración; con TypeScript 5 (el del proyecto) no hace falta.
declare module '*.css';

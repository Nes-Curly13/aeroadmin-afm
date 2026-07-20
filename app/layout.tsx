import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800", "900"]
});

export const metadata: Metadata = {
  title: "AeroAdmin AFM",
  description:
    "Panel admin y GIS para operaciones de fumigación con drones DJI Agras. Trazabilidad de parcelas, vuelos y alertas."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={bodyFont.variable}>
        {children}
        {/*
          Track B v1.1 — MEJORA 3: atajos de teclado globales (g+p/m/t/d, ?).
          Client component; no se renderiza nada hasta que se abre el modal.
        */}
        <KeyboardShortcuts />
      </body>
    </html>
  );
}

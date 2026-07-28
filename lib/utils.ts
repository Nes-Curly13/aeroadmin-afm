import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — utility estándar de shadcn (clsx + tailwind-merge).
 *
 * Permite componer clases Tailwind condicionalmente y resolver
 * conflictos (e.g. `p-2 p-4` → `p-4`).
 *
 * @example
 *   cn("p-2", isActive && "bg-primary", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

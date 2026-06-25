export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatArea(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value)} ha`;
}

/**
 * Normaliza un valor que viene de Postgres vía `pg` (que devuelve DATE como `Date`)
 * a un string ISO `YYYY-MM-DD`. Acepta Date, string ISO, null o undefined.
 *
 * Por qué existe: `pg` devuelve columnas `DATE` como objetos `Date` de JS aunque
 * los tipos TS digan `string`. Si renderizás un `Date` directo en JSX, React tira
 * "Objects are not valid as a React child (found: [object Date])".
 *
 * Usar SIEMPRE en el boundary del repositorio (después del `db.query`) para
 * columnas DATE, antes de devolver la fila al componente.
 */
export function toDateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  // string: ya viene normalizado (o es 'YYYY-MM-DD'); devolver tal cual.
  return value;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

/**
 * Tipos del matcher entre filas del Excel y dji_flights.
 */

export type { ExcelApplicationRow } from "./excel-applications-parser";

export interface DjiFlightForMatching {
  flight_id: number;
  drone_nickname: string | null;
  pilot_name: string | null;
  start_at: Date | null;
}

export type MatchMethod = "exact" | "fuzzy" | "no_match";

export interface MatchResult {
  flight_id: number | null;
  score: number;
  method: MatchMethod;
  drone_nickname: string | null;
  pilot_name: string | null;
}

/**
 * Matchea una fila del Excel contra flights candidatos.
 * Score 1.0 = match exacto en (fecha, drone, piloto).
 * Score 0.5 = match parcial (drone exacto, piloto distinto).
 * Score 0.0 = sin match.
 */
export function matchRow(
  row: ExcelApplicationRow,
  candidates: DjiFlightForMatching[]
): MatchResult;

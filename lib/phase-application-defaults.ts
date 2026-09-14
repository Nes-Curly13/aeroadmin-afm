// lib/phase-application-defaults.ts
//
// Valores RECOMENDADOS de las reglas de aplicación por fase (caña, Valle
// del Cauca). Son el seed inicial y el destino del botón "Restaurar
// recomendados" del admin. El admin puede editarlos desde la UI (los
// valores viven en `phase_application_rules`, data-driven).
//
// Fuente agronómica: ver docs/FUMIGATION_CADENCE.md (plagas/enfermedades)
// y docs/DEEPSEEK-PROPOSAL-CICLOS-FENOLOGIA.md §2.3/§5.

export interface PhaseApplicationRuleInput {
  crop_type: string;
  phase: string;
  category_slug: string;
  application_type_slug: string | null;
  cadence_days: number | null;
  window_from_day: number;
  window_to_day: number;
  is_required: boolean;
  notes: string | null;
}

/** Fases canónicas de la caña (días desde `cycles.start_date`). */
export const CANA_PHASE_DEFAULTS: Array<{
  phase: string;
  day_from: number;
  day_to: number;
}> = [
  { phase: "establecimiento", day_from: 0, day_to: 120 },
  { phase: "vegetativa", day_from: 121, day_to: 270 },
  { phase: "madurante", day_from: 271, day_to: 360 },
  { phase: "cosecha", day_from: 361, day_to: 9999 }
];

export const PHASE_APPLICATION_DEFAULTS: PhaseApplicationRuleInput[] = [
  {
    crop_type: "cana",
    phase: "establecimiento",
    category_slug: "herbicida",
    application_type_slug: "pre_emergente",
    cadence_days: null,
    window_from_day: 0,
    window_to_day: 20,
    is_required: true,
    notes: "Control de malezas pre-emergente"
  },
  {
    crop_type: "cana",
    phase: "establecimiento",
    category_slug: "fertilizante",
    application_type_slug: null,
    cadence_days: null,
    window_from_day: 0,
    window_to_day: 15,
    is_required: true,
    notes: "Fertilización de fondo (P/K)"
  },
  {
    crop_type: "cana",
    phase: "establecimiento",
    category_slug: "insecticida",
    application_type_slug: null,
    cadence_days: 10,
    window_from_day: 46,
    window_to_day: 120,
    is_required: true,
    notes: "Control de Diatraea (MIPE) cada 7-10 días"
  },
  {
    crop_type: "cana",
    phase: "vegetativa",
    category_slug: "fertilizante",
    application_type_slug: null,
    cadence_days: null,
    window_from_day: 121,
    window_to_day: 180,
    is_required: true,
    notes: "Fertilización de cobertera (N)"
  },
  {
    crop_type: "cana",
    phase: "vegetativa",
    category_slug: "insecticida",
    application_type_slug: null,
    cadence_days: null,
    window_from_day: 121,
    window_to_day: 270,
    is_required: false,
    notes: "Salivazo (Mahanarva) según monitoreo"
  },
  {
    crop_type: "cana",
    phase: "vegetativa",
    category_slug: "fungicida",
    application_type_slug: null,
    cadence_days: null,
    window_from_day: 121,
    window_to_day: 270,
    is_required: false,
    notes: "Roya / carbón según monitoreo"
  },
  {
    crop_type: "cana",
    phase: "madurante",
    category_slug: "otro",
    application_type_slug: "madurante",
    cadence_days: null,
    window_from_day: 300,
    window_to_day: 360,
    is_required: true,
    notes: "Madurante (glifosato) 30-50 días pre-corte"
  }
];

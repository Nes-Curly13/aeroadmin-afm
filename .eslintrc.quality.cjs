/**
 * Reglas de calidad/complejidad para AeroAdmin AFM — FASE 1.5.
 *
 * Este archivo NO se usa todavía — espera la compuerta 1 del Gauntlet
 * (lint + tipos) que se activará cuando se instale ESLint base.
 *
 * Está en la raíz (no en docs/QUALITY_GAUNTLET.md) para que el día
 * que se agregue ESLint, la integración sea trivial: extends en la
 * config base y listo.
 *
 * Dependencias requeridas (cuando se active):
 *   npm install --save-dev eslint-plugin-sonarjs
 *
 * Activación (en .eslintrc.cjs raíz, cuando exista):
 *   module.exports = {
 *     ...tuConfigBase,
 *     extends: [...tuConfigBase.extends, './.eslintrc.quality.cjs'],
 *   };
 *
 * Ver docs/QUALITY_GAUNTLET.md §2 para el rationale de cada regla.
 */

module.exports = {
  plugins: ['sonarjs'],
  extends: ['plugin:sonarjs/recommended-legacy'],
  rules: {
    // --- Complejidad ---
    complexity: ['error', { max: 10 }],
    'max-lines-per-function': [
      'error',
      { max: 150, skipBlankLines: true, skipComments: true },
    ],
    'max-params': ['error', 4],
    'max-depth': ['error', 4],
    'max-nested-callbacks': ['error', 3],

    // --- SonarJS: detecta duplicación y patrones de bug comunes ---
    'sonarjs/cognitive-complexity': ['error', 15],
    'sonarjs/no-duplicate-string': ['warn', { threshold: 4 }],
    'sonarjs/no-identical-functions': 'error',
    'sonarjs/no-collapsible-if': 'warn',

    // --- Reglas específicas del proyecto ---
    // Prohíbe `any` explícito en código de producto.
    '@typescript-eslint/no-explicit-any': 'error',
  },
  overrides: [
    {
      // Los tests pueden ser más largos/repetitivos sin penalización —
      // la duplicación intencional en tests (arrange/act/assert por caso)
      // no es un code smell real.
      files: ['tests/**/*.test.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}'],
      rules: {
        'max-lines-per-function': 'off',
        'sonarjs/no-duplicate-string': 'off',
        'sonarjs/no-identical-functions': 'off',
      },
    },
    {
      // Scripts CLI del pipeline: tolerancia algo mayor a complejidad porque
      // orquestan pasos secuenciales, pero siguen sin poder superar 20.
      files: ['scripts/**/*.js'],
      rules: {
        complexity: ['error', { max: 20 }],
      },
    },
  ],
};

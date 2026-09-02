// middleware.ts — no-op shim.
//
// S10.4: el proyecto usa `proxy.ts` (Next.js 16) para la auth via
// `authConfig.callbacks.authorized`. Next.js 16 igual escanea la
// presencia de `middleware.ts` y se queja si no exporta una funcion
// valida. Re-exportamos la funcion default + config desde proxy.ts
// para satisfacer al validador. La auth real vive en proxy.ts.
//
// Si en algun momento eliminamos proxy.ts, mover este codigo a
// middleware.ts y borrar la re-export.
export { default, config } from "./proxy";

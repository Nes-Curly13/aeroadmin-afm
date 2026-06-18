import "@testing-library/jest-dom/vitest";

// jsdom no implementa matchMedia ni ResizeObserver; algunos componentes
// de Next/Leaflet los consultan en mount. Silenciamos con stubs inocuos.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    });
  }
  if (!(window as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!("scrollTo" in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: () => {},
      writable: true
    });
  }
}

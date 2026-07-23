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
  // Sprint D — M5/F1.8: el form de fumigación usa <dialog> + showModal().
  // jsdom no implementa HTMLDialogElement methods (showModal/close/open).
  // Polyfill mínimo: showModal() se comporta como open=true, close() como
  // open=false, y se setea el atributo `open` para que el querySelector
  // matchee (los tests usan `[role="dialog"]` o el `dialog` selector).
  if (typeof window !== "undefined" && typeof HTMLDialogElement !== "undefined") {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
        this.setAttribute("open", "");
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.removeAttribute("open");
      };
    }
  }
}

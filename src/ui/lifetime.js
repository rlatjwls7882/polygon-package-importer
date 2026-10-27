// DOM listeners and Chrome subscriptions belong to one view, not the module.
export function createViewLifetime() {
  const cleanups = [];
  let disposed = false;
  return {
    get disposed() { return disposed; },
    listen(target, type, listener, options) {
      if (disposed || !target?.addEventListener) return;
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener?.(type, listener, options));
    },
    subscribe(event, listener) {
      if (disposed) return;
      event.addListener(listener);
      cleanups.push(() => event.removeListener(listener));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    }
  };
}

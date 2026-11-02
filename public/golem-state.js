export function normalizeGolemSettings(value = {}) {
  const size = Number(value.nodeSize);
  return {
    autoRotate: typeof value.autoRotate === 'boolean' ? value.autoRotate : true,
    nodeSize: Number.isFinite(size) && size >= 1 && size <= 5 ? size : 2,
  };
}

// Canvas dimensions survive GPU failures; only successful frames prove health.
export function createRenderState({now = () => performance.now(), onChange, staleAfterMs = 6000}) {
  let lastFrame = null, ready = false;
  function update(value, reason = '') {
    const changed = ready !== value;
    ready = value;
    if (changed || !value) onChange(value, reason);
  }
  return {
    frame() { lastFrame = now(); update(true); },
    fail(reason) { lastFrame = null; update(false, reason); },
    check() {
      if (ready && now() - lastFrame > staleAfterMs) update(false, '3D не отвечает — включена резервная карта');
      return ready;
    },
  };
}

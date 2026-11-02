// Live activity channel. The Golem page used to poll every 12 seconds and only
// ever saw a finished answer; these events are emitted while the work happens.
const clients = new Set();
const MAX_CLIENTS = 8;

export function subscribe(response) {
  if (clients.size >= MAX_CLIENTS) return null;
  clients.add(response);
  return () => clients.delete(response);
}

export const listenerCount = () => clients.size;

export function emit(type, data = {}) {
  if (!clients.size) return;
  const payload = 'data: ' + JSON.stringify({type, at: Date.now(), ...data}) + '\n\n';
  for (const response of [...clients]) {
    try { response.write(payload); } catch { clients.delete(response); }
  }
}

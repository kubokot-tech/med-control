/** The iPad page listens and shows which part of an upload is running. Other editions have no listener. */
export function traceStep(name) {
  try { globalThis.dispatchEvent(new CustomEvent('mc-step', { detail: name })); } catch { /* node, or no document yet */ }
}

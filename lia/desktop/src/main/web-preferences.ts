/**
 * Security baseline of the Launcher window (SEC-1, 12/11/2026).
 *
 * `sandbox: true` is only safe because the preload is a pure contextBridge:
 * it imports nothing but `electron`, so it does not need Node built-ins in the
 * renderer process. The flags are pinned here — instead of inline in
 * `index.ts` — so a regression is a unit test failure, not something that
 * only a real window would reveal.
 *
 * Why it matters: with `sandbox: false` and `contextIsolation: true` the
 * preload still runs with Node privileges. A compromised renderer that reaches
 * a preload bug would inherit those privileges. With the sandbox on, Chromium
 * confines the renderer and preload to the sandboxed environment.
 *
 * NOT verified in a real window yet: opening the Launcher on Windows remains
 * required to confirm the UI boots under the sandbox (see SEC-1 report).
 */
export const LIA_MAIN_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

/**
 * Renderer event delivery, bounded (Windows shutdown hotfix, item 6).
 *
 * Real-machine QA: pressing X ran the shutdown coordinator fine until one
 * host event tried to reach a renderer that `window-all-closed` had already
 * destroyed - `TypeError: Object has been destroyed` surfaced as an
 * UnhandledPromiseRejectionWarning OUT of `ShutdownCoordinator.execute`.
 * Observability must never veto shutdown: the terminal/main log is the
 * durable sink, renderer delivery is best-effort with a full lifetime
 * guard - and every delivery error is swallowed loudly, not thrown.
 */

/** The minimal slice of a BrowserWindow lifetime the publisher checks. */
export interface LiaEventWindowLifetime {
  isDestroyed: () => boolean
  webContents: {
    isDestroyed: () => boolean
    send: (channel: string, payload: unknown) => void
  }
}

export interface LiaEventPublisherDeps {
  /** Live window handle - may become undefined at any moment. */
  getWindow: () => LiaEventWindowLifetime | undefined
  /** The durable sink (terminal / main-process logger). */
  log: (line: string) => void
}

export function createLiaEventPublisher(deps: LiaEventPublisherDeps): (event: string, detail?: string) => void {
  return (event, detail) => {
    deps.log(`[lia] ${new Date().toISOString()} ${event} ${detail ?? ''}`)
    try {
      const win = deps.getWindow()
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('lia:event', { detail, event })
      }
    }
    catch (delivery) {
      // The renderer being mid-teardown is a delivery gap, never a fault.
      let reason = 'unknown'
      try {
        if (delivery instanceof Error)
          reason = delivery.message
        else
          reason = String(delivery)
      }
      catch { /* a pathological error object never escapes */ }
      deps.log(`[lia] renderer event delivery skipped: ${reason}`)
    }
  }
}

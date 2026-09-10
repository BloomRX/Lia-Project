import type { MainProcessLogLine } from '../../shared/eventa'

/**
 * Main-process log bus for the Lia Home log viewer.
 *
 * This is NOT a new logger and NOT a second logging system. It reuses the one
 * existing global logging hook (`@guiiai/logg` → `setGlobalHookPostLog`) that the
 * AIRI FileLogger already consumes: the app entry calls `ingestMainProcessLog`
 * for every formatted log line, we keep a small sanitized ring buffer here, and
 * the main window subscribes so new lines can be pushed to the Home viewer.
 *
 * Security: lines are sanitized BEFORE they are buffered or forwarded (ANSI
 * stripped, common secrets/tokens masked, stack-trace bodies collapsed and each
 * line length-capped). Full/raw technical detail stays in the diagnostics
 * viewer / the on-disk log file, not in the normal Home presentation.
 */

export type MainProcessLogEmitter = (line: MainProcessLogLine) => void

const MAX_BUFFER = 200
const MAX_LINE_LENGTH = 2000

let entries: MainProcessLogLine[] = []
let nextId = 0
let emitter: MainProcessLogEmitter | null = null
let lastLineWasStackFrame = false

export function setMainProcessLogEmitter(next: MainProcessLogEmitter | null): void {
  emitter = next
}

export function getMainProcessLogSnapshot(): MainProcessLogLine[] {
  return entries
}

export function ingestMainProcessLog(raw: string): void {
  const text = sanitizeLogLine(raw)
  if (!text)
    return

  const line: MainProcessLogLine = { id: nextId++, timestamp: Date.now(), text }
  entries = [...entries.slice(-(MAX_BUFFER - 1)), line]
  try {
    emitter?.(line)
  }
  catch {
    // Never let a log delivery failure take down the app.
  }
}

/**
 * Stateless single-line sanitizer: strips ANSI escapes, trims, masks common
 * secrets and caps the line length. Exported for tests.
 */
export function sanitizeLogText(raw: string): string {
  let text = raw
    .replace(/\u001b\[[0-9;]*m/g, '') // strip ANSI color/style escape codes
    .trim() // drop leading/trailing whitespace, including any trailing newline

  text = maskSecrets(text)

  if (text.length > MAX_LINE_LENGTH)
    text = `${text.slice(0, MAX_LINE_LENGTH)} …`

  return text
}

/**
 * Returns a sanitized single-line representation of a raw formatted log, or
 * `null` when the line should be omitted entirely (e.g. a collapsed stack frame).
 */
function sanitizeLogLine(raw: string): string | null {
  // Collapse stack traces: keep the error line + the first frame, drop the rest
  // of the frame run so full stack traces are not shown in the normal Home view.
  const trimmed = raw.trim()
  const isStackFrame = /^at\s/.test(trimmed) || /^<anonymous>/.test(trimmed)
  if (isStackFrame) {
    if (lastLineWasStackFrame)
      return null
    lastLineWasStackFrame = true
  }
  else {
    lastLineWasStackFrame = false
  }

  return sanitizeLogText(raw)
}

/**
 * Masks common secret shapes so credentials never reach the Home viewer.
 * Deliberately conservative: it targets well-known key/token assignments and
 * `Bearer`/`Authorization` values, not arbitrary text.
 */
function maskSecrets(text: string): string {
  let masked = text

  masked = masked.replace(
    /(Bearer\s+|(?:authorization|proxy-authorization)\s*:\s*(?:bearer\s+)?)(["']?)[^"',;\s]+/gi,
    '$1$2***',
  )

  masked = masked.replace(
    /((?:api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|token|access[_-]?token|refresh[_-]?token|session[_-]?key|auth[_-]?token)\s*[:=]\s*)(["']?)[^"',;\s]+/gi,
    '$1$2***',
  )

  return masked
}

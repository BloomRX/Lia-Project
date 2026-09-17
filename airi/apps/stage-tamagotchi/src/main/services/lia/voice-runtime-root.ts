/**
 * Migration shim (Phase 7): the implementation moved to Lia Core at
 * `@lia/core/bootstrap/runtime-root` - Lia owns this logic now, AIRI is a consumer. This file keeps
 * every existing import path (and every existing test) compiling against the
 * same API while the migration to the Lia-owned contract completes. Do not
 * grow new code here; new code belongs to Lia Core.
 */
export * from '@lia/core/bootstrap/runtime-root'

/**
 * Phase 8.0D-M3: renderer-facing handle on the ONE provider-context rule.
 *
 * The definition lives in `@proj-airi/core-agent` next to the runtime that
 * builds the provider prompt, and is re-exported here unchanged so callers in
 * the app layer can ask "what will the provider actually receive?" without
 * depending on the runtime package directly - and, more importantly, without
 * re-deriving image parsing or exclusion rules of their own.
 */
export type { ProviderContextMessage } from '@proj-airi/core-agent'
export {
  countImagePartsInMessage,
  countProviderContextImageParts,
  hasProviderContextImageInput,
  isProviderContextMessage,
  selectProviderContextMessages,
} from '@proj-airi/core-agent'

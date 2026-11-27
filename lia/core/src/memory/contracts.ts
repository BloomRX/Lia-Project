export const LIA_MEMORY_LIMITS = { entries: 100, text: 500, query: 4000, context: 2000, retrieved: 4 } as const
export const LIA_MEMORY_KINDS = ['episodic', 'semantic', 'procedural', 'autobiographical', 'project', 'user'] as const
export const LIA_MEMORY_CLASSIFICATIONS = ['fact', 'inference', 'hypothesis'] as const
export type LiaMemoryKind = typeof LIA_MEMORY_KINDS[number]
export type LiaMemoryClassification = typeof LIA_MEMORY_CLASSIFICATIONS[number]
export interface LiaMemoryMetadataInput {
  kind: LiaMemoryKind
  classification: LiaMemoryClassification
  expiresAt?: string | null
}
export interface LiaMemoryMetadata {
  kind: LiaMemoryKind
  classification: LiaMemoryClassification
  provenance: 'user'
  createdAt: string
  expiresAt?: string
}
export type LiaMemoryScope
  = | { kind: 'global' }
    | { kind: 'project', projectId: string }
    | { kind: 'conversation', conversationId: string, projectId?: string }
export type LiaMemoryContext = { projectId?: string, conversationId?: string }
export interface LiaMemoryEntry { id: string, text: string, updatedAt: string, metadata?: LiaMemoryMetadata, scope?: LiaMemoryScope }
export interface LiaMemoryState { schemaVersion: 1 | 2, enabled: boolean, entries: LiaMemoryEntry[] }
export type LiaMemoryResult<T = LiaMemoryState> = { ok: true, value: T } | { ok: false, code: 'invalid' | 'unavailable' | 'limit' | 'missing' }
export type LiaMemoryMutation
  = | { action: 'enable', enabled: boolean }
    | { action: 'save', id?: string, text: string, metadata?: LiaMemoryMetadataInput }
    | { action: 'remove', id: string }
    | { action: 'clear', confirmed: true }

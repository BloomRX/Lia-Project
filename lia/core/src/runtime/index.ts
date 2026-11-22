/**
 * Superfície pública do Runtime independente (D+).
 *
 * Todo este domínio é **node-only**: registro em disco, socket/named pipe,
 * criptografia e leitura do cofre. Nenhum módulo daqui pode ser importado por
 * um Renderer — a guarda S3 do teste de superfície pública verifica isso.
 */
export * from './instance.ts'
export * from './registry.ts'
export * from './control.ts'
export * from './credentials.ts'
export * from './shutdown.ts'
export * from './service.ts'

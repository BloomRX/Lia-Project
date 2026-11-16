/**
 * Superfície pública do domínio de transportes.
 *
 * `contracts` descreve o dado; `validation` valida o mesmo dado sem I/O. Os
 * dois são puros — podem ser importados por Renderer. O `repository` (que toca
 * disco) fica atrás do próprio subpath `./transports/repository`, para que um
 * import de Renderer não possa alcançá-lo por acidente.
 */
export * from './contracts.ts'
export * from './validation.ts'

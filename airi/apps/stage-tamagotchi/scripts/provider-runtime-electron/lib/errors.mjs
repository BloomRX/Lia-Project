/**
 * A single, boring way to read a message out of an unknown thrown value.
 *
 * The repository's lint policy points at `@moeru/std`'s `errorMessageFrom` for
 * application code. These scripts are executed directly by `node --test`, with
 * no bundler and no path aliases, so they keep the equivalent one-liner here
 * instead of adding a runtime dependency to a test harness.
 */
export function errorText(error) {
  if (error && typeof error === 'object' && 'message' in error)
    return String(error.message)
  return String(error)
}

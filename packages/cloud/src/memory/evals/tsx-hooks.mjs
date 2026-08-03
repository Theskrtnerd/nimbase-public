// Node module-resolution hooks for running the eval's tsx scripts (the
// embedding refresh) outside Next.js. The wiki VFS imports "server-only", which
// throws when loaded outside an RSC; map it (and "client-only") to an empty
// module — exactly what apps/nextjs and the cloud vitest config do via aliases.
// Registered with `tsx --import ./register-tsx-hooks.mjs`.
/**
 * @param {string} specifier
 * @param {unknown} context
 * @param {(specifier: string, context: unknown) => Promise<unknown>} next
 * @returns {Promise<unknown>}
 */
export async function resolve(specifier, context, next) {
  if (specifier === "server-only" || specifier === "client-only") {
    return {
      url: new URL("./empty-module.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}

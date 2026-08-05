// The pure knowledge-graph builder moved to @acme/runtime
// (packages/runtime/src/knowledge-graph.ts) so the MemoryProvider's `neighbors`
// op can reuse it without @acme/runtime depending on @acme/api (NOT-58). This
// module stays as the stable import path for the kb router and the colocated
// test — behavior is identical.
export * from "@acme/runtime/knowledge-graph";

// The pure knowledge-graph builder moved to @acme/cloud
// (packages/cloud/src/knowledge-graph.ts) so the MemoryProvider's `neighbors`
// op can reuse it without @acme/cloud depending on @acme/api (NOT-58). This
// module stays as the stable import path for the kb router and the colocated
// test — behavior is identical.
export * from "@acme/cloud/knowledge-graph";

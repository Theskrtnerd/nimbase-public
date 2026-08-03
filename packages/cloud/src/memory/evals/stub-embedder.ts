// Deterministic offline embedder used to FREEZE the eval fixtures when no AI key
// is available. It is a hashing vectorizer: each text becomes a 1536-dim,
// L2-normalized hashed bag-of-words vector. Two texts that share vocabulary land
// close in cosine space (so the vector leg of hybrid search returns real,
// non-trivial rows and the RRF fusion is genuinely exercised), while unrelated
// texts are near-orthogonal. It is NOT a semantic model — synonym/paraphrase
// recall needs the real embed model (see refresh-embeddings.ts --real). The
// committed embeddings.json records which embedder produced it.

export const STUB_MODEL = "stub-hashing-v1";
export const EMBED_DIM = 1536;

// FNV-1a over the token, folded to a dimension index.
function tokenDim(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % EMBED_DIM;
}

export function stubEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const d = tokenDim(token);
    v[d] = (v[d] ?? 0) + 1;
  }
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

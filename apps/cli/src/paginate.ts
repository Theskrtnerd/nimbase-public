/** Collect every server page while keeping pagination out of the CLI interface. */
export async function collectAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{
    items: T[];
    nextCursor: string | null | undefined;
  }>,
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (!cursor) return items;
    if (seenCursors.has(cursor)) {
      throw new Error("Server returned a repeated pagination cursor");
    }
    seenCursors.add(cursor);
  }
}

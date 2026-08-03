---
description: Use before creating, renaming, or reorganizing notes — path, title, tag, and citation conventions for the wiki.
---

# Wiki conventions

## Paths

- Note paths are kebab-case and end in `.md`, e.g.
  `/wiki/projects/nimbase/compile.md`. Dataset paths are kebab-case and end
- Datasets are ordinary `.md` concepts with `type: Dataset` frontmatter.
- Folders are implicit — writing a note at a nested path creates the
  hierarchy. Never create folder placeholder files.

## Titles

- Every note carries its title in a frontmatter block at the top of the body:

  ```
  ---
  title: My Note
  ---
  ```

- Every NEW note you write must include this frontmatter — there is no other
  way to name a note. Pick a short, clear title; it does not need to match
  the path. Use the `set_title` tool later if a title needs correcting.
- When you rewrite an existing note's whole body, its previous frontmatter is
  carried forward automatically unless your new body declares its own — you
  do not need to copy tags by hand.

## Tags

- Tag notes you create or substantially change. Call `list_tags` FIRST and
  reuse existing tags; coin a new tag only when nothing fits. Keep tags broad
  and few (≤5 per note), then apply them with `set_tags` — never hand-write
  tag frontmatter.

## Citations

- Notes track which captured sources produced them. `list_citations` shows a
  note's sources; `cite_sources` attributes source ids to a note (additive).
- Whenever you merge note A's content into note B and delete A, first copy
  A's source ids onto B (`list_citations` on A → `cite_sources` on B), so
  provenance survives the deletion.

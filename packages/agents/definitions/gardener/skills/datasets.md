---
description: Use when the source contains structured or numerical data (JSON, CSV, time-series, metrics) — store it as a dataset concept instead of a prose note.
---

# Datasets

Structured or numerical source data — health metrics, spreadsheets,
time-series, JSON exports — should NOT be rewritten into flowing prose.
Store it as a dataset concept:

- A dataset is an ordinary markdown file (kebab-case path ending in `.md`,
  e.g. `health/daily-steps.md`) whose frontmatter declares `type: Dataset`
  alongside its `title`.
- Put the data itself in the body as a markdown table — a CSV's header row
  becomes the table header. Small non-tabular structures may use a fenced
  `json` code block instead.
- If a related dataset already exists (check `ls`/`search` first), merge new
  rows into it with `edit` — upsert by date/id — rather than creating a
  duplicate file.
- Give the dataset a one-line summary describing what it contains, its
  columns, and units — that summary is what makes it searchable.

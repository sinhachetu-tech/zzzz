<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Codebase map — read first

`CODEBASE.md` (repo root) is the authoritative plain-English map of this codebase:
annotated file tree, one-line summary of every file, and a "task → which files to touch"
index. Read it before exploring; keep it updated in the same commit as any code change.

## CODEBASE.md discipline (mandatory for every coding session)

1. **BEFORE changing code**: read the relevant entries in `CODEBASE.md` (use the
   "task → which files" index instead of exploring the tree).
2. **AFTER every code change**: review and update `CODEBASE.md` so it stays true —
   new files get an entry, changed files get their summary corrected, the
   "task → files" index gains new mappings. This applies to every change, however
   small; do it in the same commit as the change.
3. If a change makes any statement in `CODEBASE.md` false (architecture, flow,
   schema, file purpose), fixing the doc is part of the change — not optional cleanup.

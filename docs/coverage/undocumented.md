# The gap list — what the code did that no document named

Every new session starts from the documents it can find. Anything the program does that no document names
is therefore an unknown unknown to **every** session, forever — not something a session weighs and rejects,
something it never learns is there. This page is the census of that surface, and the mechanism that keeps
it closed.

**Status: the gap is zero.** `src/__tests__/unit/docs/coverage.test.ts` fails if an item no document names
appears, and it carries **no allowlist** — there is nothing to add a name to.

## Where the easily-missed items are described

| Item                                                                     | Described in                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `atlas`, `datadog`, `src/atlas`, `src/datadog`                           | [atlases.md](../atlases.md)                                 |
| `pane`, `src/pane`, `src/measurement`, `src/sessions`                    | [console.md](../console.md)                                 |
| `audit`, `identity`, `slice`                                             | [corpus-integrity.md](../corpus-integrity.md)               |
| `src/judgement`, `src/route`                                             | [judgement-and-routing.md](../judgement-and-routing.md)     |
| `proof`, `src/proof`                                                     | [proof-capture.md](../proof-capture.md)                     |
| `hooks/*.ts`                                                             | [docs/hooks/registered-and-bounded.md](../hooks/registered-and-bounded.md)                                           |
| `src/memory`                                                             | [docs/hooks/browser-memory-and-limits.md](../hooks/browser-memory-and-limits.md)                                     |
| every `SLOPWEAVER_*` name                                                | [environment.md](../environment.md)                         |
| `src/devGate`, `src/canon`                                               | [dev-gate.md](../dev-gate.md)                               |
| `src/events`, `src/supervisor`                                           | [supervisor-events.md](../supervisor-events.md)             |

**A name in a dated proof passes the floor without describing anything** — a list of gates in a proof such as
`docs/routing-preflight-proof.md` is a name, not a description. The judgement layer is this page: a subsystem that describes itself, as `src/devLint/gateGroups.ts`'s registry does beside every check
it registers, gets a one-line row in [the docs index](../README.md) rather than a prose copy that rots
against it. The same reasoning covers every skill and every verb's `--help`.

## Reproducing it — how this list is produced

Each row's inventory is enumerated by one command. Run these against a clean tree:

```bash
slopweaver catalog                                                  # every CLI noun and verb, from the live manifest
ls src                                                              # every top-level subsystem
grep -oE 'name: "[a-z][a-z0-9-]*"' src/devLint/gateGroups.ts | sort -u # every registered dev lint gate
git ls-files hooks                                                  # every hook the harness invokes
git grep -hoE '"SLOPWEAVER_[A-Z0-9_]+"' -- 'src/**/*.ts' 'hooks/**/*.ts' 'eval/**/*.ts' | sort -u
```

The gap is the difference between those and the document set — `README.md`, `AGENTS.md`, `docs/**/*.md`,
`skills/*/SKILL.md`, `skills/*/reference/*.md`, `.claude/rules/*.md` (`isCoverageDocPath`). Rather than diffing by hand, run the ratchet,
which does exactly that and prints what is unnamed:

```bash
yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/docs/coverage.test.ts
```

**It reads TRACKED files.** A new doc that is not yet staged is invisible to it, so `git add` before
believing a red run.

## What "named" means, and what it does not

Exactly one thing: the literal reference shape for that item appears in at least one document. It is a
**floor**, not a quality bar — a quality bar cannot be machine-checked, and a gate claiming one would be
worse than a gate claiming a floor.

The shape is per kind, and narrow on purpose:

- A **CLI noun** must appear as an invocation (`slopweaver atlas …`), never as the bare English word.
  `route`, `memory`, `proof` and `pane` are all ordinary prose here; matching those would report full
  coverage while every verb stayed undescribed.
- A **`src/` directory** and a **hook** must appear as a path, so a mention points at the code.
- A **gate name** and a **`SLOPWEAVER_*` name** are unique enough to stand alone as whole words.

Two deliberate exclusions, each with a reason rather than a convenience:

- **`src/__tests__` is not a subsystem.** It is the test tree, governed by `.claude/rules/testing.md`.
- **`hooks/lib/` is not a hook.** It holds shared shell functions the hooks source, which nothing invokes
  and which the hook using them describes.

One measured trap, kept as a warning: the `SLOPWEAVER_*` scan reads **string literals only**. Scanning bare
mentions reported `SLOPWEAVER_ALLOW_REMOTE_AHEAD` as a live variable when the only text naming it is a doc
comment explaining that no such override exists. A name in prose is a claim; a literal is the key.

And one thing the scan deliberately does **not** separate: environment variables from stdout markers. A
variable is read through `process.env[X]`, `env[X]`, `deps.env({ name: X })` and
`Object.getOwnPropertyDescriptor(env, X)` in this repository already, so a reader-shape scan reports a
shrinking, arbitrary subset. Both kinds are the same class of unknown unknown, and
[environment.md](../environment.md) lists them apart so nobody exports a marker expecting it to do
something.

## Where the mechanism lives

- `src/canon/docCoverage.ts` — the pure sweep. It never reads a file; every filesystem edge is a seam.
- `src/__tests__/unit/docs/coverage.test.ts` — the fixture tests, plus the real-tree ratchet.

It is the mirror of `src/canon/staleReferences.ts`, which catches a document naming code that does not
exist — and of `src/canon/diagramReferences.ts`, which applies the same resolution inside
`docs/diagrams/*.mmd`. Together they close both directions: no doc may describe code that is gone, and no
code may exist that no doc has named.

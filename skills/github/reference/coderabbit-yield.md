# `github coderabbit-yield` — how many CodeRabbit findings were acted on

Bundled reference for the `github` skill. The question it answers: how many CodeRabbit findings are acted on against how many are
self-resolved without acting, to gauge whether it finds high-value or low-value things. The verb answers it from
GitHub itself, read-only, and writes nothing anywhere.

```bash
slopweaver github coderabbit-yield --repo acme/acme-admin,lachiejames/slopweaver           # the viewer, 60 days
slopweaver github coderabbit-yield --repo acme/acme-admin --author <login> --days 30 --json
```

- **The cohort** is every pull request `--author` (default: whoever the token belongs to) CREATED in the
  window, in each `--repo`, read as it stands NOW. A finding on an older pull request is outside it.
- **A finding** is a review thread CodeRabbit opened. Nitpicks and outside-diff comments live in review BODIES,
  carry no thread and no outcome, so they are COUNTED and never classified.
- **The read is GraphQL through the read transport**, one search per window. GitHub search stops at 1,000
  results, so a window that holds more is bisected by second until each half fits. Every request books its
  cost, and the walk stops with 100 points still in reserve rather than draining the token's budget.

## The evidence ladder — first rung that holds wins

| Outcome                | What it rests on                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `reported-addressed`   | CodeRabbit's own `✅ Addressed in commit…` edit or `✅ Confirmed as addressed by @…` reply |
| `reply-cites-commit`   | a person's reply in the thread names a commit (the fleet's `Fixed in <sha>` shape)         |
| `unknown`              | the thread has more comments than were read, so no verdict is claimed                      |
| `outdated-only`        | the code moved under it and nothing says why                                               |
| `resolved-no-evidence` | resolved with no marker and no cited commit — the "self-resolved without acting" number    |
| `open-no-evidence`     | still unresolved, nothing says it was acted on                                             |

**The markers are CodeRabbit's CLAIM that a later commit addressed the finding**, not a proof anybody checked
the diff. The verb never widens them: a quoted or fenced marker, a marker in a person's comment and a generic
`✅ … resolved` line are all refused. `resolved-no-evidence` is split by who resolved it (the author, someone
else) and whether anybody replied first — a silent resolve is the shape [coderabbit.md](coderabbit.md) forbids.

Every outcome is cross-tabbed by repository, severity, type, CodeRabbit's category and pull-request state.
A severity, type or category CodeRabbit's header does not carry reads `unknown`, never a guess.

## Exit codes, and what a gap means

`2` is a usage error, refused before any credential is read. `1` with nothing printed is a failed read. `1`
WITH the report printed means the read finished with a GAP — a cursor that stopped advancing — named in the
coverage line; the numbers cover what was read and say so. `0` is a complete read.

CodeRabbit is disabled on `lachiejames/slopweaver`, so that repository's findings stop
there; name both repositories anyway, since the count of its pull requests is the denominator that says so.

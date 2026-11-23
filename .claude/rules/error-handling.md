# Error handling

Hard rules for every fallible function in this repo — source, scripts, tests. There is no hand-rolled `Result`
type here; `Result`/`ResultAsync` (`src/lib/result.ts`) are thin aliases over real neverthrow, and this file is
the pattern, modeled on an earlier codebase's design (re-skinned per "Porting from private
sources" above, never ported verbatim).

## The two-layer shape

**Infra boundary** — one shared typed error for every external call: `IngestError`
(`src/lib/ingestError.ts`), produced by the `safe*` wrappers (`src/lib/safeBoundary.ts`'s
`safeCodex`/`safeEmbed`/`safeFs`, `src/lib/providerCall.ts`'s `safeProviderCall`). Every external throw becomes
a typed `IngestError` here, once; these essentially never need touching.

**Domain errors** — every OTHER area that can fail (parsing, validation, a corpus read, a provider-shaped
"false success") gets its own `<Domain>Error` discriminated union + `<Domain>Errors` factory object, scoped
to that one bounded module. Real example, `src/corpus/github/errors.ts`:

```typescript
export interface RepoNotFoundError {
  readonly code: "REPO_NOT_FOUND";
  readonly message: string;
  readonly repo: string;
}
export type GithubFetchError = RepoNotFoundError | RepoPrecheckFailedError | SearchFailedError;

export const GithubFetchErrors = {
  repoNotFound: ({ owner, repo }: { owner: string; repo: string }): RepoNotFoundError => ({
    code: "REPO_NOT_FOUND",
    message: `repo ${owner}/${repo} not found or inaccessible — check the org slug`,
    repo: `${owner}/${repo}`,
  }),
  searchFailed: ({ cause }: { cause: unknown }): SearchFailedError => ({
    cause,
    code: "SEARCH_FAILED",
    message: cause instanceof Error ? cause.message : "github search failed",
  }),
} as const;
```

- Every variant is `{ code: "<SCREAMING_SNAKE_CASE>"; message: string; ...domain fields }`. `code` is what a
  caller branches on; `message` is what a caller displays.
- **No shared base type across domains, ever.** There is no `AppError`/`DomainError` umbrella. Each domain's
  union stands alone — a GitHub union, a Slack union, a Linear union, never a cross-source one. If two
  domains look similar, that is a coincidence of shape, not a reason to merge them.
- A domain that wraps a `safe*` boundary call should `.mapErr()` the `IngestError` into its own union at that
  exact point, carrying the useful fields forward rather than discarding them —
  `someBoundaryCall(...).mapErr((e): GithubFetchError => GithubFetchErrors.searchFailed({ cause: e.cause }))`.
  No domain here does this yet (each was built around a raw `try/catch`); it is the target, not a proven pattern.

## The ban is machine-enforced (`hand-rolled-result` in `yarn lint`)

"There is no hand-rolled `Result` type here" is a categorical rule, so it is a gate rather than a review
note. **The criterion, not a count:**

> A **union type whose members are object literals, where at least one member declares `ok` with the literal
> type `true`**. A type alias whose whole right-hand side is such an object literal is caught too, because
> the two arms were split across two names and joined elsewhere three times before the gate existed.

State the criterion whenever you quote this class, never a number — a count is only ever the matcher's output.
A survey reported **three** because it grepped line by line, and these declarations wrap around semicolons, so
a single-line grep loses the failure arm; the gate measured **110** on the commit that removed them.

The sharper reason it is a gate: a DEDUP refactor minted a fresh member of this family while the family was
being counted. In one commit, the verbatim-duplication cleanup extracted
`linear/commentCore.ts` and `linear/relationCore.ts`'s shared logic into a new `linear/formCreateArgs.ts` —
leaving both files' own hand-rolled result types exactly where they were while reproducing the same shape in
the file it was creating, with both files open. The class regenerates through ordinary, careful work, which
is exactly what review does not catch and a gate does.

**Anchor evidence in canon to what a change DID, never to a live count.** That cleanup and what it did stays true
forever. A count of the types standing in those files goes to zero the moment the rule's own work lands, so a
reader grepping `main` concludes the rule is stale. Evidence
that expires when the thing it recommends gets done is worse than no evidence.

**Two shapes it deliberately allows**, because neither is a two-armed result:

- **`ok: boolean`** — a success FLAG on a record that carries the same payload either way
  (`src/cli/commands/checkout/syncRun.ts`'s `SyncOutcome`). Converting one would discard what the failure
  arm reports.
- **An `interface` with `ok: true` and no failure arm** — a provider wire envelope such as
  `src/outbound/slack/types.ts`'s `SlackSendResult`, mirroring Slack's response field.

Its known blind spot: a union assembled from two type REFERENCES (`type X = SomeOk | SomeFailure`) is
invisible to it, because neither reference spells `ok` at the union. The single-alias rule closes the common
half of that.

## When NOT to introduce a union — and the threshold past which you MUST

If a function's failures are one or two simple messages that no caller ever branches on — only ever displayed —
leave it on the default `Result<T>` (`E = readonly string[]`, from `src/lib/result.ts`). A one-variant union
invented for its own sake is ceremony. Several real domains
(`src/corpus/watermark.ts`, `src/corpus/history/store.ts`) were left this way — read
their history before adding a union there. The same restraint applies to a function
whose whole POINT is a variable-length list of same-shaped problems (a Zod validation pass,
`src/route/profile.ts`'s `parseCapabilityProfile`) — that stays `readonly string[]` (or `readonly SomeIssue[]`),
since one discriminated error loses the multiplicity that is the actual behaviour.

**The other side of that line is a gate, not a judgement** — `error-shape-threshold` in `yarn lint`.
**The criterion**: a plain error shape is a string supplied to an `err`/`errAsync` call — a literal, a
template or a `+` chain, holes normalised to one placeholder — read through each conditional arm, array item
(a `...spread` one included), `const`, import and named re-export, and charged where it enters `err`; a domain is a directory, counted by its
DISTINCT shapes across non-test files. Past **four** (`src/devLint/errorShapeThreshold.ts`) a directory declares
its `<Domain>Error` union and routes its failures through it — a union site and a forwarded message
(`err(inner.error)`) are not shapes. No allowlist, no marker, a debt list that only shrinks
(`.baselines/error-shape-threshold-baseline.json`). Residue and [why](../../docs/doctrine-rationale/error-shape.md).

## Consuming a typed error

- **Display it**: `error.message` — never reconstruct a string from individual fields when `message` already
  has it.
- **Branch on it**: `error.code === "REPO_NOT_FOUND"` for a single check; for an EXHAUSTIVE switch over every
  variant, use a `switch` with a `default` that assigns to a `never`-typed binding, so a new variant a mapper
  forgot fails to compile rather than falling through silently at runtime.
- **Never** read `.error` expecting an array on a typed union — a typed domain error is exactly ONE value,
  not the hand-rolled `Result`'s `errors: string[]` list.

## Tests

Construct fixtures via the domain's own factory (`err(GithubFetchErrors.repoNotFound({ owner, repo }))`), not
a hand-built `{ code, message }` literal — the factory is what the real code calls, so a test
built the same way catches a factory that stops matching its own type. Assert on `.error.message` for a
display check, `.error.code` for a which-failure-kind check; per `testing.md`, no conditionals in the
assertion either way.

## A POLICY refusal is not a domain error — it is an escape hatch

A failure of FACT ("could not read the working tree") is everything above. A refusal of POLICY — a gate
saying no to something that would otherwise have worked — is a different animal, and it has one shape,
machine-enforced by `escape-hatch` in `yarn lint`.

A bare block is a defect: a refusal that does not say why helps neither the agent nor a human, who both need
the information. The shape is formal, so that deviating from it is structurally impossible. Every policy
refusal carries four things, in order:

```text
<command> blocked because <what caught it, and why>.
Legitimate exceptions may include <examples>.
To override use the designated escape hatch SLOPWEAVER_ALLOW_<SUFFIX>=1 <command>.
Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.
```

**A LINT gate is the one refusal with no hatch, and it says so.** Same four
lines; line three refuses a RUN-TIME override, not every override — six gates carry a SOURCE marker. Declare
a `LintGateDeclaration` in `src/devLint/refusal/registry.ts`, render with `lintGateRefusal`, mark a FACT body
`devlint: not-a-refusal -- <why>`, and let `gateOutcome` pick `clean`/`incomplete`/`refused`: an input the
gate never SAW — unreadable, or its own filter matching none — is a fact, not four lines claiming a rule
caught it. A LANE excluding every gate you named IS policy. Gated by `escape-hatch`, `gate-registration`.

**You do not write that text.** Declare an `EscapeHatch` row in `src/hatch/*Hatches.ts` — the command, what
catches it, a NON-EMPTY list of legitimate exceptions, the key (an env variable, a door token, or a named flag
such as `--acknowledge <path>`), and the module that reads it — and emit with `hatchRefusal`. A door refusal
goes through `doorRefusalLines` (`src/admit/doorRefusal.ts`), the ONE renderer, which always prints the
token. The fourth line is a constant the renderer owns: one a gate could word itself would eventually read
"do not override", and judgement is first class.

**A `hold` has no hatch, and says so** — silence reads as a forgotten one, so it names the absence and the
fix. An artifact recorded unfit is a hold (`src/visualEvidence/`).

**Three things the gate refuses**, none with an exemption marker: any `ALLOW`/`OVERRIDE` name with no row,
a door override token with no row, and a `decision.findings` mapped, spread or iterated into TEXT outside the
renderer. MEASURED: 29 sites rendered door findings and ZERO printed the token. Findings mapped
into a RECORD are a journal row or a `--json` document, outside the criterion by construction.

**Naming an override is not being RELEASED by it — gated by `hatch-release` in `yarn lint`.** Read a hatch into a
local and **OR** it with the caller's argument (`spentPlanHatchOpen`, `src/claude/spawnStore.ts`): a caller may only
ever ADD to a hatch, never close one, so a hatch read written as a PARAMETER DEFAULT fails anywhere in the tree, with
no exemption marker. MEASURED: `SLOPWEAVER_ALLOW_SPENT_PLAN=1 slopweaver cmux spawn <slug> --model fable`
printed the refusal naming the very variable already set, because `cmux spawn` always passes its
own `--force` argument and a default initialiser is skipped whenever a caller passes one — leaving the supervisor
chain unable to seat any successor. A refusal usually carries an escape hatch, and one that cannot open is how a
chain ends up stuck like this. `src/devLint/hatchRelease.ts` carries the rest.

**A named FLAG is a working hatch, and a redundant env var beside one is worse than no change.** Measured:
the audit reported `outbound/github/mergeGuard.ts` as offering no way past a `reverts-main`
refusal, reading that one module — while `cli/commands/github/mergeCore.ts` had always accepted the finding
by subject and printed `--acknowledge <subject,...>`. The `command` key exists so a row can hold the
mechanism that is really there; before proposing a hatch, read the VERB that renders the refusal, not only
the gate that computes it.

**An OUTBOUND hatch is journalled, not ambient**, and only an outbound one is. Outbound rows (`JOURNALLED_IDS`) open with `slopweaver hatch open <id> --reason "<why>"`, recording a
grant naming this session and expiring 30 minutes later, rather than by exporting a variable that leaves no
trace. Ask `hatchOpen` (`src/hatch/open.ts`), never the environment directly; the
`escape-hatch` gate fails a row whose lane disagrees with that rule in either direction. A journalled row's
variable opens NOTHING. The grant keys on the visible session, a Claude Code session or a Codex thread
(`src/hatch/grantSession.ts`), and a test appends a real one under its own home
(`src/__tests__/hatchGrantFixture.ts`).

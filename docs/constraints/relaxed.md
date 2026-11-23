# Deliberately relaxed

Part of [Design constraints](../constraints.md).

Each entry below was a hard constraint relaxed with a reason. They are recorded so nobody re-argues them, and so
the cost of acting on them is visible. Token spend is the exception: rule 2 (`AGENTS.md`) forbids in-process
spend outright, and the entry stays because the need behind it is still real.

## Porting from a private source — the design, never the code

Work that began in a private source may be ported here, and the port is a rewrite: the owner's ruling is that a port
is rebuilt the Slopweaver way, which has its own ways of building tools and keeps state outside the repo. So **port
the DESIGN, never the code or the naming**, and
**tools in the codebase, state outside it**. The owner's own diagnosis is the test to apply: a session asking whether
it may quote a source system's own monitor title is showing the smell of a copy-paste, not of a rewrite.

**Porting the design includes re-measuring its heuristics.** A ported rule deciding what counts as "the same
thing" — normalisation, dedup, grouping, fingerprinting — is a decision someone made about someone else's data,
and fixtures derived from it can only confirm it. MEASURED building `slack alert-summary`: the
ported title normaliser cut everything after an entity reference, passed every unit test, and on a real alerts
channel collapsed five distinct invariant violations into one row — deleting the exact axis the owner's ask, a
breakdown by invariant, existed to show. The fix was a shape test (a value carrying a digit is an
occurrence and is cut; a stable key stays in the identity). Run a ported grouping rule over a real window and
read the GROUPS before writing its tests.

**A port carries no names.** What it writes follows `AGENTS.md` § "no organisation names in what you commit":
a synthetic stand-in in a test or an example, the installation's own value resolved from `$SLOPWEAVER_HOME`,
and [the hygiene gate](../security/hygiene-gate.md) catching what slips through. A provider's tenant id — a
Cloudflare account or zone id — is one of those names: not a credential, but the installation's own, so a test
or a cassette carries a synthetic one and a re-record rewrites the real one back before committing
(`src/__tests__/integration/cloudflare.test.ts`'s header).

## The old remote is dead

The original organisation repo was renamed `slopweaver-history`, moved to the same account as
`lachiejames/slopweaver` and archived, by the owner's ruling; it is read-only history.
`github.com/lachiejames/slopweaver` is the sole canonical remote, for every read and every write, without
exception.

**Old-lineage PR numbers do not carry across and are not resolvable on the new remote.** The two GitHub repos
number pull requests independently from 1, so a bare `#4xx`/`#5xx` in a doc or run journal that predates this
ruling names a pull request on the DEAD remote — on `lachiejames/slopweaver` that same number either resolves
to nothing or, worse, to an unrelated pull request of its own. A citation that needs to survive anchors to the
**commit** the work landed as, not the PR number: `lachiejames/slopweaver`'s `main` is a direct continuation
of the old remote's own history (verified — the old remote's `main` tip is a git ancestor of the new one), so
a commit that landed on the old remote's `main` carries the **identical SHA** on the new one. A commit that
only ever lived on an unmerged old-remote branch has no such anchor and needs its own fresh commit on
`acme` — a new pull request there, described from scratch, if the work is still wanted.

**Treat a bare old-lineage PR number as suspect until it is anchored to its commit.**

## Platform: a colleague's managed work MacBook

The target is **macOS, specifically a work laptop belonging to someone on the team**. Other platforms are
best-effort and untested. A macOS-specific or natively-compiled dependency is acceptable where it buys
something material.

**Why:** the target platform is a fact about who this is for, and insisting on a portability nobody uses
forecloses native acceleration for nothing.

**What "a managed work MacBook" implies** — this is the useful part, and it is stricter than "macOS":

- **Apple Silicon.** Metal and the ANE are available.
- **MDM-managed, without assumed admin rights.** An unsigned or un-notarised native binary can be stopped by
  Gatekeeper, and a managed device may not let the user click through it. So "native is allowed" is not the same
  as "any native dependency will work" — anything shipped this way needs to survive a corporate Mac, and that
  is worth verifying on a real one rather than on the author's machine.
- **Enterprise policy is real and silent.** Enterprise policy can silently block personal plugin marketplaces
  and similar system integrations, which is why `--plugin-dir` is documented in the README. Treat that class
  of policy surprise as part of the target environment.
- **No install ceremony.** The audience is a teammate trying it once. If setup needs a Homebrew tap, a
  compiler, or an admin password, it will not get used.

**What it costs:** `security/runs-anywhere.md` states portability — see [coupled claims](coupled-claims.md).
The optional Codex SDK already ships a ~300 MB platform-specific binary, so the principle was never absolute.

## Token spend is not a per-verb question

Rule 2 (`AGENTS.md` — "No HEADLESS model, anywhere") puts every composing model call in the visible agent
session the owner is already watching, `distil` included. `store read`, `distil` and `turn` all follow the
same brief/answer split: a verb retrieves and writes a brief; the session composes; a verb grounds and
validates the result. The only model transports in a Slopweaver process are `talk`'s, the `codex` SDK's and
`claude gauge`'s one-token probe (`AGENTS.md`'s Stack line), so there is no verb-level spend to budget, throttle
or cap. `distil` refuses `--budget`, `--max-cost`, `--concurrency`, `--max-batches`, `--full` and `--dry-run`
by name with the reason (`REMOVED_DISTIL_FLAGS` in `src/cli/commands/distil/core.ts`).

**Why the underlying need is still real:** the cross-organisation correlation work — finding that two teams
are solving the same problem without knowing it — is not a `distil` map-reduce and needs its own brief/answer
verb pair, the same shape `store read`/`distil`/`turn` already use, not a CLI-side budget.

**What survives, and must:** spend stays **visible**, because it always surfaces inside the session the owner
is already watching, and it stays **bounded to one brief/batch per handoff** — the shape `distil
status`/`brief`/`answer` enforce, with deliberately no automatic bulk mode. Unbounded, invisible spend is
forbidden, and structurally impossible rather than something a flag prevents.

## 10. A provider's per-QUERY cost ceiling is a design constraint, not a tuning knob

Linear enforces **two** budgets: 2,500 requests/hour and, separately, 10,000 complexity points per single
query against 3,000,000 per hour. The request budget is the one everybody thinks about and the one with room to
spare. The per-query ceiling is the one that turns a fatter selection into a HARD ERROR — not a slow page, not a
truncated page, a failed one.

Complexity tracks the size of the nested connections independent of the outer page size only while those
connections select SCALARS. A nested connection with OBJECT sub-selections multiplies: `history(50)` with
twenty-two `from*`/`to*` objects is ~1,100 object resolutions per issue, not 50. Measured: an
expanded Linear issue selection cost **9,454** points for FIVE issues; the teams query **81,430**; the users
query **12,175**. Two of those were unconditional failures on every page.

So the standing rules, both of which are visible in `src/corpus/linear/queries.ts`:

- **Inside a nested connection, prefer the scalar `*Id` field over the object.** The ids are the complete
  record of what changed, and the corpus already holds the things they point at, so a reader can resolve them
  locally for free.
- **Every lane's page size is measured against the ceiling, not chosen for tidiness**, and a `--fetch-cap` is
  CLAMPED to it. A fetch cap is a statement about how much to fetch; it has no business making one query more
  expensive. Trading the plentiful budget (requests) for the scarce one (per-query complexity) is the right
  direction: the Linear issues lane runs 20 per page and ~1,200 pages rather than 50 and ~480.

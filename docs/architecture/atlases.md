# Atlases

Part of [Architecture](../architecture.md).

A second kind of local world model, alongside the corpus — a live-system inventory rather than a rolling
window of team history. Same doctrine as the corpus (local-first, zero API keys of its own, read evidence a
turn can lean on rather than the ceiling of what a turn can do), different shape: `sync` reads a live
system's own API end to end and writes a typed, on-disk snapshot under `$SLOPWEAVER_HOME/atlas/<platform>/`;
`reset` archives the current generation and installs a fresh, empty one — nothing is ever deleted. Each
platform lives in its own `src/atlas/<platform>/` module and is read under `atlas <platform>`, where most also
sync and reset (`atlas vanta sync`/`reset`); Cloudflare, CrowdStrike and 1Password sync and reset under a
top-level noun of their own (`cloudflare sync`/`reset`, `onepassword sync`/`reset`); `src/atlas/atlasFile.ts`
holds the file primitives every atlas shares. A generation is a `manifest.json` written LAST because it names the others, plus one
`<kind>.jsonl` per kind — the envelope on line 1 and one entity per line after it, streamed both ways,
because a kind file's size is a property of the tenant rather than of this code (one Cloudflare account's
`pages-project` reached 169.2 MiB).

An atlas also reaches a question through the store. `store import-atlas` projects every registered atlas's
kind files on disk into five atlas tables — their own tables, never `content` rows — and `atlas probe` counts
a question's keywords across them per `(platform, kind)`, which `store detect` turns into at most one detective
lead per platform (`src/detective/atlasLead.ts`), spent within the wave's slots like any other lead. A count is of
STORED rows and proves nothing about a provider; `atlas <platform> read` carries the claim boundary. The tables
and the measurement: [store](../store/tables-and-atlas.md).

**The Cloudflare atlas** (`src/atlas/cloudflare/`) is the deepest of them: sixty-six kinds, fifty-five covering
every account-scoped surface a token can see (Access and its administration, Zero Trust, Gateway, WARP
devices, tunnels and private topology, DLP, CASB, risk scoring, DEX, Rulesets, Pages, Workers, notifications,
audit logs, certificates, account settings, zones) plus eleven deep-zone-scoped surfaces read for exactly one
explicitly configured zone (DNS records, DNSSEC, zone settings, classic firewall/WAF, SSL/certificates, Page
Rules, zone analytics, API Gateway, Workers routes, zone Rulesets).
Read-only — no Cloudflare mutation exists in this atlas, by design. `inventory.ts` carries TWO lists:
`CLOUDFLARE_REQUIRED_SURFACES` is what a reader reads and `CLOUDFLARE_EXCLUDED_SURFACES` is what the atlas
will never hold, so "not covered" is a printable list rather than a guess. There is no third, `deferred`
list of reachable surfaces left unread: by owner ruling, an atlas missing coverage is unacceptable
and highly voluminous data is the only ground the owner will accept for an exclusion (the largest Zero Trust
surface measured, `dex-fleet-status`, is bounded by the provider's whole retention window, and has a reader). Where the CREDENTIAL rather than the volume is the limit, the boundary is a kind that
says so: a kind such as `risk-score-summary` can answer 403 to a token not granted it, so it publishes an `unreadable` coverage
cell carrying the provider's own refusal and an open `permission-refused` gap, and both close by themselves
the day the token gains the scope. Each kind is read, projected into a typed `CloudflareEntity`,
and folded against what was already stored — a failed read preserves the prior generation's entities rather
than blanking them, and opens a typed gap instead. Several kinds fold multiple independent subtypes into one
kind (e.g. `zone-certificate`'s eleven SSL/certificate surfaces, `api-gateway`'s eight), each subtype read and
folded on its own so one subtype's real, permanent failure (a retired product, a plan-tier limit) never
discards the others' successful reads.

The Datadog toolkit (`src/datadog/`) is a live client with no synced store — reads go straight to the API,
never cached to disk, and its writes (`datadog submit`, gauge and count points to `/api/v1/series`;
`datadog hmi --enable`, Historical Metrics Ingestion switched on per metric and read back; and
`datadog monitor update|delete`, exact monitor changes behind a previewed approval digest) sit in their own
modules so the read path's read-only-by-type property survives. Its console links come from one builder,
`ddConsoleLink`, which takes only a real console host and refuses a dead `app.<site>` one naming the right host;
the same refusal sits on every provider write transport (`src/outbound/invalidDatadogHost.ts`) — and the Vanta atlas (`src/atlas/vanta/`) covers a compliance workspace's Manage
API kinds (controls, risks, policies, evidence, vendors, people, tests, frameworks and the links between
them; `VANTA_KINDS`) plus a browser channel, with the same sync/reset shape as Cloudflare's.

**The 1Password atlas** (`src/atlas/onepassword/`) maps an account's ADMIN shape — people, groups,
membership, vaults, who can reach each vault, item COUNTS, integrations and audit activity — from two
unrelated credentials, an `op` CLI session for the roster and an Events API token for the activity feed,
either of which may be absent without blocking the other. It is built to a stronger line than the other
atlases and holds no item's contents as a PROPERTY rather than a promise: a closed `op` command allowlist
with no item-reading verb in it, a projection that parses provider JSON through a closed schema so an
unrecognised field is dropped at the boundary, and a pre-write gate wired into the kit's own publish guard
that REFUSES a whole generation on a forbidden key or a credential-shaped value. See
[atlases.md](../atlases/onepassword.md) for the three mechanisms and why a private-denylist hit is reported rather than
refused.

**Reading this system's own behaviour** (`src/reflect/`) rides that same client rather than adding a second one.
`slopweaver reflect telemetry` reads which tool calls FAILED out of Claude Code's own OTLP export — the
unsampled `claude_code.tool_result` log events, which carry `tool_name`, `error` and `error_type` flat, rather
than the `claude_code.interaction` → `.tool` → `.tool.execution` span tree, which carries the same errors but
comes back `traffic_type: sampled` and has to be joined back up the tree. It reads no prompt text, no tool
input and no user identity. Every reading is classified against the log indexes' own retention, so a window
that **aged out** is reported differently from a window in which nothing failed — a distinction the exit code
carries too (`3` for "no measurement was possible", `0` for a real zero), because collapsing the two is the
failure the reflection loop exists to remove.

`slopweaver reflect brief` is the loop's MINER, and it makes no network call at all: it reads the day's local
friction ledgers — the handover run journals, the review verdicts, the dev-gate outcomes, the pain points, the
SendFeedback drafts, the per-PR proof reservations, the door's holds, and (by the owner's ruling) every
structured record of an owner ask a session reported as missing: `missing_capability`-typed SendFeedback
drafts, the supervisor's own session ledger, the run journals' `question`/`answered` events, and the current
owner-directive overlay — ranks what they say by
`(impact × safety) / cost`, and surfaces at most **five**, enforced by the form rather than by review because an
unbounded pass once emitted several thousand candidates in one go. Two Tier 2 sources are cross-referenced and are never
themselves a source of a finding: the board (already covered → demoted) and the memory corpus (already known and
it happened anyway → PROMOTED, because the knowledge is not reaching the point of use). Identity is a content
hash of only the stable signal fields, so a moving count cannot mint a fresh id; a `drop` in
`ledgers/reflect/seen.jsonl` is TERMINAL, written by `slopweaver reflect grade <id> keep|adjust|drop [--why]
[--closed-by]` — the loop's one writer for its own grades, which the supervisor runs with the owner's word so
the next brief prints each finding's grade and closure (a sighting after a closure reads as a regression) and
the per-source grade line moves; and one frozen-schema `heartbeat.jsonl` row is written per run, because
a quiet day and a day the loop did not run are otherwise indistinguishable. It writes those two ledgers and
nothing else — no board doc, no pull request, no message — which is the owner's T0 autonomy ceiling for the first
run. Pure code gathers and ranks, the already-visible session reasons, and a mandatory could-not-verify section
carries every collector's residue, a door ledger the store could not read among them.

`slopweaver reflect board` (owner ruling: board grooming is a standing practice) is the standing
grooming leg over the orchestration board itself, in the same read-and-print shape as `reflect telemetry` rather
than a `reflect brief` collector — the board is explicitly never a source of `FrictionFinding`s, so board hygiene
gets its own report instead of another `ReflectSource`. It reports five classes: episodic docs stuck in a live
state (a slug-prefix family at or above a threshold with no run open anywhere in it), docs declaring neither
`doneWhen:` nor `outputs:`, docs whose front-matter failed to parse, `blockedBy` slugs naming nothing, and
`ready`, never-started, unblocked docs sitting past a stated age. It writes nothing at all, matching `reflect
brief`'s own T0 ceiling — retiring a doc is a write to a board other sessions read concurrently, which the
owner's ruling names as its own separate decision.

# Judging the tier, then investigating

The exact `turn brief` call this flow makes, what may and may not appear in a decision's `needs`, and how to
work while investigating. The rule — judge the way a person would, and answer _right now_ questions from the
LIVE source rather than the corpus — is in [SKILL.md](../SKILL.md).

Judge the tier the way a person would, from what `turn brief` says this context can and cannot reach — never
by matching capability terms against the question, and never by reading the corpus first. Run it against the
addressing message you just read, using `replyTarget` from step 1:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn brief --channel <C> --message-ts <threadTs> --thread-ts <threadTs> \
  --user <askerId> --surface <channel|dm> --text "<the question, any @(id) mention preserved>" --mode single-turn
```

`--message-ts` names the exact message that addressed the bot; `replyTarget` from step 1 only ever carries
the thread as a whole, so pass `<threadTs>` for both here — this flow answers a pasted thread, not one
captured message within it. `--mode single-turn` (the default) is what makes `read-only-subagent` admissible
here — unlike `/slopweaver:loop`'s continuous-drain mode, ONE bot turn blocking on a native subagent for its
own investigation is fine, because there is no stream this turn needs to keep reading in parallel.

`turn brief` decides nothing for you — it prints the exact `RoutingDecision` shape to write, and the
AVAILABLE/HISTORICAL/UNAVAILABLE capability inventory to judge from. See `/slopweaver:loop`'s **"Routing judgement"**
section for the full walkthrough and all three JSON shapes (`for-a-human` is the one for a reply a person
owes, which the bot deliberately leaves to them). The short version: a bare "yo" gets a casual reply —
`respond`/`inline`, from context and judgement alone, never silence and never a corpus lookup. "What are my
open PRs?" needs a live verb — judge `respond`/`inline` or `respond`/`read-only-subagent` (or
`fresh-visible-session` for real investigation depth) with `needs` naming an AVAILABLE capability `turn
brief` actually listed. "What did we decide about X" names the HISTORICAL `corpus` leg with `truthMode:
"history"`; a claim about what is true NOW may lean on it but must also name an AVAILABLE leg, or it is refused.
When the store behind that leg cannot be reached, the brief lists `corpus` under UNAVAILABLE with the
reason printed beside it; say so plainly rather than answering from bronze files as though the world model
had spoken.
**An id the brief did not list is never a selectable capability** — it names nothing in any table, so the
judge refuses it and it can never be smuggled into `grounding.kind: "verb"` when you post in step 4. Nothing
is reserved by NAME, which is why an invented id and a retired spelling fail identically, with the same
"does not name any capability this context offers". Same trap, opposite direction: **reading the
thread (step 1) is investigation, never grounding** — `slack-read-thread` is not a routable capability on any
brief either, so it can never satisfy a `"verb"` grounding — ground on the capability whose evidence actually
backs the claim, or on `"conversation"` when context and judgement genuinely are the whole answer. A question
about a surface `turn brief`
listed as UNAVAILABLE is the one case where a good-looking answer is the failure: say plainly what you cannot
see rather than judging a live tier for it.

Write the `RoutingDecision` file now — you hand it to `turn dispatch` in step 4, once you have investigated.

### Then investigate, with the whole verb surface

`slopweaver catalog` lists it. You already read the thread in step 1; now check live state, read the repo,
and run the exact live verbs your own `needs` named. `skills/loop/SKILL.md` specifies the same investigation
discipline and it applies here unchanged.

**And investigate DYNAMICALLY — [dynamic-planning.md](dynamic-planning.md) is that half, and it is a rule
rather than advice.** Judging the tier is one decision; what follows is a loop that re-plans on every
return. There is never a finalised plan: tug on different threads, and know when to reject information versus
where to search elsewhere. Six moves, in order: survey what is reachable before acting; ask the corpus the direct
question AND several oblique lead-generating ones **through the STORE** (`store read` / `store cite`),
which is where the corpus lives; search the corpus's own FILES only when the brief
says the store cannot answer, and say which; discard junk and re-plan on that; follow a record's links and read its provenance as evidence; end on
quotable, citable sources. A turn that announced a plan and then executed it to the end has already lost the
property.

**History goes to the STORE, and this is the ordering.** The org's own Slack,
GitHub, Linear and Notion records are rows in the local Supabase store, reached with `store read` /
`store cite` / `store query`, and the brief's HISTORICAL row names and grades exactly that. Bronze files
under `$SLOPWEAVER_HOME/corpus/bronze/` hold the same records in the shape they were captured, and they are
the FALLBACK — [dynamic-planning.md](dynamic-planning.md)'s move 3 carries the three conditions that license
one and the sentence your answer owes when you take it. A turn that went to local markdown files when it should
have gone to the local Supabase store is the failure this ordering prevents.

**What the store search IS, stated so nothing reaches for the other thing.** Postgres full text and trigram
over the rows, and nothing else: pgvector, embeddings, re-ranking and
semantic search are banished everywhere. A question that a single query answers badly is followed by asking BETTER
queries — several oblique ones, each a lead. There is no vector index to reach for.

**Live state is not in the world model either, and this is the other trap worth naming.** The corpus holds history:
messages, issues, pull requests, documents, as they were captured. It holds no telemetry and no current
operational state. So a question about _right now_ — is this degraded, did the release go out, what is the
error rate, is CI green — must be answered from the LIVE source, which is whatever the working checkout
exposed when you enumerated it: the telemetry map to find out what signal even exists, then the metrics
query surface to read it, then its own test and build commands. Read that, then answer from what it
returned. Answering a "how is it looking right now" question out of the corpus produces a fluent, cited,
wrong answer.

**Live metrics are a live read, never a corpus one** — Slopweaver's `datadog` verbs
([detective-datadog.md](detective-datadog.md)) or the working repo's own surface — and the turn says which it read.

**How to work while investigating:**

- **Never on the default branch.** If the turn will touch files, make a worktree off the base branch
  first, before the first edit — including temporary instrumentation you intend to throw away.
- **Never load a corpus file whole, from any language.** Bronze is gigabytes of `.jsonl`; read it line by
  line with `rg -I`/`ugrep`, or `readJsonlLines` in code. A shell heredoc is invisible to the
  `whole-file-json` gate, and one reaching 21 GB is what [dynamic-planning.md](dynamic-planning.md) § 3
  measured.
- **Reproduce before you claim a fix.** A "before" that does not exhibit the symptom proves nothing. If
  you cannot reproduce it, say so and downgrade the claim to "plausible, not reproduced locally". Never
  assert that a fix resolves a bug you never saw fail.
- **Read what you cite.** A record's indexed text is not necessarily its whole text; if a claim rests on a
  detail, open the source.
- **Hedge on what the world model cannot see.** It covers what was ingested, not private channels and not
  meetings. A "what did this person actually do" answer is an estimate from observable activity, and must
  be framed as one.
- **Never declare a credential missing — LIST THE STORE.** Integration tokens are one `0600` file per token
  under `$SLOPWEAVER_HOME/secrets/`, and `slopweaver secrets status` names every one this install holds
  (platform, scope, expiry, reader; never a value). MEASURED: an office-hours turn told the
  owner that no Vanta credentials were available and asked for two files while `vanta-client-id` and
  `vanta-client-secret` sat in that directory; it had grepped file CONTENTS for "vanta" rather than listing
  the names. A token the register already declares is one `secrets set <name>` the owner pastes once; a name it
  does NOT carry cannot be written at all (`secrets set` answers `unknown secret name`), so a genuinely new
  credential needs its register row first, in its category file under `src/secrets/credentials/`. Either way, asking the owner for a file the
  owner already gave you is the failure. Table and lifecycle: [security](../../../docs/security/credentials.md).

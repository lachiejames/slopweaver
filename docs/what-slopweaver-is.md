# What Slopweaver is, and how the code is laid out

Orientation — the pitch and the shape — which a session reads once rather than holds in context every turn,
and `/doctor` explicitly proposes trimming architecture overviews out of an always-loaded file. `AGENTS.md`
keeps the one sentence that stops the commonest mis-description, the OpenAI egress exceptions, and a link
here.

## What Slopweaver is

**A local-first agent setup you fork, live in and make your own, and a world model for it to stand on.** You talk
to one supervisor chat. It routes each piece of work to a visible Claude Code or Codex session that picks it up with
every tool it has — the corpus, live reads of GitHub, Slack, Linear and Notion, a browser, the shell, whatever the
work needs — and acts through the `slopweaver` verbs and their closed outbound forms. The desktop app, a Claude Code
session, a voice call and a Slack tag are ways in; none of them is the product.

**The corpus is one source it READS. It is never the author of the answer.** That distinction is the whole
product, and getting it backwards is the commonest way this repository has been mis-described: it builds a
local-first, zero-key world model from a team's GitHub/Slack/Linear/Notion history — ingest → tier
(bronze → silver → gold) → query — and that model is evidence a turn can lean on, not the ceiling of what a
turn can do. A tag asking "why did the staging pool exhaust" is answered by going and looking, not by
retrieving; a tag asking "what did we decide about X" is answered from history. Both are the same session at work.

**A fork grows toward whoever runs it.** It starts from the setup it was built in — the rules in `AGENTS.md`, the
skills, the gates — and every friction point its owner hits becomes a fix in the code or a ruling kept outside it,
so a fork keeps adjusting to the person living in it, and is never finished. The line it acts on alone moves the
same way: graduated autonomy (`AGENTS.md` rule 10) starts at the owner's own pull requests, widens a kind of act
only on the owner's word, and the owner's word on any past act can pull that kind back.

**A Slack tag answers a roster, not the workspace.** Only an identity already on the roster that
`slopweaver responders add`/`remove` keeps can get the bot to investigate or compose anything at all, and anyone
else's tag gets a fixed line waiting on the owner to approve it, never a model-composed answer. Past that gate the
ASK decides what happens, never the person (`src/live/turn/tagDecisionTree.ts`). Widening the roster is what makes
injection a real problem, so it is deliberate work rather than a config change.

What it can do that a stock assistant cannot, and why each matters:

- **Reach into live systems through ATLASES.** A pre-built local map of what a system actually holds — every
  Datadog service, span, log shape and attribute; every GitHub repo and its state; every Cloudflare DNS
  record, firewall rule, zone certificate and Worker across the whole account plus one configured deep zone
  (`slopweaver cloudflare sync`/`reset`); every Vanta control, risk, policy and vendor; every Slack Web API
  method, argument and response field, plus the undocumented surface the first-party web client calls
  (`slopweaver atlas slack-api`) — so an investigation looks up what exists instead of guessing at names.
  That is what surfaces the unknown unknowns: an agent guessing a metric name finds what it thought of,
  while one reading the atlas finds the monitor nobody knew was mis-scoped. Measured on the Slack one:
  `--field reply_count` answers "is there any call that hands me this" in one offline command, and the
  answer — two methods out of 264 — closed a question that had been re-argued from memory.
- **Read the team's own private history** across four sources, on the user's machine — plus, when each is
  explicitly named, the owner's own mailbox (`refresh --source gmail`), the owner's diary (`--source calendar`)
  and the owner's calls — the ones the owner recorded (`--source fathom`) and the ones others recorded and
  shared with the owner
  (`slopweaver fathom share`, whose links `fathom discover` finds in Fathom's own mail) — each as the RAW
  transcript by speaker and never the recorder's own summary. Every record from those three is private by
  SOURCE, and the string values of its text, title, attributes and raw payload pass the email redactor
  (`src/corpus/redact.ts`, an ordinary `name@host.tld` pattern) on write. Its `author` is a display name,
  else an address's local part (`src/corpus/personName.ts`), and passes the same redactor. Any object key,
  and a Calendar record's `container` and `sourceId` (built from the calendar's id, often an address), do not — `docs/security/` §§ ["The mail boundary"](security/mail-boundary.md), ["The calendar boundary"](security/calendar-boundary.md), ["The recorded-call boundary"](security/recorded-call-boundary.md).
  The owner's **ChatGPT history** joins the same way from the data export the owner downloads (`chatgpt sync`): a file
  read, no network call, every record private — ["ChatGPT"](security/chatgpt-conversation-boundary.md).
- **Do the work, not just describe it** — asked for one, raise a pull request or a ticket through TYPED FORMS
  that render themselves, so the house format is a property of the schema rather than a thing a reviewer chases.
- **Answer at a quality bar the shape enforces**: progressive disclosure by default, human-readable first,
  full provenance, and citations that are checked rather than claimed.
- **Run many workstreams at once, under one chat the owner talks to.** The supervisor chair routes each to a
  visible seat that lands its own green pull request; every question for the owner lands on the console's Queue;
  the console voice puts a spoken steer on the board — [the console](console.md), [voice flow](voice-flow.md).

Nothing on-device encodes anything — no embeddings, no vector index, no locally-built index, so there is no
model to download. For the world model, no data leaves the machine except the source reads you authorise, the
Claude calls the user already makes, and the one-token request `claude gauge` sends Anthropic to read each
Claude plan's budget.

**Four exceptions, stated rather than buried**, each opt-in:

- **`slopweaver codex`** sends prompts, repository reads and review diffs to **OpenAI** — `docs/security/codex-boundary.md`
  § "The Codex boundary".
- **`slopweaver talk offer`** mints the console voice's session with **OpenAI**, which then hears your voice
  and every tool result it reads out to you — [§ "The console-voice boundary"](security/voice-boundary.md).
- **`slopweaver chatgpt list`**, **`chatgpt live-sync`** and **`chatgpt conversation`** send your pasted **ChatGPT**
  web session back to the account it came from: `list` to list every conversation on it, `live-sync` to read each
  one whole into the corpus, `conversation` with one id you name to read that chat back — [§ "ChatGPT"](security/chatgpt-conversation-boundary.md).
  `chatgpt sync` is not an egress: it reads an export already on disk.
- **`slopweaver store backup` is NOT an egress.** It writes the corpus files (bronze among them), the atlas files outside each platform's `_sensitive/`, the `knowledge/` directory, a dump of the store, its Storage volume, Vault's secrets and the credentials, each encrypted under a Keychain-held key, into a **local directory**
  the install configures — item 13 of [§ "Data flow"](security/data-flow.md).

**The store is never an exception.** It is a local database on this machine, a hard rule: a store URL naming any host
but loopback is refused at selection, and no variable, flag or grant opens that refusal —
`docs/store/overview-and-local-stack.md`.

Start with `README.md` for the pitch, `docs/architecture.md` for the shape, and `docs/security.md`
for the trust model.

## Codebase Overview

One package, one CLI (`slopweaver <noun> <verb>`), one atom (`CorpusRecord`) flowing through three
tiers: **bronze** `refresh` (network only, lossless) → **silver** `derive` (free, deterministic, full
re-scan) → **gold** `distil` (content-hash cached, one batch per handoff) → **query** `store read`/`store cite`
(Postgres full text over the store, a fan-out of readers, grounded citations). Writing back out (`slack post`) goes through
the **admit door** (`src/admit`), the trust spine every external write is gated by.

**`slopweaver seed --demo` is the free, offline exerciser** — it writes a small synthetic four-source corpus
(`src/init/demoFixture.ts`) through the real production bronze writer, with no network and no token, so
`refresh` → `derive` → `distil` → `audit` run end-to-end in seconds on a fresh `$SLOPWEAVER_HOME`. Reading is
the store's job, so `store read` and `store cite` need a selected local Postgres with `slopweaver store load`
run against it; `seed` refuses to guess a database rather than writing synthetic records into whichever one
the install has selected, and prints the command that finishes the loop.

**No world-model verb spends model tokens to do its own thinking.** Under rule 2 the thinking happens in
your visible session: a verb retrieves and writes a brief, you compose, a verb validates and renders. What
that costs shows up in the session you are already watching, which is the point. The `codex` verbs are the
build-time exception above — a second opinion you ask for while building Slopweaver, never a verb's own work.

**`slopweaver talk offer` opens a model session, and it opens one you are talking to.** It composes the call
the console opens on your ChatGPT plan — a `codex app-server` thread whose realtime session hands the page an
SDP answer; from there the conversation runs between your browser and OpenAI, on your microphone, for as long as the
voice is on. It reasons about the code and action items it reads out to you — it does not do a verb's work
for it. [security](security/voice-boundary.md#the-console-voice-boundary-slopweaver-talk) draws the boundary; [voice-flow](voice-flow.md)
draws how a spoken steer reaches the supervisor.

**Stack**: TypeScript 7.1 beta (ESM, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`) ·
Yarn 4 · tsx · vitest · Zod · neverthrow · `p-retry`/`p-limit`/`p-throttle` · drizzle over local Postgres ·
provider SDKs for GitHub, Slack, Linear, Notion, Google and more. Nothing on-device encodes anything: no embeddings, no model. `talk` composes a
browser-owned realtime call on the ChatGPT plan and carries none of its media, and `codex` drives the Codex SDK for the
build-time second opinion — see rule 2.

**Structure**: `src/cli` (dispatch, lazy-loaded manifests) · `src/corpus` (bronze + the source connectors, plus the
`members/`, `structures/` and `history/` sibling stores) · `src/silver` · `src/gold` · `src/retrieval` ·
`src/outbound` (artifact / Slack `rich_text` / lifecycle) · `src/pdf` (the PDF text extractor a doored attachment reaches, judged on the bytes, never OCR) · `src/admit` · `src/codex` (the Codex brain; a pass's
sandbox writes its scratch under `$SLOPWEAVER_HOME`, never the repository) · `src/connect` + `src/secrets` · `src/stateHome.ts` (the one typed
`$SLOPWEAVER_HOME` contract) · `src/lib` (progress + the resilience stack) · `src/devLint` (the bespoke
ratchets) · `src/coderabbit` (validates the committed `.coderabbit.yaml` against CodeRabbit's own schema) ·
`src/__tests__` (zero mocks).

Counts are deliberately absent: they rot between the writing and the reading, and this file is loaded into
every session as instructions, so a stale number here is a false fact handed to every agent. For the current
inventory run the command — `slopweaver catalog` for the verb surface, `slopweaver catalog health` for what
state that surface is in, `yarn lint` for the checks that
actually run, `find src/__tests__/unit -name '*.test.ts'` for the suites. The **Structure** list above is
the same kind of snapshot and rots the same way — it names the modules that existed when it was last
extended, not every module `src/` now holds. Run `ls src` for the current set rather than treating that
list as exhaustive.

For the architecture and data-flow diagrams, see [docs/architecture.md](architecture.md).

## Two facts that are not derivable from the code

Cheaper stated here than found the hard way, and both are why a planning pass should read this page before
proposing machinery.

- **`slopweaver seed --demo` is the free, offline, whole-loop exerciser.** Before reaching for credentials, a
  cassette or new fixture machinery to test anything downstream of ingest, check whether this covers it. A
  planning pass once proposed building mocks for something this already solved.
- **There is no semantic leg, no vector index and no locally-built lexical index** — retrieval-augmented
  generation is dead here. `store read` and `store cite` select from the local Postgres store with full text plus structured
  filters, newest first, and a fan-out of cheap readers judges what comes back. Nothing to build, nothing to
  download, nothing to keep fresh but the store itself (`slopweaver store load`).

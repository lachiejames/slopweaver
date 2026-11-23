---
name: route
description: Plan the current, historical and unavailable sources a visible agent should consult before answering or acting. Use when an investigation may span live provider state, repository state, the local world model, an atlas, compliance evidence or another installation-specific source, and the legs have to be planned before anything is read.
argument-hint: <question>
---

**You are the visible supervisor.** This command plans sources; it calls no source and runs no model.

Run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" route plan --question "$ARGUMENTS" --json
```

If the repository's authority instructions give you an explicit private capability-profile path, add
`--profile <that-path>`. Never guess a path and never copy private capability rows into this shared plugin.
An available profile command may use the exact argv element `{question}`; the returned plan has already
replaced every occurrence with the question as one argument. Do not interpolate or evaluate it again.
An argv whose first element is the exact token `slopweaver` is likewise returned with that element replaced
by this plugin bundle's absolute launcher. Private profiles should use that token for plugin-owned verbs;
never embed a cache path or rely on ambient `PATH`.

Read the returned plan literally:

- Consult every `required` available leg in order, executing its materialised `command` argv without a shell.
  A `current` leg cannot be replaced by history.
- Use an `optional` history leg only as context; do not let it answer a current-state claim by itself.
- Report every required `unavailable` leg and its reason. Do not silently fall back to the world model.
- A SCOPE leg declares a command that reads what it can reach rather than the question — which drives, which
  mailbox, which Chrome profile, which credential, which roster. Every door (`drive`, `gmail`, `calendar`,
  `browser`) is one, and so are `github-live`, `linear-live`, `notion-live`, `slack-live`, `attachments`,
  `hex`, `telemetry`, `identity-directory` and `knowledge-register`. Reading is your own next act, composed from
  the question and named in that leg's `coverage`: the query syntaxes here are exact, and a question passed
  whole to one returns an empty page that reads as absence. A door the install never connected arrives
  `unavailable` naming the verb that connects it.
- **A credential that is not a door's grant is graded by nobody — so read the store before calling a leg
  unavailable for want of a token.** The three Google doors are the exception: `connectionReadings.ts`
  reads `gmail`/`drive`/`calendar`'s grant files straight off `$SLOPWEAVER_HOME/secrets/`, so an
  unconnected one already arrives `unavailable` naming its connect verb — while `browser` is graded off
  its recorded Chrome profile rather than off a credential, though `playwright-extension-token` in that same
  store is what lets a walk run without Chrome's consent dialog. Every other credential — a Vanta client id,
  an API key an atlas sits on — is graded on whether the surface answered, never on whether the token
  exists. Run
  `slopweaver secrets status` (by absolute launcher, as above): it names every credential this install
  holds, with its platform, scope, expiry and reader, and never a value. MEASURED: a live turn
  reported "no Vanta credentials available" and asked the owner for two files already in that directory.
- **WHICH document is a provider leg. WHAT IT SAYS is `attachments`.** A file's extracted words are one
  leg for every door, because the question rarely names the door — "what does the signed DPA say" selects
  none of Slack, Linear, Notion or Vanta. Finding which message, issue or page HOLDS it is the provider leg,
  and `gmail` is the one that can do only that half: its words are two hops. Three things that leg cannot
  reach are named in its `coverage` rather than left to be discovered — there is no OCR, a Drive PDF's bytes
  are never downloaded, and GitHub serves no document read. A scan's words are unavailable, not unread.
- An ATLAS leg exists for every platform this build registers, whether or not anyone wrote a row for it, so
  a `<platform>-atlas` id you have not seen before is a real source rather than a typo. One that cannot
  answer arrives `unavailable` carrying its own grading — read that reason; it distinguishes a permissions
  fence from a gap from a surface nobody has attempted.
- **A filled atlas is not a reachable one.** `atlas doctor` grading ANSWERABLE proves the atlas can answer,
  never that a turn routes to it — measured once, google-admin graded ANSWERABLE at thousands of entities
  while the bot had no route to it. Before saying an atlas is queryable by the bot, run
  `slopweaver turn brief --contracts --text "<the real question>"` (read-only: no brief, no lifecycle row)
  and confirm `<platform>-atlas [available]` among its contracts. When a per-install row is missing, tell a
  row the profile loader SKIPPED as malformed (it is named, `parseCapabilityProfileRows` in
  `src/route/profile.ts`) from one never declared — the second is data, added with `route capabilities-merge`.
- A leg matched `census:service:<name>` was offered by the Datadog CENSUS rather than by a word in the
  question: the question names a service this organisation really emits telemetry for
  (`src/route/censusReading.ts` — a whole service NAME that is not ordinary English, or a hyphenated run
  of two or more of its segments). A leg matched ONLY by the census rides `optional`, never `required`,
  and a census name is never ranked above a leg the question's own words matched — a row the question also
  names by a declared term stays required and carries its census markers beside them. `asset-management`
  is a real service here AND ordinary business English, so a name alone is a HINT that what happened is a
  read away — `datadog logs` for the count, `store detect` to fan detectives out — never evidence that the
  question is about telemetry. A telemetry word makes required only the row that DECLARES that word: on
  the generic table `logs` makes `telemetry` required and leaves `datadog-atlas` optional carrying the
  census marker alone.
- Treat `effect: write` as a description, not authorisation. Use the owning typed workflow and its approval gate.
- State freshness, coverage and exclusions in the resulting answer or artifact.

The plan is host-neutral JSON. Claude Code and Codex must select the same legs for the same question and
profile; only their invocation syntax differs.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.

If repository authority instructions name a private capability profile, pass that exact path with
`--profile`. Execute required available legs in order, keep history optional for current claims, and report
unavailable legs rather than substituting plausible corpus material. Never invoke Claude or another model.
The plan has already replaced any leading `slopweaver` executable token with this bundle's absolute launcher;
execute the returned argv unchanged and without a shell.

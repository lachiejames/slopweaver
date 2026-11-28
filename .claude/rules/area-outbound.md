---
paths:
  - "src/outbound/**"
---

# Working in `src/outbound/`

Everything the fleet SENDS. Scoped to this tree; the doctrine it implements is `AGENTS.md` rule 7 — concise
above the fold, everything else collapsed, enforced by the SCHEMA rather than by review. `privacyCheck.ts` is the ONE outbound
privacy check, pure, the same rules for every destination: `publicationScan.ts` (an image's pixel text included, read on this machine, its residue in `docs/security/hygiene-gate.md`) and the GitHub, Slack, Linear, Notion, Google Calendar and Gmail write transports (`github/`, `slack/`, `linear/`, `notion/writePrivacy.ts`, `calendar/writePrivacy.ts`, `gmail/writePrivacy.ts`, every write before the wire, Gmail strict, policy read afresh each time) call it; a refusal line a private term matches prints as `WITHHELD_REFUSAL_LINE`, which no term may match. Every guard decides through `privateTermReview/gate.ts`: a match on a row carrying the owner's meaning HOLDS the write for a fresh review in context, a CLEAN receipt releasing those exact bytes once; the list is edited only through `slopweaver private-terms`. A new write family is classified in `src/devLint/outboundPrivacyRegistry.ts` (guarded, read-only or named residue), held closed by the `outbound-privacy-closure` gate. Blind to paraphrase,
which an AI assessment owns, unbuilt pending the owner's call (its header is the contract; the verdict says `unassessed`).

## Every form is strict, and the refusal names where the content goes

`strictForm.ts` is the one way an outbound form object is declared. A plain `z.object` DROPS an unknown key,
and nothing at parse time can tell an invention from a mistake — so the only safe reading is that a key
nobody declared is a key somebody meant. A ported alert payload once carried `impact`, `rootCause` and
`fixStep` into the digest form: it validated, previewed clean, exited 0, and posted a card whose entire
substance was missing. Zod's own `Unrecognized key` names the key and stops; these refusals say where that
content belongs, because the schema is the only thing that knows.

## The fold is a structure, not a length

`voice/aboveFold.ts` owns the PACKING rules a machine can decide: colon-introduced lists,
semicolon-joined clauses, a second parenthetical aside, an over-long sentence. Length was never the defect —
one measured rewrite came out a word LONGER and read far better. Which fact LEADS stays a judgement, bar one
computable case: a message to a teammate opening on a pull request is refused at record and at every send (`slack/draftPrLead.ts`; producers in `slack/prLeadSeams.ts`).

A code run and a link are skipped when prose rules scan a form, because an identifier and somebody else's title are not the
author's voice; `strong` and `em` ARE scanned. The one code span read is a Linear key, which `artifact/bareRefRuns.ts` links
or refuses. Each skipped run contributes one space rather than nothing, which is what stopped an identifier's trailing full
stop from welding two sentences together. It is not airtight: punctuation INSIDE a skipped run goes with it, so a link label ending a sentence still joins that sentence to the next.

## A separator is never authored — the headline form, and the gate beside it

`artifact/headline.ts` is the shape a card's TL;DR takes when a composer owns every word: an ordered list of
CLAUSES, one idea each, joined by `HEADLINE_SEPARATOR` which no caller supplies. A separator is punctuation
BETWEEN two ideas, so the only author who can get one wrong is one holding both ideas in one string — take
them as two fields and there is nowhere left to type it. It came off a card that could not post because its TL;DR carried a
hard-coded em dash: a schema shape per Slack posting makes a mistake impossible to repeat, which costs far less
than catching it after the fact or following a long skill file.

**The refusal is on the CLAUSE, never on the rendered `tldr`**, and that distinction is the whole design.
`digest.ts` and `alertSummary.ts` DERIVE their TL;DR and re-validate it through `updateArtifactSchema`, so a
character ban there would refuse the two lanes that already do the right thing while missing every composer
that hand-builds a card. `tldr` is also an untyped string with no `quoted` flag — the scar
`artifact/aboveFold.ts` records, where a Datadog monitor title cost two channels their first daily card.

**Where a line QUOTES somebody else's words it cannot take the clause form**, and `live/turn/failureForm.ts` is the worked
example: its TL;DR embeds the asker's own question. Those write two sentences instead, and `authored-separator` in `yarn lint`
is what keeps a separator out of them — a no-hatch gate, in place of a runtime hard block. Its blind spot is a separator reached through a named constant, which is deliberate: that is the pattern being generalised.

## Voice rules are a briefing input before they are a gate

The rule SHAPE is public; an operator's actual banned characters, words and phrases live in private
`profile.json` configuration and never in this repository. `slack voice-rules` prints them BEFORE a word is
drafted, because the literal em-dash rule alone cost four full compose-refuse-rewrite cycles in one window.
That briefing is ENFORCED: `voice/briefingAdmission.ts` refuses new words in the owner's name from a visible session
holding no receipt for the current brief, and the refusal prints the brief. Every drafting path that builds a
prompt (the talk mint, the Codex comparison) puts the brief in it; one that does not is a P0, the owner's ruling.
Judgement rules do not belong in `voice/exactRules.ts`: it can prove only an exact literal or lexical match.

## A clickable URL is graded, and one Vanta address is refused outright

`artifact/vantaLinks.ts` refuses a Vanta policy-DOCUMENT URL in a `link` run or a `primaryLink`, naming
`https://app.vanta.com/employee/onboarding` — the reader's own security tasks, whose first row is the Accept
action — as the replacement. The acceptance DM's links were the document addresses the
Manage API hands back, and clicking one painted a blank page and downloaded a PDF.

Two halves, and the second is the one worth remembering. `runSchema.ts`'s `clickableUrlSchema` grades the
authored field, and is the ONE place a clickable URL is graded — the three run vocabularies are spelled as
three lists deliberately, so a fourth must reuse this rather than re-declare `url: z.url()`. But conversion
runs AFTER the field schemas, turning a bare URL pasted into prose into a real `link` run, so the second
check sits inside `typedRuns.ts`'s `rawMarkupIssuesOfRuns` — the one seam every form already calls, which is
why there is no per-form call site to keep in step. Every FORM-FILLED message is covered — which is everything `--as bot` can send, since that
verb is `--form` only, and a digest transitively because `digestFormSchema` validates the card it derives.
Four things sit outside it and the module names each: `renderRecipeResponse`, which takes an
ALREADY-RENDERED wrapper and so fills no form — its one producer, `recipe slot-post`, went with the
spawn-dispatch family, so nothing reaches it today and the class it belongs to is the
same uncovered-producer one this file already names about the PII pass; a PROVENANCE url (a citation, a digest `citationUrl`, an answer's evidence lines); the
`--as me --body` raw escape hatch; and the briefing page's own `link` run.

## A dead Datadog console host is refused at the write TRANSPORTS, not in a form

`invalidDatadogHost.ts` refuses any payload carrying `app.<site>` for a regional site whose console is
elsewhere — `app.us3.datadoghq.com` is the shape, where the console is `us3.datadoghq.com`, and the case that
shipped was this install's own site. It
is judged where the bytes are final: the Slack `GuardedWebClient`, the GitHub write `Octokit`'s request hook,
the Linear mutation sender, the Notion write client's and the Gmail auth client's `fetch`, the Vanta Manage transport and the browser-driven Vanta
policy seams, and the file uploads (Slack `files.uploadV2`, `github attach`, `linear attach upload`, `notion attach`) read their bytes as text, `github attach` its PNG's pixel text too (macOS Vision on this machine, `visualEvidence/imageTextRecognition.ts`), so a composer added later is guarded by construction and no form schema has to remember it. A token, field or upload address a
provider's response hands back for the next write is judged too; a redirect, a header and a payload built to change
after it is judged are the module's stated limits. The door is the wrong seam — its
`artifact` describes a write, not its bytes. The cost is stated: a DRY RUN crosses no transport and does not
refuse; the PR-format gate is the one composition-time check, because CI reads a description and never a
transport. A quote that has to carry the host opens the journalled `invalid-datadog-console-host` hatch. A
payload carrying declared credentials (`withholdHits`, the Vanta token mint) is judged the same, but its refusal
names no host: the found text is the payload lowercased, so it could be a credential.

## A figure owes the command that measured it, and the obligation is per-FIGURE

`assistant/measuredFigures.ts` is the fourth show-your-work rule in `parseAnswerArm`, and it is DOCTRINE —
the owner took the lean on a recorded question that put the composer cost in front of them rather than the
principle alone. A measurement in CODE has carried its own inline repro command since
`.claude/rules/typescript-patterns.md` § Other rules; nothing bound a number in an outbound ANSWER the same
way, and a quantified claim asserted with no measurement behind it broke every one of P2's four review rounds.
So `answerArmSchema.measurements` exists and a figure the list does not cover is refused.

**The cost is what the owner ruled on, so it belongs beside the rule.** Measured over 180 real reviewed answers the
criterion below asks a median of 2 entries, 39 of the 180 owe nothing at all, and the worst answer in the
corpus — one that already shipped — owes 23. A rule whose own cost is unmeasured is one they cannot weigh, and
the `src/hatch/outboundDeliveryHatches.ts` row is `ruled` rather than `proposed` because that figure was on the question.

**Two design choices are the load-bearing part, and both are the citation budget's lesson re-applied.** The
criterion is NARROW and measured — a thousands-separated count, a bare three- or four-digit run, a percentage
decimals included, with dates, versions, clock times, padded fields, welded words, bare 5+ digit identifiers
and already-linked figures all masked — because the naive every-digit reading demands a median of 20 entries per answer against
that criterion's 2, and a hatch that is always open is the weaken-the-gate move arrived at by accident. And
one ENTRY carries a non-empty `figures` LIST against one `repro`, with **no `.max()` on the array**: entries
are bounded instead by TWO hatchless refusals — any position naming a figure the answer never asserts, and any
figure covered twice. Both are needed, and the review that read this change is why the second exists: with only
the first, forty entries all naming one asserted figure passed every check, so the bound three canon surfaces
asserted was a convention nothing enforced. A cap plus a per-figure obligation is the mutually-exclusive-rules
trap `citedAndShown.ts`'s `citationBudgetCollision` already records. The measurements, the four-row narrowing
table and the `jq` repro are in that module's header; what a composer reads is
`skills/loop-bot/reference/measured-figures.md`.

## A small-sample figure states its n in the same sentence

`assistant/smallSamples.ts` is the fifth show-your-work rule in `parseAnswerArm`. It takes the INLINE placement
over the fold. That is the only placement a reader who never expands still
sees. `answerArmSchema.samples` declares `{ figure, n }`. A figure under `SMALL_SAMPLE_THRESHOLD` (50,
measured on the class-C thread's own verdicts) is refused unless the sentence stating it carries `n=<n>`.
There is no hatch on any leg, because writing the n is always possible. An unused entry and a duplicated one
are refused, which is what bounds the list. It is declared rather than scanned: the figure criterion in
`measuredFigures.ts` masks `12.4s`, and the n is not in the answer's bytes anyway. So an UNDECLARED sample
is the stated residue.

## A graph finding carries three screenshots, and that one is a floor

`assistant/graphFindings.ts` refuses an answer that declares `measurements` and links a Datadog graph view with
fewer than three DISTINCT images. The
cited graphs ARE what to photograph, so `graphFindingFloor.ts` replaces rule two's question, at a held release and
an edit too, past only by the journalled `unshown-graphs` hatch; it reads content, not origin. Wider and lower, `artifact/datadogCitation.ts` owes ONE picture of any message citing a Datadog console page, on every surface. A bot `finding`
card (`artifact/finding.ts`) always owes it over `--media` DIGESTS, cites a system-of-record view (`artifact/findingEvidence.ts`, never a tracker), its priority (`findingPriority.ts`) shown WITH
its reason, P3/P4, tracked or no `priorThread` refused, the ONLY top-level post a high-stakes channel admits (`slack/highStakesChannel.ts`); a daily `cost` never moves the matrix, and a costed P0/P1 must tag its `escalate` people while nothing else may. `slack/findingDestination.ts` holds it to an approved `--as bot` share
into the channel and thread its queue card named, never a DM, and no destination rule; `slack/findingIdentity.ts` signs a top-level channel finding
the bot, under the owner's identity only where the bot cannot post, read LIVE under the bot token, stamped on the row, re-read at release; no hatch.

## Before you add a field above the fold

A cap is not a suggestion and the form REFUSES rather than truncating. Pay for a new above-the-fold field by
moving an existing one below it. The one field that does not pay is a card's day-one `intro`: the owner
asked for it by name, it rides one post per scheduled row, and it sits outside `ABOVE_FOLD_VISIBLE_MAX`. A `problem` declaration (`artifact/problemReach.ts`) adds nothing above the fold: it refuses a top region that omits the reach it declares. An `opening` declaration (`artifact/channelOpening.ts`) is the same shape: a top-level channel post's top region carries what it is, then what it asks.

## The recommendations lane pays for itself below the fold

`artifact/recommendations.ts` is the lane both alert card kinds carry: the act that clears each ranked
finding, first in the detail. Two properties are arithmetic rather than judgement, and both have a test
rather than a comment. Every field is capped so the widest line is EXACTLY `BULLET_ITEM_VISIBLE_MAX` (200),
because trimming a recommendation changes what it says — where a trimmed index line only loses a few
characters of a title. A line reporting a pull request the bot already raised (`raisedPrUrl`) comes to
195, because the link REPLACES the act word rather than joining it: `visibleLength.ts` costs
a link its LABEL, and there were no five characters to take back from `change`, `target` or `owner` without
REFUSING a recommendation that already ships. And the authored strings REFUSE `<`, `>`, `@`, a `[n]` marker and a URL: those runs
cross `typedRuns.ts`'s conversion like any other, so an authored `<!here>` would become a real broadcast on a
card whose whole rule is that day one tags nobody.

## Every rendered card crosses the PII pass

`slack/piiRedaction.ts` runs over the rendered payload and replaces **email addresses and IP addresses** with
`[email]` and `[ip]`. It is a PAIR of decisions: nothing
masks in what the bot READS (a Datadog hit comes back with `usr.*` and `session.ip` whole, because redacting
mid-investigation is a hindrance), and the redaction lands at the post, which is the one place an audience
appears.

**It runs at each RENDERER, and "the one function every card crosses" was three times the wrong answer.** It
first went into `renderUpdateCard`, and the bot's answers build from `answerWrapper` and never reach it. Moved
to the wrappers, review found `renderRecipeResponse` uncovered (a card read off DISK; no verb does that today,
the call stays for the next one), and a later audit found every automation prompt and canvas posting an email
and an IP whole. So the call sites are `answerWrapper`, `renderFullChromeWrapper` (`turnMessage`, `pollRender`),
`renderUpdateCard`, `renderRecipeResponse`, `renderNoFoldMessage`, and for a canvas `canvasDocumentContent`
and `canvasWireTitle` (`src/corpus/slack/writeApiCanvas.ts`, every create and replace, either lane).
**The real closure is a gate over outbound payload producers, which does not exist yet.** Until it does, a new
payload builder that skips the pass is refused by nobody. Add one, and add the call. Two CLI prints call it too,
over one free-text field each: `session list`'s note and `cmux usage`'s title, plain and `--json`.

**The class is narrow on purpose and the line is stated rather than implied.** A UUID is NOT redacted, user
id included: it is routinely the ANSWER, and the owner's own IP-to-uid correlation ends in one. A person's NAME is
not redacted either — a post to the installation's own Slack is its own surface, not the repository. Secrets are a
different class with different owners (`src/hygiene/scan.ts` at the gate, `src/corpus/redact.ts` on the way
into the corpus); this pass is not a second copy of either, sharing only `src/lib/emailAddressPattern.ts`.

The false positives are what a pass on every outbound message lives or dies by, so they are tested by name:
an ISO timestamp, a bare clock time, a Slack `ts`, a URL with a port and a Datadog query all survive
unchanged. The IPv6 pattern runs BEFORE the IPv4 one, because `::ffff:203.0.113.7` contains a complete IPv4
address and the other order ships a half-redacted `::ffff:[ip]`.

**The owner's DM is an allowlist and never asks them.** `slack/dmPurpose.ts` holds a bot DM declaring no `--dm-purpose`,
`slack/ownerDmAsk.ts` refuses one asking them anything (questions go on the Queue), and
`slack/priorAsk.ts` reuses that ask tell so an answered question is never re-asked bare. No hatch.

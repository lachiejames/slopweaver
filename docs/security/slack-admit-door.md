# The admit door, described honestly

Part of [Security & trust](../security.md).

Every side-effecting action is routed through one gated pathway (`src/admit`) that returns
`pass` / `warn` / `hold`, and records the decision in a local ledger. A `warn` is returned to the caller as
a structured finding and can be waived per-action with `$SLOPWEAVER_DOOR_OVERRIDE=<token>`; a `hold` is the
irreversible-harm class and is **not** waivable that way. A shipped ratchet (`dev door-coverage`) fails the
build if any side-effect seam is not routed through the door or explicitly acknowledged as a local-state
write — so the routing guarantee is machine-checked rather than asserted.

**What the door does not yet do:** its gate list is **empty by default** (`DEFAULT_GATES = []`), with gates
injected per call site. The one content gate composed widely is the voice-profile gate
(`src/admit/voiceProfileGate.ts`): the Slack verbs that author prose — post, reply, drip, edit, poll, canvas,
channel create — and the bot's answer and its thread title pass it, and it matches that prose against the
operator's private exact rules for the lane's actor (the bot or you). An unoverridden match is a `warn` with the
override `voice.profile:v1`, so a released violation is recorded as an override. A turn's own working frames and
notices, and the Linear, GitHub and Notion prose writes (issues, comments, pull requests, pages), pass no
content gate at the door, so for those the door is a _routing, audit and refusal_ mechanism, and **not** a
general content policy. Narrower checks exist BEFORE the door — the above-the-fold gate
(`src/cli/aboveFoldDoor.ts`), which checks packing and the operator's exact character, word and phrase rules on
what a reader sees before expanding anything (a Slack bot card, a pull-request description or GitHub comment, a
Linear issue, comment or project or initiative status update, and a Notion page's lead), plus the bare-reference
and cited-controls gates. Each refuses before any network call and names a per-invocation override. The bot's
answer is also checked, before the door, against the Slack wire guard below: an answer that guard would refuse
is refused with nothing sent and the turn left open, never posted as a public failure
(`src/live/turn/answerSendable.ts`). AFTER the door, at the transports, two refusals remain: Slack's wire guard
refuses the raw link and mention markup its scanner recognises (`src/outbound/artifact/typedRuns.ts`) in a
`rich_text` text run outside a code span or preformatted block (`src/outbound/slack/typedRunsOnly.ts`), and a
dead Datadog console host is refused on every write through the Slack, GitHub, Linear, Notion and Vanta API clients and
the browser's Vanta seams unless its named escape hatch is open (`src/outbound/invalidDatadogHost.ts`); a host
inside a compressed or base64-encoded stream, or drawn into an image, and a provider's HTTP redirect to one,
are that guard's stated limits. A dry run crosses no transport, so it can preview a link the live write then
refuses. Those scoped checks do not make every admitted write content-checked.

**A pre-door refusal leaves a row.** Refusing before the network call also means refusing before
`throughDoor` records anything, so without its own row such an attempt leaves the ledger empty-handed:
MEASURED: all 199,954 rows were `pass`, `warn` or `hold` and nothing else, and "did that card
ever try to go out, and what stopped it" cost a code read. The above-the-fold gate
writes a `status: "refused"` row to the same door ledger (`door_event`), carrying the findings that fired and the
escape hatch they named but no authored prose, read back with `slopweaver dev door --refusals`. Its coverage is
partial on purpose and the report says so on every run: the other pre-door gates listed above are still
unrecorded, and the write is best effort (a failed write is logged and the refusal still stands), so an empty
result is not evidence that nothing stopped a send. A DECISION is the opposite: `throughDoor` records it before
it performs, and a store that cannot record it means nothing is performed (`recording-refused`).

**An as-me send that did not go out is journalled where it was aimed.** The door ledger keeps no channel or thread,
so "did the reply the owner approved on the call go, and what stopped it" had no answer.
Every as-me post or reply refused before or at the door, or a drip of which nothing landed, appends one line to
`ledgers/slack-send-failures.jsonl` (`0600`): the instant, the channel and thread, and the refusal's own words
folded to one line and cut at 800 code points — never the message (`src/outbound/slack/sendFailureJournal.ts`).
`talk slack-send-outcome` reads it beside the live thread and the held-draft register. A dry run writes nothing,
and a line that cannot be written is said on stderr without changing the send's exit code.

**What it does enforce is the approval claim itself.** A request whose `meta.requiresApproval` is true,
passing a gate list with no gate built by `approvalGate()` (`src/admit/approval.ts`), is `hold` — the effect
never runs, so the claim is never decorative (measured in `src/cli/catalog.ts`'s header: the marker sat on
37 verbs passing the empty gate list, `write vanta deactivate` among them). No verb-level approval
boolean exists (`catalog` prints `[external-write]` from the field the coverage ratchet enforces), and every request that declares approval — `gmail send`, every `write vanta`
verb, and a `calendar` write that reaches another person or redeems a held one with `calendar commit` —
passes a real gate that HOLDS without a content digest. **None of this
authenticates a human**: the same process that prints a digest can compute one. What it buys is that the act
takes a second deliberate step naming the digest of the content it approves, and that the unapproved attempt
is recorded as refused. The digest binds what the verb computed it over: `write vanta upload-policy-version`
hashes the PDF it rendered, and inside the door re-reads the file it staged under `$SLOPWEAVER_HOME` and
refuses before any browser opens unless it still hashes to that value. The browser is then handed the PATH,
so the window between that re-read and Playwright's own read of the file stays open
(`src/cli/commands/vanta/policyUploadIntegrity.ts`).

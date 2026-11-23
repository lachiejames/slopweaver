# The styling system: Tailwind v4, shadcn/ui and the `ai` SDK's UI layer

Part of [The console, the board, and the session ledger](../console.md).

The console draws with the same UI stack as the SaaS archive it is being ported from, because the owner wants the
SaaS and the local-first tool to be one thing at least in their UI parts: **Tailwind v4**,
**shadcn/ui** components owned in `site/components/ui/`, and **AI Elements** (`site/components/ai-elements/`),
which render the `ai` package's `UIMessage` parts. `ai` is a TYPE and component dependency here and nothing
else: no `streamText`, no `ai` provider package, no model call — the parts are built from transcripts
visible sessions already wrote, so rendering them adds no egress and no model beyond [the voice above](work-console.md).

`app/console-tw.css` is the console's one stylesheet, and its layer order is the design:
`theme, base, components, console, utilities`. The reset is Tailwind's own preflight, over every console page,
so markup draws with no browser defaults: a heading that is bold, a list that is bulleted or a bare `<button>`
that has a face says so with a utility (`font-bold`, `list-disc`, `BUTTON`). The palette and the few element
rules the whole console shares — the document's ground and font, a link's teal, inline `code` — sit in `base`
beside it. There is one palette: shadcn's variables are names for the `--c-*` tokens, on `:root` so a Radix
portal outside `.sw-console` still reads them. `diagram.css` is the one other file, in `console`, above the
reset and below utilities; it keeps only what `/docs` also draws — the figure frame, the verb catalog and a
tile's note, table and unmeasured states — and the `/docs` root layout imports it beside Nextra's theme, never
`console-tw.css`.

Everything else is utilities, and a shape two places draw is one exported string rather than a restatement.
The queue list (its one bar, the rows, their section heads, a press's outcome line and the counting fold at the bottom)
draws with utilities alone, and a register's hue is one map, `kindHue` in `components/console/queueKinds.tsx`,
which the row's stripe and its tile both read. `components/live/SlideOver.tsx` exports the panel's shared
shapes (`SLIDE_BODY`, `SLIDE_SECTION`, `SlideFoot`, `SLIDE_FOOT_NOTE`), which every page's panel draws with, and
everything a panel reads — the Slack thread and its held reply, a parked Slack draft, and the Slack and mail
previews, whose card is one shape (`PREVIEW` in `components/console/SlackActionPreview.tsx`) — is drawn the
same way. `components/live/Row.tsx` exports the one row every state page draws (`ROW`, `ROW_TAG`, `ROW_FOLD`,
`ROW_NEXT`, `ROW_FIELD`, `COUNT` and the rest), which /fleet and the pull-request page read. The pull-request page's ask line, ask trail and
suggested-reviewer card draw with them too.
`components/live/Tile.tsx` exports the page's column and a tile's figures (`TILES`, `STAT_ROW`, `STAT`,
`TILE_LIST`), which /fleet and /pull-requests share. `PAGE_BODY` in
`components/console/PageHead.tsx` is the content column under the bar, and the sidebar's context switcher
reads its icon-rail shape off the shell's `data-sidebar`. The console voice's orb
(`components/voice/VoiceWidget.tsx`) sets its ring colour as a custom property per `data-mood`, and draws the
stage's own look (`StageOrb.tsx`) at a calmer `orbTuning`; only its badge's `animate-orb-pop` is a theme
utility. The chips and buttons are `CHIP`, `BUTTON` and
`BUTTON_PRIMARY` in `components/console/controls.ts`, which the queue and every panel read.

## The second read by id: one session's latest turn, `app/api/session-turn`

`/fleet/session/<id>` draws one running Claude session's latest turn and the one before it read-only — the typed prompt, then every
text, thinking block and tool call after it, each call joined to its result — with AI Elements'
`Conversation`, `Message`, `Reasoning` and `Tool`, read once when it opens and again only for "show earlier" — never on
a timer, so it holds still while the owner reads it. The Fleet page's session panel
draws the same view beside a properties column. The route is the
`api/thread` pattern again: its slots are a session UUID and a turn count from 1 to 40
(`site/lib/sessionTurnVerb.ts` refuses any other shape of either) and it runs
`slopweaver transcripts last-turn --session <id> --turns <n> --json`, which reads only the last 8 MiB of the
transcript, caps every string, redacts secrets and keeps the newest 400 parts across every turn it answers
(`src/transcripts/lastTurn.ts`). Each turn is keyed by its opening record's uuid, so a wider read never re-keys
what is drawn and a reader scrolled up stays where they are. A turn long enough to push its own opening out of
that tail keeps its key only while the read still holds one of the tool calls already drawn — the proof it
is the same turn (`carryTurnId`, `site/lib/sessionTurn.ts`); without that proof it is drawn afresh once, never
merged into the turn before it. The view opens on two turns, and "show earlier" reads ten more a press, never past what the tail holds or the
40-turn cap. The view holds its folds by tool-call id across reads, so a read carrying a
duplicate id, or one the verb cut to its cap or redacted, is refused as NOT MEASURED rather than drawn.

The tool activity is the archive's progressive disclosure (`site/lib/toolGroup.ts`, pure and unit-tested):
every run of consecutive tool calls between two pieces of prose folds into one row, summarised in Claude
Code's own vocabulary — reads, searches, web reads, edits, commands, subagents, and each MCP server by name —
with its calls behind the fold in the order the session made them; a run holding
a failed call opens itself, the failed call drawn open inside it, until the reader folds it — and again for a
failure they have not seen. Every fold the reader presses is held once for the whole view and keyed by call
id, and every part by its place in the whole turn, so neither a run growing nor the 200-part budget dropping
a run's oldest call collapses what the reader opened — a run cut back to one call keeps the reader's newest
press, on the call or the run, and a press on a run's only call is a press on the run, so a call joining it
later cannot revive an older one. Each read copies a run's newest press onto every call it now holds, so the
budget dropping the pressed call leaves a survivor that still answers for the run; a read that drops every
call the reader saw at once draws a run they have not pressed (`pressFolds`, `adoptRuns`, `callOpen`,
`runOpen`, `site/lib/toolGroup.ts`).

A seat carries `session watch`'s own `sessionId`, so the Fleet page's session panel opens the transcript by it
and never joins on `cwd`; a seat whose reading carried none says so as NOT MEASURED rather than guessing.

## The one door that writes: `site/lib/actVerbs.ts` and `app/api/act/[verb]`

The queue's panels APPROVE, not only read, so the console has one door that writes, and its shape is fixed: `actVerbs.ts` is a third closed list beside `liveVerbs.ts` and
`syncVerbs.ts` (the thread and session-turn routes are closed too, each a by-id builder with one slot —
`threadVerb.ts`, `sessionTurnVerb.ts`), every row one verb with a literal argv, and the only thing a request
may supply is the value of a SLOT the row declared — an `id` (a register's identifier, never a leading
hyphen, so it cannot be read as a flag) or `text` (up to 2000 characters, never a leading hyphen).
Unknown slugs 404; unknown fields, a wrong shape and an oversized body are refused with the reason. The rows:
`hand done`, `hand snooze` (one row per answer), `queue defer` and its `--restore` (Come back to it, two slots,
`kind` and `id`, [the Queue](queue-and-triage.md)), `autonomy steer` — each `--by-session work-console` so a ledger row the console
wrote is tellable from one a session wrote — the mail preview's two presses,
`gmail-draft-board-dry-run` and `gmail-draft-board` ([below](queue-and-triage.md)), the suggested reviewer's
`reviewer-approve` (`github reviewer pick --verdict approve`, which records the owner's verdict and sends nothing),
and the Proposed workstreams presses on `/workstreams`, every one a `workstream-*` row writing the same ledgers
the voice does: `workstream-react` (`workstreams react --candidate <id> --as <word> --via console`) and its placing
siblings (`-same-as`, `-milestone-of`, `-outcome-of`, `-not-mine-covered` and `-accept-steer`),
one row per flag combination because a slot is never optional; the `-define-*` rows (`workstreams define`: an
offered option, or all of them with which comes first); and `workstream-loop-in`
(`workstreams loop-in`), which parks the owed conversation on the Queue and sends nothing. `github enqueue` is absent until its dry-run
report is shown before a press; `gmail send` until a verb lists the owner's drafts by draft id. `ask`, `turn` and
`cmux spawn` are on no list. The voice's `talkToolsList.ts` is a separate list, and nothing in it resolves to a
row here.

**What the boundary proves, exactly.** The route refuses a POST with no `Origin`, an `Origin` that is not
this loopback host and port, a `Sec-Fetch-Site` other than `same-origin`, or a body that is not JSON — so a
page on another origin and a stray navigation cannot press. It does not claim to tell a human's press from a
process already running as the owner; that residue is the one the journalled-grants contract names and accepts. Nor
does it keep another HOST out: every header it reads is one a client writes. The bind does that — every console
server `scripts/docs-site.sh` starts listens on 127.0.0.1 alone (`console_host`), so every route, guarded or a
plain read, refuses a connection from off this machine.
MEASURED against a throwaway `$SLOPWEAVER_HOME` seeded with one hand step and one act: both
buttons wrote their rows (`hand list` empty after, the steer row carrying `bySession: work-console`), and
no-origin, foreign-origin, other-port, cross-site and form-typed requests all answered 403 with the reason.

**No row carries words the owner typed, because the console takes none**: the one text input is the call's
chat, beside the secret paste a hand step keeps, and `site/__tests__/unit/textInputs.test.ts` walks every
route and component to refuse any other. A `text` slot is filled with words the button itself prints: Mark done's
`HAND_DONE_WORDS`, Approve and Deny's "right call" and "wrong call", an earlier steer picked from a list. Anything
in the owner's own words — a decline, a definition of done, a new proposal, a change to an automation — is said in the
call's chat with the card open, and reaches the supervisor through `/api/talk/relay` carrying the item the owner had
open (`about`), its picture checked by `site/lib/webpDataUrl.ts`. The page never writes a board row itself.

**Four outcomes, not two.** `spawnVerb` keeps a non-zero exit's stdout and exit code, so a verb's own
refusal reaches the panel as the verb wrote it (422 `refused`), and a run killed on its timeout — which may
have written its row first — is `unknown` (504) with the register re-read, never a failure.

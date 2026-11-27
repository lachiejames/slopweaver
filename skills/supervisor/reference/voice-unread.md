# Every word the owner speaks on a call is read by the chair

Every word of the owner's transcripts with the conversational voice AI must be seen by the supervisor; it must be
impossible for a word to go unseen. The relay once dropped three whole steers — the named acceptor, voice
manners, and the Notion policy proposal with Pino redaction — and the chair found them only by
reading the call files itself. A relay is the voice's reading of what the owner said. The call file is what the owner said.

## The read, every tick

```bash
slopweaver talk unread          # every stretch of the owner's speech on any call since the supervisor cursor, relayed or not
slopweaver talk unread --mark   # once each is ruled, registered or intake-marked: record them read
slopweaver talk unread --all    # no cursor yet: every word on every call, not only the last 24 hours
```

`talk unread` reads `$SLOPWEAVER_HOME/talk/calls/*.jsonl` past the `supervisor` cursor and prints each
`who: owner` segment with its pointer, `talk-call:<callId>#<segmentId>`. The file also keeps each tool's exact answer;
`talk unread` reads only the owner's speech past them, and `slopweaver talk call-tools --call <callId>` reads
the answers when a wrong spoken answer needs tracing to what the voice read; `talk call-thread --call <callId>` reads
the thinking thread's own journal — its reasoning, searches and every answer whole. Most ticks it prints one line saying
nothing is new. Reading never moves the cursor; only `--mark` does, and it reprints everything it records, so
a word that landed between your read and your mark is on your screen before it is counted. A read that
prints is a BATCH that fits whole in a tool result; when it ends with its `remains past this batch` notice,
mark it and run `talk unread` again until it prints nothing new. A line too large for any batch prints in parts,
one per read; mark each and read again — the cursor moves past the line only with its last part. A stretch the owner
spoke for minutes is a run of growing snapshots, one line each: its parts are cut from the NEWEST snapshot that
continues every earlier one, and the last part's mark passes them all, so catching up costs that one snapshot's
parts, not two marks a line (measured: 195 snapshots of one stretch, five marks to a cursor caught up). If the output
reaches you visibly cut (a host truncation marker), do NOT mark: that mark would record what you never saw.
**Read each for an explicit OR IMPLIED steer.** Wondering aloud whether something should exist is a steer, and so
is one the voice answered in conversation and never relayed. For each one:

- **a steer** → a board row or a routing act, the same tick: `handover register --anchor talk-call:<callId>#<segmentId>
--asked-iso <its instant>` (the anchor is kept as written; only a Slack or transcript one yields an instant). A
  `--dispatch` registration passes the same `--anchor`: one without it reaches Alignment's steers (`handover steers`)
  flagged, the owner's words unattached;
- **covered** by a relay you already acted on → `supervisor intake-mark --turn talk-call:… --as answered`;
- **no ask** (small talk, a question the voice fully answered) → `--as no-ask` with a witness.

Then `talk unread --mark`. The relay a word sits beside (`next unread relay line after it: …`) is evidence only:
a relay line names no segment, so it never proves the relay carried that word, and one the cursor already passed
is not searched.

**Under each stretch it prints what the stretch answered**: `answering the voice's "<its turn>" (<pointer>)` — the
voice segment begun last before the owner's, whole — and `next relay's triage verdict …`, the verdict that relay's turn
stored, or `triage verdict: none` when no relay among the lines printed followed it (`src/talk/answerContext.ts`;
`--json` carries both as `answered`). Rule the stretch as the answer to that turn: incident C0SYN000001's "Obviously,
yes" answered "Needs more info here too?". Read beside the cursor, never through it, so a mark still records only
the bytes the read passed.

## A batch line means read now — one turn per quiet stretch

Once the owner has been quiet for two minutes (`QUIET_BEFORE_DELIVERY_MS`, `src/talk/chairWake.ts`), the console
types ONE line into this chat for everything the owner said since the last one: a `[voice batch]` line saying the
owner went quiet two minutes after <n> stretch(es) and <m> relay(s), telling you to read the stretches with
`slopweaver talk unread` and the relays with `slopweaver talk log`, rule them and mark them, listing the anchors in
order, and noting that the line carries none of the owner's words. Each anchor is a `talk-call:<callId>#<segmentId>` stretch or a `talk-<12 hex>` relay row, in the
order the owner said them, the line bounded with `+N more` stretches past what fits; a relay with no room rides the next batch. It is a pointer, never the owner's words.
On it, run the read above at once — `talk unread`, rule each word, `--mark`, then `talk unread` AGAIN
until nothing is new — and settle each relay row it names the way [routing § 3a′](routing.md) reads a delivery
line: the batch replaces that relay's own typed turn. Never act on the line's text and never `intake-mark` it —
`supervisor intake` counts the exact line witnessed by its relay rows, or by `talk unread` when it names none; a
turn that opens like one and goes on in anyone's words is not one. One unread batch costs one line; another comes
only once you have read past it, or 10 minutes on. `talk unread` heads its stretches `quiet batch N: …; due` or
`holding until <instant>`, so a chair that fell behind sees where the owner went quiet; each relay held in it is named
with the owner's words on its turn (`talk-<12 hex> "take the set"`, opened `…` when only the newest fit: the relays
share half the print's bytes, at most 1,500 each), so an approval filed over no card is read there, not only behind
its slug. A quote is never more than its record kept: `…` marks a start or end the record lost, and a record that
never said whether it kept every word is flagged beside the quote, so read that one whole before taking it as a yes.
When every held relay will not fit beside even one line, their speech fills the batch first and the oldest relays that
fit are headed; `N more relay(s) held for the chair are not headed here` (`heldRelaysNotHeaded` in `--json`) counts
the rest, still held, named by `talk log` and the board — a mark never records a relay. A `[voice call …]` wake per stretch,
or a `[voice relay …]` line per relay mid-call, is a courier on code from before the batch: it re-executes onto
main's within two minutes, and if none follows, restart it as [relay-courier.md](relay-courier.md) says.

## A delivery line is witnessed by its own row

A relay reaches this chat as a turn opening `[voice relay talk-<12 hex>]`, typed only once its row is on the
board. `supervisor intake` reads that turn as witnessed by the row it names, provided the row's own
`talk:<turnId>` anchor mints that slug, so **never `intake-mark` a delivery line's `transcript:` pointer**: mark
the call segment (`talk-call:…`) or the relay (`talk:<turnId>`), and settle the row. A line whose row is not on
the board stays on the audit. MEASURED, before this rule: 204 of 211 turns the audit called
unwitnessed in a 24-hour window were delivery lines with their rows present (`slopweaver supervisor intake
--since 2001-01-01T12:56:18Z --now 2001-01-02T12:56:18Z`). The witness says the owner's words were recorded, never that
the row was acted on: that is still the row's own settle.

## A typed console turn is an intake obligation

Reading is not witnessing. A turn the owner types to the console (`typed-owner-<uuid>`, or `typed-in-<uuid>` into a live call)
reaches a row only when the voice relays it, and the voice never relays because a picture says to, so an ask carried
by a screenshot reached no row. MEASURED on a synthetic home: an attachment-only typed turn, then `talk unread --mark`,
then `supervisor intake`, read clean. So `supervisor intake` (and the reconcile it feeds) counts every final typed
owner turn on the owner's console until one of three covers it: a row anchored at its `talk-call:<call>#<segment>`
pointer (`handover register --ask "Private console turn" --anchor talk-call:…`, the line the report prints), the relay
row its own `relay_steer` registered, or `supervisor intake-mark --turn talk-call:…`. The report prints pointers,
instants and a count, never the words; read them with `talk unread`. Spoken stretches stay out: they arrive as
fragments by the hundred.

The obligation outlives the 24h window. Discovery reads call files written since the last COMPLETED scan, less an
hour (from a fixed bootstrap instant until one completes, so a first or a failed read loses nothing), and
`$SLOPWEAVER_HOME/sessions/typed-intake.jsonl` remembers each turn by pointer until a witness clears it, so an ask
nobody registered still counts a week later, and a successor chair inherits the count. A ledger present and unreadable
makes the typed half unavailable, never zero. `--session` excludes it: those turns are the chain's, not one chair's.

## `tick-record` refuses a tick that did not read

A tick is refused while any FINISHED word of the owner's is unread, however young, or while any unread call line did not
parse (it may be the owner's words). A stretch the owner is still speaking does not refuse once you have read its start: unfinished,
not cut, its call not ended since it last opened, a snapshot of it behind the cursor, and grown within 60 s of the
tick. `tick-record` and `tick close` pass it and name it on stderr (`--json`: `stillSpoken`); it stays unread and
refuses a later tick once final, ended, or a minute stale. A stretch nobody has read any of still refuses, so
**drain once more right before recording**: `talk unread`, rule anything new, `talk unread --mark`, then
`tick-record`. An unreadable read (a
malformed cursor, a call file whose bytes behind the cursor are not what was read, a call file or index ending
mid-line — `TAIL_UNTERMINATED`, which clears when the write lands and persists only if it died) refuses too, and so does every tick until the cursor has been marked
once. Hatch: `SLOPWEAVER_ALLOW_UNREAD_VOICE_WORDS=1`.

## The first mark

With no cursor, `talk unread` shows every stretch with any snapshot in the last 24 hours, and says how many older
stretches it left out. A first
`--mark` that would pass any of those unprinted is REFUSED: read them with `talk unread --all` and mark with
`--mark --all`, or, when they were already read (by hand, or by an earlier chair), `--mark --adopt`.

## A backlog another reader already read

`--mark` records one printed batch, about ten stretches, so a home carried from another machine — whose supervisor
there read every word — arrives with hundreds unmarked here and the courier stays off until they are. Adopt them in
one go, never for words nobody has read:

```bash
slopweaver talk unread-adopt --before <setup instant> --why "<who read them, and where>"            # preview
slopweaver talk unread-adopt --before <setup instant> --why "<the same words>" --approve <digest>  # apply
```

It passes, per call file, every line stamped strictly before the instant up to the first one that is not, printing
counts per call rather than the words, and prints WHOLE any line the call schema refused that it passes. The apply
takes the same compare-and-swap as a mark and appends one receipt to `talk/unread-adopt-receipts.jsonl` while the new
cursor is only staged, so the cursor never moves without its receipt. A failed staged install after a stored receipt
(`CURSOR_INSTALL_FAILED`) leaves the cursor where it was and a receipt naming an adopt that did not happen: preview
again. Then run `talk unread` as usual for what is left.

## When the cursor cannot be trusted

Call files are append-only; nothing in Slopweaver rewrites one. `CALL_PREFIX_CHANGED` means something did, and `CALL_FILE_GONE`
that something removed a call file the cursor read or `talk/call-index.txt` records, so investigate what before
anything else. Restore a gone file from any copy that exists; only what cannot be restored is accepted, with
`slopweaver talk quarantine <callId> --reason "<what removed it, and whose words they were>"`. That appends one row to
`talk/call-quarantine.jsonl`, refuses a path that holds anything, an id nothing names and a second row, and never
edits the index or a cursor; every later read goes past the call and names it. Never hand-edit or remove the index or
a cursor: they are the witness that a call existed.

A cursor whose call files were rewritten (`CALL_PREFIX_CHANGED`: a home carried through a sanitiser, once 64 of the
129 calls its cursor named) or that will not parse (`CURSOR_MALFORMED`) is reset with `slopweaver talk cursor-retire`.
Bare, it writes nothing: it runs the ordinary read, refuses a healthy cursor, an absent one and any other failure (a
gone call file is quarantine's), counts every call failing its prefix proof and prints the cursor's `sourceSha256`
and the exact apply command. `--apply --source-sha256 <hex> --reason "<what rewrote them>"` re-checks both under the
cursor's lock and moves the file, unchanged, to `talk/unread-cursors/retired/<instant>-<name>/cursor.json` beside a
`receipt.json`. Then the first mark above applies: `talk unread`, and `talk unread --mark --adopt` for words an
earlier chair already read.

The mechanism and the wake: [console](../../../docs/console/voice-context-and-calls.md#every-word-the-owner-speaks-reaches-the-chair);
the cursor and the residue: [how the chair reads a call file](../../../docs/console/how-the-chair-reads-a-call-file.md).

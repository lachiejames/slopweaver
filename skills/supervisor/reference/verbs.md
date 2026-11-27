# The supervisor's verb surface

Every command this role reaches for, and the one distinction between the two event streams.

```bash
slopweaver session list [--json]                          # every ledger-tracked session, folded to current state
slopweaver session record <key> --note "<text>"            # note a status, or register a new key
slopweaver session close <key>                             # mark one done by hand
slopweaver cmux reseat --all [--dry-run]                    # FIRST after any restart, and whenever watch shows a wall: relaunch every walled or no-plan seat IN PLACE, the same session resumed on a routed plan, chair first, context kept, bar a running seat with no transcript, booted fresh as `fresh-seated`, and a bare shell with none, refused `NO_RESUMABLE_SESSION`; ends on the console's state
slopweaver cmux reseat <ws> [--model <m>] [--force]         # one seat, from any cmux tab (a plain shell too): stop its claude, relaunch the same session on a routed plan; a running seat with no transcript, or a resume printing No conversation found once its tab is back at a bare prompt, boots fresh ONCE as `fresh-seated` (context NOT recovered), else refused `RELAUNCH_FAILED` (no prompt came back) or `UNCONFIRMED` (the fresh one never confirmed); a plain shell whose saved id has no transcript is refused `NO_RESUMABLE_SESSION`
slopweaver cmux reseat <ws> --plan <alias>                  # the same, on the Claude plan you name, the chair included — judged on its own gauge; refused paused, Codex, or beside --all
slopweaver session re-seat [--dry-run]                      # AFTER reseat, for a walled seat it refused NO_LIVE_SESSION: close it and re-run cmux spawn for its row, one boot at a time under the capacity read; never the pinned chair
slopweaver session close-done [--dry-run]                   # the sweep: close every finished/settled/terminal workspace and every ended bot-turn child, idle only (forced past cmux's running-process confirmation), and every finished fleet resume tab; reap the orphaned node processes (nx daemon) a closed fleet worktree left, when no live seat holds it; fix ledger drift, print the count
slopweaver session standing --loop-session-key <key> [--json]  # loop + keep-alive live; loop and supervisor on current main
slopweaver listen reconcile                                 # back-write the listener deaths nothing was alive to record; never re-arms
slopweaver handover list --all                              # the board: planned, blocked, in flight, done, closed-not-shipped
slopweaver supervisor intake                                # every turn the OWNER typed into ANY supervisor in the chain, and which has no row, settlement or mark
slopweaver supervisor intake --since <iso>                  # audit a whole week; a chain that does not reach that floor SAYS so rather than reading clean
slopweaver supervisor chain [--rescan]                      # the succession intake walks; --rescan recovers links from the transcripts (~11s, whole machine)
slopweaver supervisor intake-mark --turn <pointer> --as card|answered|no-ask --witness "<text>"  # what a turn became when it did not become a row; an answered witness naming a row carries the owner's words onto it as a steer first, or refuses and marks nothing; a transcript: uuid that is not the owner's turn or a peer message is refused — copy pointers from `supervisor intake`, never grep a uuid
slopweaver talk unread [--json]                             # every stretch of the owner's speech on any call since the supervisor cursor, relayed or not — read each for a steer
slopweaver talk unread --mark                               # once each is ruled, registered or intake-marked (talk-call:<callId>#<segmentId>): record them read; tick-record refuses any word unread, finished or live, so drain once more right before recording; a first mark past unprinted older words refuses: --all reads them, --adopt takes them as read; a line too large for a batch prints in parts, a mark per part
slopweaver talk cursor-retire [--json]                      # a cursor talk unread refuses with CALL_PREFIX_CHANGED or CURSOR_MALFORMED: preview, count its failing calls, print its sha256; --apply --source-sha256 <hex> --reason "<why>" moves it beside a receipt, then the first read
slopweaver talk list [--since <seq>] [--json]               # the owner's running list, newest ten, newest first: what the owner, the voice and the fleet left each other; the owner's own adds are steers — read them each tick beside talk unread
printf '%s' "<text>" | slopweaver talk list-add --origin fleet --from <ws> [--label <words>] [--id <request-id>]  # put a message on the owner's list for the owner to copy (text on stdin, exact); --id repeats are one item while it is among the ten
slopweaver supervisor state-amend --doc <state doc> --handoff <n> --row "<row>" [--row …] [--after-rulings]  # rows into YOUR boot block, before its ### RULINGS (or under it); refuses at a cap
slopweaver supervisor state-fold --doc <state doc> --handoff <n> --keep <rows> --archive <name>.md --description "<rows' span>"  # mid-shift, at the block cap: oldest rows to archive/, one note row left, rulings kept
slopweaver supervisor state-archive --doc <state doc> --predecessor <n> --successor <n> --archive <name>.md --description "<shift>" --block-file <block> --successor-summary <path>  # at boot: predecessor's block to archive/, note chained, yours installed; REFUSES without a sealed derived summary
slopweaver supervisor owner-turns                           # every turn the OWNER typed in the last 7 days, verbatim, in chunks, receipted — run until it reports nothing left
slopweaver supervisor owner-turns --check                   # what is unread, printing nothing and spending no receipt — what `cmux takeover` asks
slopweaver supervisor owner-turn-record --file <path>       # an owner-turn-*.txt you just wrote, byte-exact into the store's owner_turn; non-zero when it did not land
slopweaver supervisor owner-turn-show --ref <anchor|turn> [--all]  # the owner's turn FROM THE STORE by anchor or label — never the disk copy, so a reclaimed file still reads
slopweaver supervisor successor-summary --reconcile <json> --out <path>  # DERIVE the outcomes half of a handover: the owner's words, the owner's anchors, this tick's coverage, the whole ready set
slopweaver cmux spawn <slug> [--full]                       # open + boot + verify + auto-record; one receipt line, --full for worktree and boot detail
slopweaver cmux spawn <slug> --model <m> --plan <alias>     # boot on the plan you name over routing and any role pin, judged on its own gauge (a Codex destination on --driver codex)
slopweaver cmux spawn <slug> --template research           # a seat that never edits code boots without the three code-standards rules (code|research|supervisor|bot)
slopweaver cmux templates [--json]                          # each launch template, what it leaves out, and the bytes and approx tokens it loads
slopweaver cmux close <workspace>                           # close + auto-close the matching session, if tracked; forces once on an idle screen when cmux asks, holds a busy one (exit 1); reap its fleet worktree's orphaned node processes
slopweaver cmux send --workspace <ws> [--interrupt] "<text>"  # one line in; says submitted vs QUEUED; --interrupt stops the turn
slopweaver cmux submit --workspace <ws> [--force]           # Enter only, types nothing — REFUSES a grey suggestion in the box; --force presses anyway
slopweaver cmux stop <ws> --why "<what it is costing>"      # stop a peer seat and say why; does NOT wait for the interrupt — what a `perf` REACT line hands you
slopweaver cmux list --json                                 # live ground truth for what is actually open; text rows omit the directory unless --full
slopweaver session watch --idle-minutes 10 [--include-stale] # who is idle / silent / logged out / limit-retrying / waiting on you; stale unmapped rows collapse to one counted line
slopweaver session watch --idle-minutes 10 --json-report     # the same reading as ONE document — rows, suppressed count, instant, what it could not see — for tick-draft
slopweaver session watch --json-report --record-reading <by> # the same document, appended to the readings ledger — one plain drain, never with --follow
slopweaver supervisor tick seat --dir <scratch> --workspace <ws> --model <m> --pinned-at <iso> --loop-session-key <key>  # ONCE per seat: the header constants every tick would otherwise retype
slopweaver supervisor tick open --dir <scratch>             # every reading into <scratch>/tick-<n>/ under its own time budget; prints what changed since tick n-1, folds the rest behind tick-<n>/digest.txt; writes the tick.json you fill; a JSON reading that would not parse prints `FELL BACK TO TEXT` under the header — fix the verb that wrote the stray line, never hand-copy the file; a landing's rebuild crossing the open is waited out once (up to 30 s) and its broken readings taken again, the header saying so — a wait that ran out names the reading, and the NEXT tick, after `dev build`, is the re-open
slopweaver supervisor tick fill --dir <scratch> --carry-from <n> --headline-sentence "<s>" --fold-file <f> --fold-at <i> --actions <rows.json>  # writes tick.json in place, never jq; one bad row writes nothing; prints what close would still refuse, a fold's unexplained fleet word included, with the shell-quoted `--fold-at <i> --fold '<plain words>'` rewrite that clears it
slopweaver supervisor tick close --dir <scratch>            # refuses a malformed tick.json naming the field (an over-cap foldSummary by its length), then form, page, tick row as resumable stages; prints the next sweep prompt LAST, or the hand-off in its place
slopweaver session-start --json --no-record --out <scratch>/run.fresh.json  # the owner's list built bare, as a background job — the first half of the route an overrun close prints
slopweaver supervisor tick close --dir <scratch> --your-list <scratch>/run.fresh.json  # renders that list, launching no refresh child — the second half
slopweaver supervisor refresh-run --dir <scratch>           # run.json from session-start + autonomy-qualified.jsonl, every bare #<n> qualified — never a copied refresh-run.sh; under load its list is cut short at a soft deadline it hands session-start (its `cutShort` names what was not read, the page says so) rather than killed
slopweaver supervisor scratch-carry --from <predecessor scratch> --to <your scratch>  # at boot, ONCE: form.json, open-pages.json, shell.txt and nothing else — never rsync (state-doc.md)
slopweaver supervisor tick-draft --tick-id <id> ... --out draft.json  # the lower verb `tick close` composes; a hand repair only (derived-narrative.md)
slopweaver supervisor tick-reseal [--json]                  # the tick ledger refuses every read on a row whose stats disagree (a carried home): preview, count the stale rows, print its sha256; --apply --source-sha256 <hex> --reason "<why>" backs it up, rewrites them under the append's lock, reads back clean, journals a receipt
slopweaver session depth [--threshold <tokens>] [--json]   # context depth per live session, and the respawn candidates
slopweaver session compaction [--days 7] [--check|--alert] [--windows 100000,...] [--record-reading <by>] [--json]  # what compaction and every call's context cost the fleet, what another window would have, and whether quality or context slipped since the last reading
slopweaver session spend [--days 7] [--repos o/r,...] [--finding] [--record-reading <by>] [--json]  # the token pass: draw by seat kind, model and gate refusal, units per landed change against the last reading, every priced drain with its fix; --finding posts one board row only on a win to show
slopweaver reflect grade <id> keep|adjust|drop [--why "<text>"] [--closed-by <pr|slug>]  # the OWNER's word on a self-improvement finding, the same tick the owner gives it; the only grade writer, so a drop stops re-surfacing ([reflect](../../reflect/SKILL.md))
slopweaver cmux pin [--workspace <ws>]                      # take the pin — and, on your own workspace, register for the depth block; inside a desktop-app session it records that session once the app vouches for it, pinning nothing in cmux
slopweaver cmux takeover                                    # the whole gated successor handoff — pin, depth-block registration, and the predecessor's BOARD ROW closed so a predecessor chair stops reading ready; either side may be a desktop-app session, closed only through the harness; a predecessor its host no longer holds is taken over once its run reads terminal (`handover reap` for a dead one), its ledger row ended
slopweaver cmux processes --workspace <ws>                  # the OS process tree under one session
slopweaver machine capacity --brief                         # the tick's routine read: the unused-now clause, a held backoff, the verdict; `--brief --json` adds every field step 8 acts on, and `--record-reading tick-<n>` files the full document as the pass's capacity reading
slopweaver machine capacity --full                          # the text read with the fleet's load and one line per ranked process; plain, the table is a count
slopweaver machine capacity --json                          # memory AND cpu, plus WHICH session or dead seat is burning it — the verdict names a culprit and the kill — and `ceilings`: unused now on the machine and every Claude and Codex plan, and the `lowest` the fill stops at
slopweaver machine unused [--days <n>] [--json]             # what each of those ceilings left unused over past days, off histories on disk — no probe
slopweaver machine series [--json]                          # the Fleet page's charts: the last hour of cpu (fleet trees vs everything else), load against the hold, memory and each session's tree, one `top` per thirty seconds at most
slopweaver perf [--window-minutes <n>] [--json]             # the HOOK half of the same tick: which seat is stalled, on WHICH hook, and the command that ends it; exit 3 = a REACT line to act on
slopweaver perf seat <ref> | slopweaver perf hook <name>   # the two drill-downs (fleet-performance.md)
slopweaver perf console [--base <url>] [--runs 3] [--only <paths>] [--check]  # the console in a LAUNCHED Chromium, never the owner's Chrome: every fixed route cold, every nav item and flow (detail pages too) warm, heap, each live read alone, against named budgets
slopweaver machine free-disk <target> [--apply]             # the owner's disk ruling as four closed targets — package caches (never npm, Yarn or Slopweaver's own), a Docker TRIM, the pre-setup copy, one ruled app to the Trash; plan first, nothing changes without --apply (free-disk.md)
slopweaver machine reap [--dry-run]                         # kill the orphaned fleet shells whose seat is dead, the docs dev servers that outlived a seat, a row or each other, a live seat's runaway grep/rg children (10 min, 20% cpu; the search pid only), AND close browser sessions whose opener is gone or that sat idle past their 15-minute expiry (never by age from open); reports what it left and why, every tick
slopweaver machine watch --once                             # sample BETWEEN ticks: a hold, 3 sustained cores in one process, 40 non-hook processes in one session or fseventsd over 1 GB writes a finding row and SEATS an investigation; exit 1 means it dispatched
slopweaver machine dispatches [--all] [--json]              # the anomalous-load finding register — open rows, their culprits and trees; exit 3 when there are none
slopweaver machine dispatches settle <id> --witness "<text>"  # the ONLY way a row stops being open; an unsettled one keeps tick close refusing (load-dispatch.md)
slopweaver session no-subagents --why "<brief clause>"      # declare THIS session's brief forbids sub-agents; the Agent/Task hook then refuses one in it
slopweaver cmux events --follow --name agent.hook.Stop      # wake-on-signal instead of poll-on-a-timer
slopweaver events tail --cursor supervisor                 # the supervisor stream since your last tick
slopweaver events tail --cursor supervisor --min-severity alert  # …only what means the bot is off the air
slopweaver events tail --follow --min-severity alert        # wake-on-signal for a listener death
slopweaver github hold --pr <n> --repo <owner/name> --why "<text>"  # ONE PR owns the merge queue; every other is refused at `github merge` AND `github enqueue`
slopweaver github hold --status                             # what is held, by whom, how long — and the read that warns on a stale hold; `github release --pr <n> --repo <owner/name>` clears it
slopweaver briefing sweep-block --form <form.json> --workspace <ws> --handoff <name> --model <model> --pinned-at <iso> --sleeping <true|false> --alignment <text> --headline-sentence <text>... --fold <text> --fold-summary <text>  # each sweep's form edit, validated whole before it writes; a fifth --headline-sentence, or one carrying a path, a seat number, 'tick' or 'row', is refused naming it and every other schema refusal prints beside it, in one run; add --drop-card-prefix, --alignment-detail, --intake, --lede as needed
slopweaver briefing archive --form <form.json> --keep-notes <n>  # the sweep-block overflow remedy; reads the chair's newest-first order and cuts the end, `--oldest-first` only for a form that appends. `tick close` archives on count AND page bytes itself
slopweaver briefing fold-caps --form <form.json> [--dry-run]  # join adjacent paragraphs and lists in any fold over four blocks, changing no word
slopweaver briefing recut --form <form.json> --out <form.json> [--dry-run]  # rewrite fleet words in authored prose (never alignment, a subject, code, a paste or a URL); names, per string, one it could not
slopweaver briefing card --open-pages <open-pages.json> --row <row.json|-> [--replace] [--dry-run] [--json]  # ONE open-pages row, held to every cap, framing and voice rule the rendered card meets, appended atomically; never a cards script, jq or a heredoc
slopweaver briefing card --open-pages <open-pages.json> --drop <url> [--settled-by <slug>] [--dry-run] [--json]  # remove the ONE row naming <url> exactly, only when the owner's deciding lock-in ruling or a settled board row publishing it says so; refused, writing nothing, otherwise
```

`recut` is an ASSIST, so read its `--dry-run` first: a substitution is text rather than grammar, and where the
sentence already carries the word the replacement ends in the two land together ("Did the next tick pass?"
becomes "Did the next pass pass?"). It keeps the meaning; the phrasing is yours to fix.

All four edit a scratch file one seat owns: the write is atomic, not concurrency-safe, and a refusal or
`--dry-run` writes nothing. `briefing render` stays the publication authority, and it is also what catches a fleet
phrase split across two runs, which `recut` reads one string at a time and cannot see.

**No Python anywhere in a sweep.** The five `briefing` verbs above replace the
`tick<n>.py`, `fold210.py`, `recut.py` and `cards<n>-<m>.py` scratch scripts — and the `jq` and heredoc edits of
`open-pages.json` that followed the Python gate; a mechanic this surface does not cover is a verb to
build, never a script to write.

Two streams, two jobs, not interchangeable. `cmux events` carries cmux's own agent-hook firings — who is
idle, who submitted a prompt. `events tail` carries what SLOPWEAVER's own long-running surfaces say about
themselves, and reaches you whether or not cmux is running: see `docs/supervisor-events.md`, and
[reference/reaching-a-session.md](reaching-a-session.md) § "Why raw `cmux` is blocked".

## What is NOT built — do not assume it, do not silently ship without it

- **No automatic rolling-awareness summarisation.** `session record` is filled by YOUR OWN judgement —
  nothing polls other sessions with a cheap model and writes notes for you.
- **No automatic session-identity discovery.** Mapping a ledger key to a live `ListAgents` identity is a
  judgement call each time.
- **A Codex chair is IDENTIFIED, not yet READ.** The pin, every chain link and every owner-turn receipt name their
  holder as a host AND an id (`CODEX_THREAD_ID` in Codex), so `cmux pin`/`takeover` seat a Codex chair and its
  receipts never count for a Claude session sharing the id. Its rollout is not opened: `supervisor intake`,
  `profile words` and the chair read print `a Codex chair's rollout is not read yet` rather than counting its turns
  as none, `supervisor owner-turns` (so `cmux takeover`'s gate) refuses while one is in the window, `fleet resume`
  refuses `CHAIR_ON_CODEX`, `fleet health` reads its seat yellow (live when a Codex process holds its thread, else liveness UNMEASURED, never red), `cmux reseat` never resumes its
  thread id as a Claude session, the chair gate steps aside (`not-read`), `session standing` and `claude gauge` read the chair unresolved
  rather than judge a Claude tab beside it (with no pin, the chain's newest link names the host), and the `chair-off-fable` monitor reads it unmeasurable. A pin written before this reads as the Claude session it named.

# How the chair reads a call file — the cursor, the batch and the residue

A child of [every word the owner speaks reaches the chair](voice-context-and-calls.md#every-word-the-owner-speaks-reaches-the-chair),
which carries the ruling, the tick gate and the wake. This page is the read itself: what `slopweaver talk unread`
counts as read, how much it prints at once, and what it cannot close.

**The cursor is a byte position per call file, never an instant.** A segment's `atIso` is the page's clock at the
snapshot, and a batch that failed goes back on the queue, so a line can land after one stamped later; a cursor of
"read through 12:05" would pass a 12:04 line appended at 12:06 as read, forever. A tool line carrying the answer
the voice was handed, up to 24 KiB and after the call's `closed` line when the owner hung up while it was delivered, is ordinary
bytes to the cursor: it moves the frontier past it, prints nothing and marks no speech. So is the `turnId` a tool
line names, and the `wrote` line a typed conversation's final reply leaves beside its segment,
which is what `talk fidelity` reads ([a summary keeps its source's claims](voice-holds-to-the-record.md#a-summary-keeps-its-sources-claims)). Each call's frontier is the end
of the last whole line read, anchored to the sha256 of every byte before it, so a file shortened or rewritten
anywhere underneath it is
`CALL_PREFIX_CHANGED` rather than read as consumed, and a cursor that will not parse is an error rather than a
first read. Bytes after the last newline of a call file or the call index refuse the read as `TAIL_UNTERMINATED`: a write still landing, gone once its newline lands, or one that died mid-line, which refuses until the file is repaired, because either may be the owner's words. A whole line that
does not parse, a blank one included, is printed, and refuses the tick, because it may be the owner's words. With no cursor yet a read shows every
stretch with any snapshot in the last 24 hours and COUNTS what it left out: a first `--mark` that would pass any of those unprinted is refused unless
the chair reads them with `--all` or adopts them on purpose with `--mark --adopt`, and `tick-record` refuses every
tick until some mark exists. `--mark` reprints everything it records, so
nothing is counted read that was not on the chair's screen (`src/talk/unreadRead.ts`, `src/talk/unreadWords.ts`).
A call file the cursor has read, or `talk/call-index.txt` records, that is no longer there is `CALL_FILE_GONE`: deleted with unread lines in it, it would otherwise read as nothing new. The call store writes a call's id to
that index before its first line, so a call deleted before any reader saw it is refused as well, and an index line
that is not a call id is `CALL_INDEX_MALFORMED` rather than skipped. A loss that cannot be restored is accepted on
the record with `talk quarantine` (`src/talk/callQuarantine.ts`): one row in `talk/call-quarantine.jsonl`, only for a
path holding nothing at all, and the index and cursors untouched. A read goes past a quarantined call, only while its
path holds nothing inside a real calls directory, and names it on every report; a damaged ledger is
`QUARANTINE_UNREADABLE`, refusing the read rather than forgetting an acceptance. A quarantined call is closed: an
append to it is `CALL_QUARANTINED`, so no line lands where a read would go past it. A live home's call file is never removed:
the seat-side `call-state-guard` is a tripwire refusing a hand-run `rm`, `mv`, overwrite or truncation of this state in
a live home that it can read — a nested shell or an interpreter passes it
([the call-state guard](../hooks/session-guards.md#the-call-state-guard)) — and a test points at a throwaway `--home`. The prefix check, the lines and the new frontier's hash come through one
open descriptor, the hash fed the very bytes parsed, so a file rewritten mid-read never has its new bytes anchored
as the ones printed.

**A read that prints is a batch that fits in a tool result.** Printed is not seen: a host that keeps only part of a
command's output would leave a mark recording the rest read unseen. So a read prints the most whole call lines whose
output, rendered exactly as printed in the shape asked for, fits in 8,000 UTF-8 bytes and 200 lines
(`src/talk/unreadBatch.ts`), says more remains, and a mark records only that batch; the chair marks and reads again
until nothing is new. Bytes, because no host counts a character as more than its bytes; the size sits under every
host the chair runs on — Claude Code's Bash tool keeps 30,000 characters, and Codex, the substitute host, cuts a
tool result by bytes, tokens and lines at a limit not measured here. Witnessed: a real 7,975-byte batch
arrived whole in a Claude Code session. Nothing is estimated: two estimates were each broken by a line shape they
did not price, so the batch is found by bisection over the report itself (`src/cli/commands/talk/unreadReport.ts`).
A line too large to print even alone — a 16,000-character stretch, or one that does not parse — prints in PARTS
(`src/talk/unreadParts.ts`): each read prints the next, each mark records it in the cursor, which stays at the
line's start, bound to its hash, until the last part is marked. When that line is one snapshot of a stretch still
growing, the parts are cut from the newest snapshot that continues every one before it — bound by its own offset,
so a snapshot landing between two parts never splices them — and the last mark passes every line it stands for. The
tick gate reads everything, unbatched, and counts stretches; a part run pays per stretch too.

**Each stretch prints its newest snapshot**, and any earlier one it does not print beside it — one the transcriber
revised, or whose last word it extended (`do not`, then `do nothing`) — so no snapshot is marked read unprinted;
measured, 20 lines across 14 of 303 of the owner's stretches.

**Speech a console that is not the owner's recorded is set aside, never read as the owner's.** That includes the desktop test
instance's calls (`origin.instance: "e2e"`, [marked at the source](../../skills/desktop/reference/e2e.md)):
the read names each one as not the owner's, with its origin, led by `the desktop e2e test instance, through`, one row per call
and origin, and a mark passes it, so it neither reaches the chair as intake nor wakes it.

**A relay beside a word is evidence, never attribution.** A relay line names its turn and no segment, so each word
says which unread relay line came next after it, with that turn's newest outcome, or that none did — never that
the relay carried it, and a relay the cursor already passed is not searched.

**The cap on one stretch is 16,000 characters** (`CALL_TEXT_CHARS`, `site/lib/talkTranscript.ts`'s
`TRANSCRIPT_TEXT_MAX`). At 4,000 it cut a stretch that held two of the owner's steers; a word at the cap is printed with the cut named, because what followed was never written down. The page stores a control character JSON would escape in six bytes, and a lone surrogate,
as U+FFFD, so no character costs more than three bytes and a stretch at the cap still fits one 64 KiB body
(`site/lib/talkTranscript.ts`'s `segmentLine`). The verb appends a batch whole under a per-call lock, `<callId>.jsonl.lock`, since the route spawns one
writer per batch and two can run at once. The lock names its holder's pid and start time and is taken over only once that process is gone, never by age, since a writer merely paused is still mid-batch. A stored
segment whose text parses to a lone surrogate prints as its raw line, which stdout reproduces exactly. A stored line whose text runs PAST the cap is never parsed down to it —
it prints whole, as a line that did not parse, since a mark counts every byte of it read. The
residue is the capture's ([the call is written down as it runs](voice-context-and-calls.md#the-call-is-written-down-as-it-runs--a-dropped-call-is-still-read)): the last seconds of a stretch still being spoken when the page dies, and a
browser crash, are not in the file for any reader. The rest are the mechanism's own, named rather than
closed. A call file deleted with its index line, or one older than the index that no reader ever read, leaves no
trace to refuse on. Two writers that find the same dead lock in the same instant can both take it over. A host set to keep less
than a batch (`BASH_MAX_OUTPUT_LENGTH` lowered, a smaller Codex tool-output limit) shows a prefix and the mark
records the rest. A line landing after the gate's read and before the tick's append refuses the NEXT tick, not this one. The
guarantee holds while the hatch stays shut and a first mark's `--adopt` is truthful. And the gate enforces the
cursor, not the ruling: a word marked read with no row or intake mark is a chair skipping the sweep step, which no verb can see.

# What was lost between supervisors

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The failure this answers: most chats sat idle while ready rows under outcomes the owner had stated that same
morning went unspawned. Good judgement and a read of everything the owner had said over the previous week
would have made the expectation obvious, so the question was what information is lost between supervisors that
lets what the fleet does deviate that far from what the owner wants — and how to make repeating it
structurally impossible.

Three things were being lost, and each was mechanical rather than careless.

**Half the owner's voice reached no reader at all.** A message the owner types while the chair is mid-turn is
written to the transcript as an `attachment` line of type `queued_command`, never as a `user` line, and every
owner-turn reader here decoded `user` records only. MEASURED across 28 consecutive supervisor transcripts:
**102** such records; the seven-day chain read returned **96** turns before `src/transcripts/queuedTurn.ts` and
**238** after, **167 of them queued**. The turn stating the owner's eight outcomes is one of them, and so is the
turn widening them to the owner's team-facing work — so the statement of what the owner expected was invisible
to `supervisor intake`, to the reconciliation's intake clause and to the tick ledger's verbatim `ownerTurns`,
all three of which exist to carry exactly that. Reproduce on one transcript:
`grep '"queued_command"' <transcript.jsonl> | grep -c '"kind":"human"'`.

**Nothing held the owner's outcomes.** `handover reconcile --json` exposed the top FIVE ranked rows out of 718
and no statement of what the owner wants to be true, so a shift could be aligned by every number the verb
printed while every ready row under an outcome the owner named sat unattended.

**The handover carried mechanics, not direction.** The successor boot block is shift state, and measured over
eleven handoffs it carries no statement of the owner's outcomes at all — so each chair re-derived the owner's
direction from whatever it happened to read, which is the decay the state doc's own 12.9% read share already
described.

The answer is `src/supervisor/outcomes/`: coverage of the outcomes the owner keeps on their Workstreams
register — their one source, each in the owner's own words with a checkable anchor, the ones the owner stated
offered there as built-in candidates so there is one way of doing things — reported by `handover reconcile`, a
sweep gate in `supervisor tick-record` that refuses a tick which left capacity free with an outcome unattended
and no reason, a derived and hash-sealed successor summary `state-archive` requires, and a boot check on
`cmux takeover` that refuses a chair which has not read every owner turn of the last seven days. The whole
contract, and the replay of the failing handoff's own tick zero through the gate, is
[stated-outcomes.md](../../skills/supervisor/reference/stated-outcomes.md).

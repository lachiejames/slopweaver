# Private-source inventory — routing as agent judgment, step 2

Owner decision on scope: sample everything named in the handover doc, with no quoting restriction stated and
more data preferred. This doc reports **aggregate, anonymized measurements
only** — no raw private content, transcript text, or personal-identifying values appear below or in any
committed file, regardless of the owner's permissive answer, because the measurement step (this doc) and the
mining step (which will actually quote source material into a private, uncommitted artifact — handover 4)
are deliberately different steps with different audiences.

## Source 1 — the private profile directory

97 files (92 Markdown, 3 HTML, 2 JSON), ~1.1MB total, covering voice/communication-style and persona rules
consumed by other private-repo work. **Correction to a stale assumption:** an earlier note in this run's own
history claimed this directory was reached via a home-directory symlink. Measured now: it is a real directory
at its resolved location, not a symlink — that assumption was wrong by the time this was checked, which is
exactly the kind of thing a measurement step exists to catch rather than carry forward.

## Source 2 — a prior version of this bot's own decision/learning history

Small and already structured, not raw text to mine:

- A decisions ledger: 4 rows, fields `{detail, kind, summary, ts_iso}`.
- A learning ledger: 17 rows, fields `{candidate_id, kind, payload, source, summary, ts_iso}`.
- A "shadow profile" config: one JSON object, top-level fields `{autonomy, cadenceMinutes, council,
displayName, id, mission, models, outputs, owner, sources, stateRoot}`.

Volume here is low (21 total decision/learning rows) — this source contributes structure and prior judgment
examples, not bulk voice material.

## Source 3 — first-person dictation transcripts (a voice-to-text app's local recording history)

- **3059 recordings**, one folder per recording, each holding a transcript-bearing metadata file plus its
  audio. Date range: **~10 weeks**, not the multi-year archive an unmeasured
  assumption might have implied.
- **47 of 3060 metadata files (1.5%) have an empty or unreadable transcript** — real capture failures, not a
  clean 100% source.
- Of the 3013 non-empty transcripts, **3010 are unique by exact content hash** — duplication is negligible
  (~0.1%), so no dedup step is needed before mining.
- Length distribution: median 479 characters, 10th percentile 86, 90th percentile 2,467. Total corpus size
  across all transcripts: **~3.1M characters**.
- **100% single-speaker** (a personal dictation tool, not a multi-party recording) — speaker-purity mining
  concerns the original P1/P2 artifacts raised do not apply to this source.
- Two model variants appear in the metadata across the sample; no format inconsistency that would block a
  uniform parser.

## What this settles for handover 4 (the judgement profile contract)

- Real combined mining input: ~3.1M characters of first-person dictation (10 weeks, high volume) + 97 profile
  files (persona/voice rules, curated) + 21 structured prior-bot decision/learning rows (small, high-signal).
  Handover 4's miner must handle three very different volume/structure regimes, not one uniform corpus.
- The 1.5% empty-transcript rate and low duplication rate are real inputs to the miner's own quality filter —
  no assumption needed, they're measured.
- Owner privacy/retention decision: **no restriction stated** ("the more data the better") — handover 4's
  mining brief may draw on all three sources without an exclusion list. This does not change the boundary
  that raw source material stays private and uncommitted; only the _derived_ profile crosses into what the
  live bot loads, and only after the owner's own review (handover 4's `profile-answer` gate).

## Correction — the context-loss measurement belongs to a different, already-open doc

The original P2 text also asked this handover to measure how often message-only (thread-only) capture omits
useful surrounding-channel context. On inspection, that is not a gap in this repository's own unrelated 71%
non-member-channel-readability metric to newly measure — it is the entire subject of a separate, already-open
investigation into reading a Slack message in context, which declares its own probes for exactly this.
Duplicating that measurement here would fork the same question into two docs. This handover's real scope — the
three named private sources — is complete; the context-loss question stays with that investigation, which
handover 5 (the judgement decision eval) should treat as a real dependency, per this run's own earlier note.

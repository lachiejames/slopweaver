# What went wrong, measured

Part of [The freshness contract for derived state](../freshness-contract.md).

Four artefacts of the same shape went stale in one day:

| artefact                  | derived from                | how it went stale                                         | what the consumer did                                                                        |
| ------------------------- | --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| identity roster (silver)  | bronze                      | `refresh` ran, `derive` did not                           | warned, and posted anyway                                                                    |
| a main checkout           | `origin/<its trunk>`        | a PR merged and nobody pulled                             | the consuming tool did not know the newer thing existed                                      |
| handover board status     | its register + its probes   | `status:` authored by hand, disagreeing with the register | DERIVED, so a settled or closed row reads terminal everywhere without the line being touched |
| per-source member rosters | each platform's member list | the members lane only runs when that source is refreshed  | `derive` builds people from whatever is there; a login that joined later resolves to nobody  |

The roster case is the worked example throughout, because it is the one that changed what got SENT.

## The five rules

**1 · Every derived artefact records the source watermark it was built from.** For silver that is
`corpus/silver/index/freshness.json`, written by `derive` in the same step as the artefacts themselves, from
an observation taken BEFORE anything was read. Both halves matter: a stamp written separately could describe a
derive that did not finish, and an observation taken afterwards would record an ingest that landed _during_
the derive as though this derive had seen it.

**2 · A consumer compares watermarks before use.** `deriveFreshness({ stamp, observed, artefactPresent })` is
pure and cheap enough to run on every send — one `readdir` plus a `stat` per bronze window file, three `stat`s
per source, one small JSON read per cursor. Nothing is parsed and nothing is hashed.

**3 · On stale there are exactly two sanctioned behaviours, and never a third.**

- **Just-in-time refresh** when the refresh is deterministic, local and bounded. `derive` qualifies: no
  network, no token, minutes. The consumer runs it, then proceeds, logging the one line that says what moved.
- **Loud refusal** when the refresh is remote, expensive, or needs a person — a bronze refresh, a checkout
  pull, a registration rewrite. Refuse, naming the exact command that fixes it.
- **"Warn and proceed" does not exist** for anything that affects what gets sent. It is not representable:
  `FreshnessAction` has three members and `warn` is not one of them.

A just-in-time refresh that ran and did NOT make the artefact fresh does not decay back into a warning — it
becomes the refusal (`refreshAttempted: true`). That case is telling you the refresh itself is failing, and a
third send against untrusted state is not the answer to it.

**Stale is judged against the ASK.** A derive that observed its sources at or after the moment a send was asked
for has seen every byte ingested before it; what lands after is concurrent with the send, no different from an
ingest a second after the post, so `settledForAsk` reads it as fresh. A roster source whose bronze SHRANK since
the stamp stays stale. Measured: an approved `slack post --as me` was refused three times in twenty
minutes, each straight after its own derive, because a Notion refresh in another workspace kept appending.
Each send reads its ask once (a deps bag per verb call), and the just-in-time dedup is per ask, so a later send
in the same process — `automation run-due` runs every due row in one — gets its own derive rather than the
earlier one's roster.

**4 · `refresh` derives by default.** Uncoupled, the two verbs left silver two days behind bronze.
`slopweaver refresh` ends with a derive unless `--no-derive` is passed, and `--no-derive` says out loud that
the roster is behind bronze. A derive FAILURE fails the verb — unlike the member and structure hydration
lanes, which are warning-only — because silver that did not rebuild does not match bronze.
When nothing derive reads has moved since the stamp — every source's bronze, member and structure extent, the
send gate's own `fresh`, the denylist, the whole corpus tree the reader recurses (its root, `.jsonl` count,
bytes and unlistable paths), every artefact on disk and each exactly the file the stamped derive wrote — refresh prints
`derive: skipped` and loads no corpus, because the rebuild would be byte-identical (`silverCurrency`,
`src/silver/derive/currency.ts`). The corpus walk is the derive's own; a send never pays for it.

**5 · The same shape applies wherever derived state lives**, not only to silver. See the [consumer table below](consumers.md).

## The stamp format

`$SLOPWEAVER_HOME/corpus/silver/index/freshness.json`:

```json
{
  "version": 1,
  "derivedAtIso": "2001-01-02T09:00:00.000Z",
  "observedAtIso": "2001-01-02T08:58:12.000Z",
  "overrideRevision": 3,
  "exclusionBytes": 0,
  "corpus": { "root": "/home/corpus/bronze", "files": 412, "bytes": 8083000000, "unreadable": 0 },
  "artefacts": { "/home/corpus/silver/index/directory.json": { "bytes": 52114, "mtimeMs": 1790817883514.2 } },
  "sources": {
    "slack": {
      "cursorIso": "2001-01-01T10:58:40Z",
      "bronzeFiles": 12,
      "bronzeBytes": 4823910,
      "memberBytes": 20418,
      "structureBytes": 8801
    },
    "github": { "cursorIso": null, "bronzeFiles": 0, "bronzeBytes": 0, "memberBytes": 0, "structureBytes": 0 }
  }
}
```

Per source: the stored resume cursor, the bronze file count and total bytes, and the size of that source's
member and structure rosters. Plus `overrideRevision`, the revision of the store's human override roster
(`slopweaver identity roster show`; `null` when the store holds no row), which `derive` also consumes. `exclusionBytes` (the sync-author denylist),
`corpus` (the tree derive's reader recursed) and `artefacts` (each file this derive wrote, stat'd straight after
its write) are read by refresh's skip alone; a send never compares them, and `corpus` is null on a send's
observation. Any field that differs from a fresh
observation makes the artefact stale, and the verdict names which source moved and how. `observedAtIso` is when
that observation was taken — read just before it — and is what a send compares its ask against; a stamp
without one is never settled. `identities.json` carries the same `observedAtIso`, because two derives running at
once each write both files and their writes can interleave: a roster whose instant differs from the stamp's is
no single derive's output, so the reader calls it `absent` — a just-in-time derive, then a refusal — however
little has moved.

## Every source is WITNESSED; only some are COMPARED

The stamp records all of them, because that is a record of what `derive` read. The staleness comparison walks
`ROSTER_SOURCES` (`src/silver/derive/freshness.ts`) instead — `github`, `linear`, `notion`, `self` and
`slack`, every source except `gmail`, `calendar`, `fathom`, `chatgpt` and `gold`. It is derived, not kept: every
integration whose manifest says `identityRoster`, plus the local `self` row (`src/integrations/corpusSources.ts`).

**Decided after a 2.4 MB gmail ingest took the `slack post --as me` door offline for a
morning.** The tempting reading is that freshness should be scoped to what the DOOR reads, and it is wrong: a
door does not read a source, it reads the ROSTER, and the roster is cross-source by construction — an
`email` or `handle` link carried by a GitHub or Linear ingest is exactly how a Slack id acquires a second
addressable key. Scoping per door would silence the signal in the case it exists for.

The answerable question is which sources can move the roster **at all**, and the derive pipeline has already
answered it: an identity is minted only from an author carrying its source's native-id SHAPE
(`src/silver/nativeIdShape.ts`). Gmail has none, deliberately — bronze scrubs every address on the way in, so
a mail record's author is a display name and nothing under that source is ever a key — and `gold` is refused
at the same door for being synthetic. Neither has a member lane either. So a gmail ingest gating a Slack send
was never the conservative choice; it was a false positive with no case behind it. The exclusions are pinned
in the unit tests to `identityCandidatesForRecord` returning nothing for those sources, so a source that
later gains a native-id shape fails a test rather than quietly losing its gate.

`overrideRevision` is untouched by this and stays unconditional: the second trigger that same morning was
the roster file growing 362B → 610B, a hand edit to the authoritative roster, and that must always invalidate.
The roster is the store's row, so its witness is the row's REVISION, which every replace moves; a stamp carrying
no revision at all reads as unwitnessed and re-derives.

## Why bytes and a cursor, and not an mtime

Refresh rewrites a window file whether or not it found anything, so an mtime comparison reads the roster STALE
on runs that ingested nothing at all — noise on most runs, and indistinguishable from the one run where it
matters. A witness of (cursor, file count, total bytes) is stable
across a refresh that added nothing and moves the moment one adds something.

**The stated limit**, because a freshness signal that hides its own blind spot is the thing being fixed: an
edit that rewrites bronze content to the same total byte length, leaving the cursor and the file count alone,
is invisible here. A real digest would catch it and would cost a full read of every bronze file on every
send — not a price a mention resolution can pay.

A missing or unparseable stamp is treated as `absent`, not as fresh, so a home with no stamp re-derives once
and then self-heals.

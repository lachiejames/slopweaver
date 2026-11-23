# Backfilling rulings the owner already gave

`handover backfill-rulings --manifest <path> [--apply] [--json] [--dir <path>] [--home <dir>]` records each
reviewed answer in a manifest as a `ruling` event on its own row. It is the third piece: the event kind
([derived-row-state.md](derived-row-state.md)), the audit that reads it, then this.

**It plans by default.** Without `--apply` it writes nothing at all and says what it would append. With
`--apply` it walks the manifest in order and appends only what is still missing, so a partial run is resumed
by running the same manifest again — there is no progress file, and there is nothing to clean up.

## The manifest

Per-install state, never committed: its entries quote the owner.

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "slug": "a-row",
      "sourceAtIso": "2001-01-01T12:38:57.414Z",
      "words": "<the answer, byte for byte>",
      "anchor": "<where the owner said it>"
    }
  ]
}
```

Parsed strictly and WHOLE — an unknown key, a blank field, an unsafe slug, a non-canonical instant, a
repeated source or a repeated JSON key rejects the file rather than dropping an entry. A manifest that
silently lost one entry would certify a subset as the set.

## What it will and will not write

An entry is appended only when the audit reads it as `confirmed-unrepresented` — exactly one document claims
the slug, its journal decodes whole, exactly one `answered` event sits at that instant with that exact text,
and no ruling already names it — and the append seam accepts the event. The written line carries
`backfilledFrom` and `decidedIso` both equal to the source instant, and `atIso` of now.

**One row's trouble costs that row's entries and no others.** A duplicate slug, an unreadable journal, an
undecodable line or a malformed document refuses ITS entries; the rest of the manifest still runs. The
exception is an unreadable DOC or DIRECTORY, which refuses everything, because the file nothing could read
might be a second document claiming any slug.

**A ruling identical in words, anchor and decision instant is a refusal, not a skip.** The row carries that
decision, but not as a reconstruction anything can trace back to the answer, and overwriting or duplicating it
is not this verb's call.

**`complete` is not "it wrote something".** A clean plan is complete and has written nothing; a run can append
every entry and still be incomplete because the audit found an unrelated row it could not read. Exit 1 says
something was refused, failed or unreadable — never that the backfill did nothing.

**A failed append is not a guaranteed non-write.** The seam reads back after appending, so a read-back failure
can follow a line that landed. Nothing is rolled back or truncated; re-run the manifest and the reader decides
what is still missing.

## Before applying, and how the result is proved

**Every build reading this home should already decode the `ruling` kind**, because a decoder that predates it
reads a ruling line as unreadable and so cannot SEE the decision at all. It does not WEDGE that build: the
reader splits an unknown kind out of the ownership set (`ownershipAmbiguousLines`), so the lifecycle verbs
keep working over one, and a surviving refusal names the word and tells the session to pull. No flag asserts
rollout: nothing in one process can see what other checkouts are running, and an assertion that
looks like a check is worse than a stated prerequisite.

The proof is the separate reader, not this verb's own counts:

```bash
slopweaver handover audit-rulings --manifest <path> --json    # before: every entry unrepresented
slopweaver handover backfill-rulings --manifest <path> --apply --json
slopweaver handover audit-rulings --manifest <path> --json    # after: every entry decided
```

A decided entry need not be the ruling its row reads today — a later decision supersedes it and the check
records `historical` placement. Run one writer at a time: the state is re-read before each append, which makes
a concurrent writer visible rather than overwritten, but it is not a lock.

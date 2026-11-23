# The steer part's two versions

The `steer-verdicts` part of a store export ([import and export](import-export.md)). An export writes it at
schema v2 (`src/profile/steerMeasurementTransfer.ts`); a reader takes v1 or v2, whichever the manifest names. A
v2 line is exactly five fields, in this order:

```json
{
  "eventId": "steer-legacy-<64 hex>",
  "exactText": "<the line>",
  "parseStatus": "parsed",
  "schemaVersion": 2,
  "sourceOrdinal": 3
}
```

A field missing or extra refuses the part, and so does an envelope whose fields disagree: `parseStatus` must be
what the line itself parses to, a `steer-legacy-` id needs a `sourceOrdinal` and must be the id its line and that
ordinal mint, and a `steer-event-<uuid>` id carries `sourceOrdinal: null`. A line must also be exactly the line
its fields write, in the field order above with no spaces, so a duplicate key, which `JSON.parse` would resolve to
the last, refuses rather than merging two measurements into one. The verdict is never carried, because
the line already is it. A v2 part's `rows` is its envelope count, every measurement included: a read that named
nothing, a withdrawal and a line that does not parse alike.

A v1 part is the journal's own lines. Each nonblank line becomes the envelope a legacy import of it would make,
its ordinal its physical 1-based line in the part, blanks counted; its `rows` stays the lines that parse, the
count every v1 manifest recorded. Two residues follow, stated rather than discovered:

- **A v1 export cut from the store over a journal that held blank lines cannot recover the ids it stood for.** The
  store export before v2 wrote the stored lines densely, without the blanks, so each line after the first blank
  reads at an earlier place than its id was minted at. Those rows plan as new measurements under ids the live
  store does not hold, and nothing applies a staged row yet.
- **An unmanifested part reads a line carrying `schemaVersion` as an envelope.** With no manifest, each line says
  which it is, and a part mixing the two refuses. An envelope that fails the strict checks refuses rather than
  reading as a journal line; a journal line that carried a `schemaVersion` field, which no writer adds, would
  refuse the same way. Nothing read off one line tells the two apart, so the collision refuses rather than losing
  a measurement, and a manifest naming v1 reads that part.

# Qualifying a bare GitHub reference in an act

A bare `#<n>` in an act's prose renders on the briefing as plain text whenever the page links more than one
repository, and `briefing check` refuses the whole page over it. MEASURED: the internal finding door
wrote an act whose `why` quoted its board row's evidence verbatim, `owner/repo#<n> merged … the same read on
#<m> lagged its merge`, and every chair page stopped rendering until the row was repaired.

## At the door

`autonomy record` already refused such an act. The internal finding door (`src/cli/commands/github/findingRulingGate.ts`)
appended through the port with no such pass; it now runs `qualifyActProse` (`src/briefing/qualifyActRefs.ts`)
before it appends:

- a bare reference the act's OWN rendered links resolve to exactly one repository is written `owner/repo#N`,
  with the same resolver every outbound door links with, so the repository is one the act already names;
- the briefing's own check then reads the result, and anything still bare refuses the door, naming the
  reference. Write it whole in the row's evidence and run the verb again.

## On a stored act

```bash
slopweaver autonomy qualify <actionId> --repo <owner/repo>           # before and after; writes NOTHING
slopweaver autonomy qualify <actionId> --repo <owner/repo> --apply
```

The repository is NAMED by the caller and never guessed: which repository a bare number belongs to is the
fact the act does not carry, which is why it rendered bare. Read the act's witness and evidence before you
name one.

What it does, and nothing else:

- rewrites only bare GitHub references in `why` and `said`; the subject, the kind and every other field are
  carried byte for byte, and a steer row under the same id is never read for rewriting;
- appends to the act's own witness a provenance sentence naming the verb, the repository and the instant, and
  one `Original <field>: "<json>"` clause per field it changed, so the before is on the row itself;
- refuses `NOTHING_TO_QUALIFY` when no bare reference resolves, `BARE_REFERENCE` when one still would not
  after the rewrite, and `AUTONOMY_REVISION_LOST` when the stored record changed after it was read — the write
  is a compare-and-swap on the exact stored record, so a racing write is never overwritten.

Why an in-place edit rather than a new row: `why`, `said` and `witness` are identity fields, so a second
record under the same id is refused, and an act under a new id would leave the bare one on the page.

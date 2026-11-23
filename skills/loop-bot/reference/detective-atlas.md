# The ATLAS leg of the fan-out

The corpus says what people SAID. An atlas says what a platform CONTAINS — a user, a group, a repository
setting, an application, an API operation — and the atlases are the richest data sources there are, so
the fan-out reads every row in the store's five atlas tables, hundreds of thousands of them on a real estate.

`store detect` asks every atlas the question's keywords in one statement and spends a detective per
PLATFORM off the answer, exactly as it does for a Datadog service. An atlas is DISTINCT from the
corpus: nothing is merged into `content`, and the atlas tables are read in their own
`(platform, kind)` shape rather than the corpus's `(keyword, source)` one
([docs/store/tables-and-atlas.md](../../../docs/store/tables-and-atlas.md) § The atlas, "STORAGE, not RETRIEVAL").

## The verbs

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas probe                  # SCOPE: what each platform holds
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas probe <keyword> […] [--platform <p>] [--cells <n>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas <platform> read --query <words> [--kind <k>] [--limit <n>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas <platform> coverage [--kind <k>] [--open-only]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" atlas freshness <platform>
```

`atlas probe` with NO keyword is the cheap scope read — one line per platform with its row count, its kind
count and when it last synced. It is what a turn runs when the question names no vendor at all, and it is
the same command `turn brief`'s `atlas-estate` capability row prints. Keywords are the judgement: a whole
English question fed to it matches nothing and reads as absence.

## Four rules, not notes

- **ONE lead per platform, and ONE source for the whole estate.** MEASURED: about three quarters of the
  entity rows are jumpcloud, so a lead per `(platform, kind)` spends every slot on jumpcloud's
  kinds and never opens the handful of github rows. And every atlas lead carries `source: "atlas"` so the
  round-robin hands the estate one slot per round — dozens of sources would put dozens of leads ahead of a
  single Slack lead, which is the anti-monopoly rule defeated by the thing it exists to prevent.
- **A ZERO is not a provider holding none.** It is this store holding none, and it has three causes a
  detective must tell apart before reporting one: the kind was never synced, the sync failed, or the thing
  genuinely is not there. `atlas <platform> coverage` is what distinguishes them.
- **A count may be stale, and the lead says how stale.** Every lead carries its widest cell's last
  successful sync and any failed latest attempt. `atlas freshness <platform>` is the check before quoting
  a number as the present state — stale is a reason to say so, never a reason to hedge everything.
- **`atlas probe` only SIZES; `atlas <platform> read` carries the claim boundary.** The probe counts stored
  records and says so in its own closing lines. What a provider actually holds is a question `read`
  answers, with the estate line and the per-row match witness beside it. `src/atlas/kit/estateEvidence.ts`
  is why: Datadog's `monitor` kind held 29 SDK operations and zero monitors while `atlas doctor` graded
  the whole atlas ANSWERABLE, and two dogfood turns quoted the count as if it were the estate.

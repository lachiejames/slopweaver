# The harvest manifest

Useful data is used rather than re-derived in the local Supabase; data that is not useful is not worth keeping.
So the 90 history files in the owner's archived
profile unit get a per-file disposition rather than a blanket answer.

## Why a manifest and not a rule

"Useful" is a judgement about content and no directory rule computes it. Both directions are wrong on this
tree: `archive/team-model-2026-05.md` says in its own text to keep its rationale after supersession, while
`projects/e2e-overnight-KICKOFF-PROMPT.md` is an execution entrance whose instructions contradict current
doctrine and would be retrievable as advice. A human or a session decides once, and the decision is written
down with its reason.

## The shape

```json
{
  "schemaVersion": 1,
  "root": "/absolute/path/to/the/archived/profile/unit",
  "covers": ["projects", "archive"],
  "entries": [
    {
      "path": "projects/some-workstream.md",
      "sha256": "<64 lowercase hex>",
      "disposition": "harvest",
      "reason": "carries the rationale nothing else records",
      "replacedBy": ""
    }
  ]
}
```

`reason` is required on BOTH dispositions. A keep with no reason is as unreviewable as a drop with none.

## The four disagreements it refuses on

All four are reported together, because a manifest is edited as a whole and a validator that stops at the
first problem costs one round trip per problem.

| What                                          | Why it refuses                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A covered file no entry judges                | Otherwise a manifest claims the whole tree while covering half of it, and the count is unfalsifiable |
| A file whose sha256 moved since it was judged | A disposition recorded against one version is not a disposition against a version nobody read        |
| An entry naming a file that is not there      | The manifest and the tree disagree, and silently skipping the entry hides which                      |
| One file judged twice                         | One file, one disposition                                                                            |

## What "dropped" means

Excluded from this import and from future profile context, with the reason recorded. It does **not** mean
deleting the original, wiping the `self` corpus lane, or removing rows already stored. `docs/constraints/hard.md`
wants evidence before anything rebuilds or erases a scanned lane, and a disposition is not that evidence.

## Applying

```bash
slopweaver profile harvest --manifest ./harvest.json            # dry: prints the plan, writes nothing
slopweaver profile harvest --manifest ./harvest.json --apply    # ingests the harvested files' self records
```

`--apply` joins on the `self` bronze lane by absolute path rather than re-scanning the directory. Re-scanning
would mint new section ids for the same prose and leave both versions retrievable as current. A harvested
file with no bronze record is REPORTED rather than skipped: it means the self scan has never seen that file,
which is a fact about the corpus a caller needs. The self lane only moves under
`slopweaver refresh --self --self-root <dir>`, never under `--source self`.

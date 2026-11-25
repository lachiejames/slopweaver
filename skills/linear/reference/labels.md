# Labels: list the ids, add a missing one, apply them

An issue and a project each carry `labelIds` in their form. Two verbs supply those ids:

```bash
slopweaver linear labels --team SOPS            # every issue and project label SOPS can apply, full ids
slopweaver linear label create --form - --dry-run   # add ONE label, previewed first
```

**An agreed label goes ON the object, never into its text.** A session once filed 23 Security
issues and two projects with the agreed bucket and access labels written into each issue's fold, because no
verb listed or created a label. The owner's ruling on reading it: the labels were agreed, and a gap in the setup is fixed
at once. These two verbs are that fix.

## Reading: `linear labels`

It reads BOTH vocabularies — issue labels and project labels are separate in Linear, and an id from one
means nothing in the other — and in each it reads the team's own labels AND the workspace's, because both
apply to the team's work. Every page is followed to the end; a vocabulary still going after 5,000 labels is
refused rather than shown incomplete. A row reads `<id>  workspace|team  <name>  (in <group>)  [group]`.
`--json` is one document with `issueLabels`, `projectLabels` and the resolved `team`.

Like `linear states`, copy an id this verb printed. Never lift one out of the corpus: the ingest redaction
pass mangles a fraction of UUIDs into something that still looks like an id.

## Adding: `linear label create`

```json
{ "kind": "issue", "fields": { "name": "Can drive", "teamId": "<team uuid from linear labels>" } }
{ "kind": "project", "fields": { "name": "Audit" } }
```

- `kind` is `issue` or `project`. Omit `teamId` for a WORKSPACE label; set it for one team's.
- Optional: `color` (`#rrggbb`), `description`, `parentId` (a group to sit under), `isGroup`, and on an
  issue label only, `groupType` (`singleSelect` | `multiSelect`, which needs `isGroup: true`).
- Refused at the form: an unknown key (including Linear's `replaceTeamLabels`, which would retire every
  same-named team label across the workspace), a name with a line break or edge whitespace, a group under a
  parent.

The label id is DERIVED from the form, so a retry after a lost response reuses it and the ledger refuses a
second create of the same label. Outcomes match `linear relation create`'s: `created`, `landed` despite a
transport error, `unconfirmed` (do not re-run; look with `linear labels`), `indeterminate`, `duplicate`,
`failed`. `--json` emits `{ id, outcome }`.

**Check before you create.** Run `linear labels` first: a workspace label of the same name already applies
to the team, and a second one beside it is two labels nobody can tell apart.

## Applying them

`labelIds` REPLACES an object's whole label set, so read what it carries first and send the union:

```bash
slopweaver linear read RRRR-615 --json                          # its current labels
slopweaver linear issue update --fields-only --form - --dry-run   # labelIds: existing + new
slopweaver linear project update --form - --dry-run               # a project's labelIds the same way
```

`--fields-only` sends no description and no title, so a label change cannot touch a word anybody wrote
([updating](updating.md)). A project update has no such mode: it always sends `name` and `teamIds`, and
`teamIds` replaces the project's teams too. So copy both from `linear read <project-url>`, whose payload
carries the project's `teams` connection for exactly this — one project was once on SOPS
and SUP, and an update naming SOPS alone was refused by Linear only because SUP owned issues in it. Read each
object back afterwards and quote what Linear now holds.

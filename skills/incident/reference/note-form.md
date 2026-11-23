# The incident note form

`slopweaver incident note --form <file.json>` reads ONE JSON object and refuses the first field that does not
describe a whole write-up — rule 7: the schema caps what sits above the fold and refuses, never truncates. The
checks live in `src/incident/form.ts`, `src/incident/formEvidence.ts` (`proof`, `cites`),
`src/incident/findingFields.ts` (`adds`, `meaning`, `impact`, `lean`, `shot`) and `src/hand/quotes.ts`;
`src/incident/note.ts` turns the form into the note. This page says what each field is for, in the order the note
shows them: **the meaning and the receipts first, the ask last**.

```json
{
  "meaning": "<the impact in people, up to 62 characters: 12 people could not complete a signup>",
  "proof": "inc-34-receipts",
  "quotes": [
    { "text": "<the line, verbatim>", "who": "<who said it>", "permalink": "https://<ws>.slack.com/archives/C…/p…" },
    { "text": "<the line, verbatim>", "who": "<who said it>", "permalink": "https://<ws>.slack.com/archives/C…/p…" }
  ],
  "cites": ["https://app.datadoghq.com/…", "https://github.com/…/pull/…"],
  "shot": { "path": "/abs/path/datadog.png", "boxes": ["x,y,width,height=label"] },
  "stillReal": "<the command or observation that re-checked the finding just now>",
  "impact": "<one line, up to 300 characters, or { question, askWho, wall } past an access wall>",
  "adds": "<what the fleet brings the channel does not already have, up to 200 characters>",
  "rootCause": "<one line, up to 300 characters>",
  "status": { "telemetryClearSinceIso": "<UTC instant ending in Z>" },
  "stakeholders": ["<name (role)>", "<name>"],
  "row": "incident-c0syn000004",
  "channel": { "id": "C0SYN000004", "name": "inc-2001-01-01-payment-checkout-regression", "reference": "INC-98" },
  "lean": "<what the seat recommends, said as its lean>",
  "channelDraft": "sd-xxxxxxxx",
  "bugsThread": { "draft": "sd-xxxxxxxx", "thread": "https://<ws>.slack.com/archives/C…/p…" }
}
```

## The meaning and the receipts

| Field       | Rule                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meaning`   | Required, at most 62 characters: the impact in PEOPLE, the card's first words, never the mechanism ("translation tax"). A UX bug they got past is smaller news than one that stopped them.                                                                                           |
| `proof`     | Required, the first field checked once every key is known: the slug of the receipts page published with `slopweaver page publish <slug> --page <file> --review <id>`. The note's Open button lands on its viewer address and its details open on it. A slug with no page is refused. |
| `quotes`    | Two or three, verbatim, each one line of at most 200 characters, `who` at most 60, and a Slack message permalink. The ONLY lines above the fold besides the question.                                                                                                                |
| `cites`     | One to eight https links, the FIRST on Datadog (refused otherwise: the evidence leads), then deploys and pull requests.                                                                                                                                                              |
| `shot`      | Required: the Datadog screenshot proving it, and its boxes, exactly as `hand post --shot`/`--box` take them. No proof, no note.                                                                                                                                                      |
| `stillReal` | How the finding was re-checked just before the note.                                                                                                                                                                                                                                 |

## The finding

| Field          | Rule                                                                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `impact`       | One line, at most 300 characters: who was hit, how many, for how long. Past an access wall, `{ question, askWho, wall }` (`askWho` at most 60, `wall` at most 120): the question someone with that access could answer, and the access tried and how it was refused. |
| `adds`         | Required, at most 200 characters: the hard evidence the room lacks (events actually dropped, an impact bigger than it realised). Nothing to add means no note: the room already has it.                                                                              |
| `rootCause`    | One line, at most 300 characters, settled by the evidence in `cites`.                                                                                                                                                                                                |
| `status`       | `{}` while neither half is in; `telemetryClearSinceIso` once the telemetry is quiet; `customerConfirmedBy` once support or a customer says so. SOLVED needs both.                                                                                                    |
| `stakeholders` | One to eight names — the lead, the people affected, the people who will act.                                                                                                                                                                                         |
| `row`          | The board row detection registered; the card waits on it.                                                                                                                                                                                                            |
| `channel`      | `id` is `C…`/`G…`; `reference` (the `INC-n` incidents.io gives it, from the topic) names it in the question when present.                                                                                                                                            |

## The ask, last

| Field          | Rule                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lean`         | Its recommendation on the share, as its lean. Refused when it leads with or asks to approve a pull request (`src/briefing/pullRequestLead.ts`).                                                            |
| `channelDraft` | The parked cross-post to the incident channel (`slack draft record`).                                                                                                                                      |
| `bugsThread`   | `{ draft, thread }` for the related bugs thread a person started, never a bot alert's ([who-will-see-it](../../slack/reference/who-will-see-it.md)), or `{ none: "<why there is none>" }`. Never left out. |

The headline is `meaning` then a question fixed by the verb: _"12 people could not complete a signup: should we
share it with the team (INC-98)?"_. A `meaning` and a `reference` (at most 20 characters) both at their caps make
exactly the 120-character headline cap. The reference goes in parentheses after the words because a card's headline
says what a thing is before it names its code (`src/briefing/untranslatedCode.ts`), and is dropped when there is none.
The details behind the disclosure row run `Proof:` first, then `Impact`, what the channel does not have yet, status
and `Root cause` (the mechanism below the meaning), stakeholders, and both drafts last. The step's id is
`inc-<channel id, lowered>-r<n>`; a later form for the same channel is `r<n+1>` and supersedes the open revision on
the same register line.

## Dry run, then the chair

`--dry-run` runs every admission `hand post` would against THIS home — the proof page is published, the row exists,
both drafts are parked, the seat may post — then draws the note from a throwaway home, so the owner's Queue is untouched. A
seat proves its form that way and hands the path to the chair; only the pinned supervisor runs `incident note`
without `--dry-run`.

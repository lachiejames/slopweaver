# The postmortem card form

`slopweaver incident postmortem --form <file.json>` reads ONE JSON object and refuses the first field that does not
describe a whole card. The checks live in `src/incident/postmortemForm.ts`, reusing the note form's `meaning`,
`proof`, `quotes`, `lean` and channel checks; `src/incident/postmortem.ts` turns the form into the card and checks the
parked reply. Shown in the order the card shows them: **the meaning and the briefing first, the ask last**.

```json
{
  "meaning": "<the impact in people, up to 62 characters: 412 customers could not pay at checkout>",
  "proof": "inc-34-briefing",
  "quotes": [
    { "text": "<the line, verbatim>", "who": "<who said it>", "permalink": "https://<ws>.slack.com/archives/C…/p…" },
    { "text": "<the line, verbatim>", "who": "<who said it>", "permalink": "https://<ws>.slack.com/archives/C…/p…" }
  ],
  "cites": ["https://app.incident.io/<org>/incidents/34", "https://app.datadoghq.com/…"],
  "stillReal": "<the command or observation that re-checked it just now>",
  "meeting": { "state": "scheduled", "atIso": "2001-01-02T04:00Z", "runBy": { "name": "John Smith", "slackId": "U…" } },
  "stakeholders": ["<name (role)>", "<name>"],
  "row": "postmortem-c0syn000004",
  "channel": { "id": "C0SYN000004", "name": "inc-2001-01-01-payment-checkout-regression", "reference": "INC-98" },
  "lean": "<whether the seat thinks the owner should go, said as its lean>",
  "askDraft": "sd-xxxxxxxx"
}
```

| Field          | Rule                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meaning`      | Required, at most 62 characters and ONE sentence: what the incident meant for PEOPLE, the card's first words.                                                                                                                                                                                                                  |
| `proof`        | Required: the slug of the BRIEFING page published with `slopweaver page publish <slug> --page <file> --review <id>` — what happened, who is in the room, what they will want to settle. A slug with no page is refused.                                                                                                        |
| `quotes`       | Two or three, verbatim, from the incident channel, each with `who` and a permalink. The only lines above the fold besides the question.                                                                                                                                                                                        |
| `cites`        | One to eight https links, the FIRST the incident's own incident.io page, whose number matches `channel.reference`: the incident leads, never a pull request. Each passes `hand post`'s own cite check.                                                                                                                         |
| `stillReal`    | How the opportunity was re-checked just before the card — the postmortem has not happened, the owner is not already invited.                                                                                                                                                                                                   |
| `meeting`      | `{ state: "scheduled", atIso, runBy }` with the UTC instant (to the millisecond at finest) read off the invite or the channel, or `{ state: "not-yet-scheduled", runBy }` — never a guessed time. `runBy.slackId` is a member id (`U…`).                                                                                       |
| `stakeholders` | One to eight names: who will be in the room. Together they fit the one 320-character `In the room:` line.                                                                                                                                                                                                                      |
| `row`          | Exactly `postmortem-<channel id, lowered>`, the row `slopweaver incident postmortems` prints the register command for — or, once that slug is claimed, says is registered.                                                                                                                                                     |
| `channel`      | As the note's (an id of at most 21 characters, so every revision's card id fits), but `reference` is REQUIRED and is incident.io's `INC-<n>` (at most six digits): the headline names it. Refused unless the org-health snapshot keeps that incident naming exactly `id` as its channel (`src/incident/postmortemChannel.ts`). |
| `lean`         | The seat's recommendation, as its lean. Refused when it leads with a pull request.                                                                                                                                                                                                                                             |
| `askDraft`     | The parked reply (`slack draft record --row <row>`). Refused unless it is still held, as the owner (never `--as bot`), in `channel.id`, mentions `meeting.runBy.slackId`, and was raised by `row` — checked, and the card posted, under the draft register's lock, and refused while any register line will not read.          |

The headline is `meaning` then a fixed question: _"412 customers could not pay at checkout: should we send this to join
the postmortem (INC-98)?"_ — a 62-character `meaning` and a 10-character reference make exactly the 120-character cap.
The details run `Briefing:` first, then the meeting, who is in the room, and the reply last. The card's Open button is
the briefing; a card on a `postmortem-` row that opens anything but a published page is refused
(`src/hand/proofLink.ts`), and `hand post` refuses a `postmortem-` row outright, since only this verb checks the
reply. Its id is `pm-<channel id, lowered>-r<n>`; a later form for the same channel supersedes the
open revision. `--dry-run` admits against this home and draws from a throwaway one, as `incident note --dry-run` does.

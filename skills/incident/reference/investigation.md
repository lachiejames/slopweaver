# Investigating a live incident

The owner's rulings on the row: the rules are a little different mid-incident; people sometimes know the state of
the world better than the seat does; there is usually smoke before the seat finds the fire. Identify the key stakeholders
early; without them, do not expect much to happen. So the seat
reads the room as hard as it reads the telemetry, and every read goes through a door.

## Where to look, in order

| Source                    | Door                                                                                            | What it settles                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The incident channel      | `slopweaver slack read-thread <a message link> --channel-around <n>`, then each thread it shows | Where they have got to, who leads, what is ruled out, the quotes                       |
| Datadog                   | `slopweaver datadog logs`, `errors`, `rum`, `apm`, `monitor`, `alert-digest`                    | The error, its first sighting, its volume, when it went quiet                          |
| The evidence picture      | `slopweaver datadog shot`                                                                       | The panel that shows the root cause or the impact, for the note                        |
| Deploys and pull requests | `slopweaver github search`, `github pr`, `github read`                                          | What changed just before the first sighting, and the fix                               |
| The bug-report channels   | `slopweaver store hits --term <symptom> --shape exact --source slack`, then `slack read-thread` | The smoke before the fire, and the related bugs thread a person started, to cross-post |
| Support                   | The same, over the support channels — external customer-facing AND internal staff-facing        | Whether people are still hitting it after telemetry says it stopped                    |

A **private incident channel the bot is not in** is never listed by the sweep and cannot be read: the route is to
invite the bot, never a different token. An access wall anywhere else is the fleet's to get past, not the owner's.

## Stakeholders

Name them from what they did in the channel, never from a guess: whoever declared it and leads it, whoever is
affected (a team, a customer group), whoever owns the code the root cause names, and support's contact. The note
lists them; it tags nobody — tagging is the post's job, after the owner's yes.

## Root cause and impact are evidence, not prose

- **Root cause** is settled when one piece of telemetry and one change line up: the first error after a deploy,
  the parameter a client began sending. Cite both. A hypothesis is said as one and the note's status stays open.
- **Impact** is who, how many, how long — counted in Datadog (`rum`, `logs`), not estimated.
- **Status** follows the owner's rule for SOLVED, which asks two things — was the error observed in telemetry, and
  did the customer come back and say whether it was solved — and calls it solved only after both confirm. Until a support or customer message confirms, the
  status reads "telemetry clear since <time>, customer confirmation pending", and the confirming message is an
  attributed claim — who said it, with its permalink.

## Updates

_"You reveal updates as they come"_ (turn EV6MwxU). The first note goes once the channel has been read and there
is a first reading; each meaningful change — root cause found, impact counted, telemetry clear, a customer
confirming — re-runs `incident note` with the amended form, which supersedes the open revision. Rereading the
same evidence is not an update.

## The cross-posts

Both drafts are what the owner's yes sends, so each must stand alone in its room:

- **Incident channel**: root cause, impact, status, the evidence links — what the room does not already know.
- **Bugs thread**: the incident's state, for the people who reported the symptom, in a thread a person started. A bot
  alert's thread is nobody's, so there it is `{ none }` ([who-will-see-it](../../slack/reference/who-will-see-it.md)).

Read the thread again just before parking each draft (`slack read-thread`): a draft that repeats what someone
said an hour ago is noise in the room the owner is asking to post into.

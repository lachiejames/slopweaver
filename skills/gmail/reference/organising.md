# Organising mail — three verbs, one Gmail call

What each verb really does to labels, and the six things to carry into every use. The rule — nothing here is
destructive or irreversible, and "already done" is reported as already done — is in [SKILL.md](../SKILL.md).

Gmail has no archive and no mark-as-read. It has ONE mutation — add and remove label ids — and these three
verbs are that call wearing the names a person actually uses:

| verb                              | what it really does    |
| --------------------------------- | ---------------------- |
| `gmail archive <id>...`           | removes `INBOX`        |
| `gmail archive <id>... --restore` | adds `INBOX`           |
| `gmail mark <id> --read`          | removes `UNREAD`       |
| `gmail mark <id> --unread`        | adds `UNREAD`          |
| `gmail label <id> --add/--remove` | adds/removes any label |

Knowing that is what lets you answer "why is it still in my inbox" without guessing: it is a label, and
`gmail read <id>` shows which labels a message carries.

**`archive` alone takes many ids**, up to 100, so the exact set a triage card named moves in one call. Each id is
still its own plan, door request and report, in the order given; a repeated id is dropped. With several ids a
failure line is prefixed by its id and `--json` prints one compact line per id; one failed id does not stop the
rest and makes the exit 1. A refusal's usage text names the many-id form.

**Six things to carry into every use of them:**

- **`--dry-run` first when the request is broad or the label is unfamiliar.** It resolves the label names,
  reads current state, prints exactly what would change and sends nothing. Cheap, and it catches a name that
  resolves to something other than what the person meant.
- **`--thread` is usually what a person means.** Archiving ONE message leaves the rest of the conversation in
  the inbox, which reads to them as "it didn't work". A bare mutation says so in its residue; prefer
  `--thread` when they said "that email" about a conversation.
- **Labels resolve by NAME or by id.** `--add "Waiting on"` works; so does `--add Label_7`. Run
  `gmail labels` to see the vocabulary. An ambiguous or unknown name is refused by name rather than silently
  doing nothing — which is what the raw API does with an id it does not recognise.
- **`gmail label` will not ADD `TRASH` or `SPAM`.** Adding `TRASH` deletes mail and adding `SPAM` trains a
  filter against the sender; the verb refuses both and says why. Removing either is allowed, so mail can be
  rescued. Do not look for another route to a refused add — report it and stop.
- **Nothing here is destructive, and nothing is irreversible.** Archiving does not delete: the mail stays in
  All Mail and stays searchable. Every change has an exact opposite in the same verb.
- **"Already done" is reported as already done.** A mutation that would change nothing is not sent, because
  Gmail would accept it and report success — and a report that said "archived" for something never in the
  inbox would be a lie you had no way to catch.

Each mutation states, in its residue, that the label state was read BEFORE the change and Gmail offers no
compare-and-set. A change made elsewhere in between is neither detected nor reported. Do not present a
mutation result as proof of the mailbox's current state; re-read if that matters.

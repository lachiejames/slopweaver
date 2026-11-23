# What each declared rule covers

Bundled reference for [inbox-triage](inbox-triage.md#standing-rules). The code ships the MECHANISMS below and no policy:
which of them an install switches on, and which senders it rules, is the store's `gmail-triage-rules` row, read with
`slopweaver gmail triage-rules` and replaced whole with `--set <path>`:

```json
{ "schemaVersion": 2, "rules": [], "structuralRules": [], "delegates": [], "gatedRules": [] }
```

Every entry carries a non-empty `anchor` and `why`, and is the owner's word, so none of the knowledge-row checks applies
to it. A fresh install's row is empty, and an empty policy rules nothing: every group is carded and nothing is held out.
`gmail triage --ruled` prints every inbox id a declared entry covers; archive and record them as the parent says.

**A `from:` row** covers a group keyed exactly with nothing from the owner's own domain or a discussion list, so a person's
mail from the same domain is still carded. It does not need `ruleable`: the declaration is the owner's word that the address
is a machine's, and a vendor's `accounts@` address carries no signal the `automated` heuristic reads. A `from:` row may
carry a subject phrase too, when the owner ruled out only some of an address's mail — a certificate notice from a sender
that also mails password resets — so EVERY message's subject must carry it.

**A `relay:` row** (one vendor's alerts through an internal Google Group) cannot take the domain guard — the group's
address is the owner's own domain and it stamps `List-Post` on everything — so it covers the exact key only when EVERY
message's subject carries the row's phrase; a colleague posting to the group is keyed by their own display name.

**The `last-reply` structural rule** archives a thread the owner answered last: `gmail triage` holds it out of every
group and `--ruled` prints its ids under key `thread:<threadId>`, archived and recorded exactly like a sender row, the
rule's anchor the `--steer`. Without it, no thread is read and such mail is carded with its sender.

**The `passed-invite` structural rule** archives an invite whose meeting already happened. `gmail triage` judges each one
carrying Google Calendar's `invite.ics` off its subject ([triage](../../gmail/reference/triage.md)) and `--ruled` prints it
under key `invite:<id>`, archived and recorded like a sender row, the rule's anchor the `--steer`. A recurring meeting's
invite, or one still to come, stays with its sender's group, and a declared
[answered-invite gated rule](inbox-triage-state-gated.md) still applies to it.

**A delegate** holds a sender's mail out of triage for the verb that owns it: `fathom-clear-inbox` for Fathom's recaps,
`gmail-clear-meeting-notes` for Gemini's meeting notes, `spend-tasks` for spend mail. A delegate the policy does not
declare holds nothing out, so that mail groups and is carded like any other.

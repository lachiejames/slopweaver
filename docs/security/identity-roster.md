# The identity roster is off-repo

Part of [Security & trust](../security.md).

The cross-source identity map (who is the same human across GitHub/Slack/Linear/Notion) is seeded by the
install's **identity roster** — the human override that always wins over an inferred link. It holds real
handles/emails, so it is **never committed**: it is the `identity-roster` row of the local store's
`singleton_register` (`src/silver/identityRoster.ts`), and nothing ships but the code that reads it. Inferred
links are data-first — each carries a confidence + provenance, and a low-confidence name-only match is held
(surfaced), never silently applied.

**The row is the authority, read and written through one port.** `slopweaver identity roster show` prints the
row and its revision; `slopweaver identity roster replace --file <path> --expect-revision <n|none>` writes a
whole new document only when the stored revision is still the one named, and is never retried — a conflict
means someone else wrote first, so read it again. Every document is decoded STRICTLY, the import, a
replacement and the stored row alike: an unknown key or a malformed entry is a refusal naming its index, never
its value, so nothing but the roster's own fields can ride into the store. The bot role reads this one row of
`singleton_register` (`id = 'identity-roster'`) and no other, because a bot turn resolves the mentions it sends.
It READS only: the one-time import below is an INSERT, so a connection wearing the bot role that finds no row
beside a retired file is refused by the database and answers `IDENTITY_ROSTER_STORE_UNAVAILABLE` rather than
importing. Any operator read (`identity roster show`) performs the import.

**The retired `$SLOPWEAVER_HOME/identity.json` is imported once, then inert.** A read finding no row imports
the file (insert-if-absent, then re-read, so two racing readers agree); from then on edits to the file do
nothing, and `identity roster show` names the file as retired. No file and no row is an empty roster at
revision `none`. **A store outage is a refusal, never the file**: `IDENTITY_ROSTER_STORE_UNAVAILABLE` stops a
caller that would address a person, since who a handle names is then unknown. A send that names nobody still
goes, because no roster could change it.

A roster record may also carry **`heardAs`**: what the owner's voice-to-text makes of that colleague's name
(`["smitty", "smythe"]` on John Smith's record). It is consulted only after the exact member
ladder names nobody, only when exactly one record claims the token, and it routes to the record's email (else
its one Slack id), re-resolved through that same ladder — so a colleague who really carries the token still
wins, and an answer reached this way says so (`identity resolve` prints `heard-as:`, `--json` carries
`heardAs`). It is the owner's declaration about the owner's own dictation, one person at a time, and not an in-code spelling
table, which is refused; `src/silver/heardAs.ts` holds the mechanism and no names.

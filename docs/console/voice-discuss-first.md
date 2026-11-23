# A fix the owner asks for on a team repository gets one question first

The owner wants a nudge asking whether the fix was actually discussed with the team first, since the owner may not
know of a discussion that happened. An explicit ask from the owner overrides pretty much anything else, and a nudge
that gets annoying is reported and tuned. The meeting-start nudges are its shape, which are useful rather than
annoying ([doctrine](../doctrine-rationale/rule-10-team-facing.md#fixes-wait-on-the-owners-word-and-why)).

- **The relay names the fix.** `relay_steer` takes `fix_repo` (`owner/name`) and `fix_thread` (the Slack link,
  never composed) when the owner's words ask for a fix raised on a team repository. Slopweaver's own repository carries no
  nudge; anything outside the organisation, or a thread with no repository, is refused (`site/lib/discussFirst.ts`).
- **The first ask for a repository this call puts the question, and that is the whole answer**
  (`site/lib/relayAnswer.ts`'s `discussFirstNote`): "Quick check. Did you actually discuss this with the team
  first? If you did, I'm not aware of it.", plus "That thread is the place to start it." when it had one, then it
  waits. The call's ledger (`site/components/voice/discussFirstLedger.ts`) is claimed before the answer goes back,
  so a lost answer never asks twice; a reconnect keeps it and a fresh call starts empty. A put whose own post did
  not certainly land is posted again, once and under its own turn, just before the owner's answer to it, so the answer names
  a turn on record (`relayAttemptPost.ts`'s `replayPut`).
- **The owner's next ask naming the same repository carries past it**, whatever the owner said: a go-ahead stands; one the voice
  relays without `fix_repo` arrives bare, and the chair reads it against the open HOLD. `talk relay
--discuss-first put|override --team-fix <repo>` opens the row and the chair's line on `DISCUSS-FIRST HOLD` (start
  no fix) or `DISCUSS-FIRST ANSWER` (the owner's words answer it), what to do before the repository so the chair line's
  240-character cut can only clip the name, and the turn's digest binds it (`src/talk/discussFirst.ts`). The turn
  record keeps the marker, and an answer stands only when the turn it names put the question for that repository; any
  other opens on a HOLD saying why, so no request can forge a go-ahead.
- **The chair asks the same sentence** on a fix the owner types to it directly, and marks a held row once the owner's answer
  arrives ([routing § 3a″](../../skills/supervisor/reference/routing.md)).

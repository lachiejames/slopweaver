# The launch bound

A launch's `title` and `ledgerKey` are at most `APP_SESSION_TITLE_MAX_CHARS`, 200 UTF-16 code units (a string's
`.length`), in the mirrored `launchSpecWire.ts`. Every session snapshot and usage answer echoes both, and every
picture the title, for the session's whole life, and a line past the protocol's 1 MiB cap (`APP_HARNESS_MAX_LINE_BYTES`) is refused, never
truncated, so one overlong title would poison each of those answers for as long as the session lived.

- **Both doors refuse it.** A `launch.prepare` or `launch.resume` past the bound is `BAD_REQUEST` with a message
  naming the request kind, the field and the limit (`appLaunchBoundRefusal`). The app answers it at
  `parseRequestLine` (`desktop/src/sessionSocketServer.ts`); the CLI refuses before it opens the socket
  (`src/sessionHarness/appSocketTransport.ts`), so an app from before the bound is never handed one. The protocol
  version is unchanged: a launch within the bound reads as it always did.
- **Why 200, counted in code units.** Every title the CLI makes is a handover slug or one capped at 60
  (`src/cmux/planNames.ts`), and 200 leaves room above both. Code units keep the mirrored file free of a byte
  encoder; at the worst JSON escape, six bytes a unit, a bounded field is still 1,200 bytes on the wire.
- **The directory is not bounded.** A launch names a directory that already exists, which the OS's path limit bounds.
- **The recovery journal reads the same check.** An `opened` row written before the bound with a longer title or
  ledger key is a malformed line, and the app refuses every resume and inspect from a journal holding one.

## The submitted-text echo

A message is bounded only by the 1 MiB request line, and every snapshot echoes the last one submitted, so a snapshot
keeps at most `APP_SESSION_SUBMITTED_TEXT_MAX_CHARS`, 2,000 code units, of it (`lastSubmittedText`). A longer message
is echoed as its first 1,999 units and `…` (`boundedSubmittedText`, in the mirrored protocol file; 1,998 when unit
1,999 opens a surrogate pair), written once at `desktop/src/sessionEcho.ts` beside the agent text's tail. The
worker is sent the whole text.

- **A head, never a tail.** `fleet recover` compares the echo whole against the prompt it sent, which fits, and
  `submittedMessageConfirmsSend` (`src/cmux/sendEvidence.ts`) reads it as a prefix once the `…` is dropped, cmux's own
  shape; a tail fails both.
- **A snapshot check does not enforce it.** An app from before the bound still echoes the whole text, and a CLI that
  refused that snapshot would refuse a protocol it speaks, so the version is unchanged.

## What it does not bound

One session's fields, not a whole answer. A list's session count is unbounded, with no paging, so `session.list` is
smaller per session but can still pass the cap.

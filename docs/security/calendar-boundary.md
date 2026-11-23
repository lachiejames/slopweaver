# The calendar boundary (`calendar`)

Part of [Security & trust](../security.md).

The diary is the third Google surface here, and it sits on the SAME credential machinery as the mailbox and
Drive — the loopback consent listener, the auth client and the grant store are shared code
(`src/live/google/`, `src/secrets/googleGrant.ts`), so everything the mail boundary says about the socket
and about the refresh token is true of `calendar connect` word for word. What is different is worth stating
plainly.

- **This door reads, and can be GRANTED one write scope.** `src/live/calendar/scopes.ts`
  declares five read capabilities, every one a `…readonly` scope or `calendar.freebusy`, and exactly one
  write capability: `ownedEvents`, `calendar.events.owned` — create, change and cancel events on calendars
  the account OWNS. The owner wants the primary calendar only: no secondary calendar is created and no one
  else's calendar is edited. Nothing
  wider is requestable: not `calendar.events` (every calendar the owner can write to, shared team ones
  included), not `calendar` (everything), and not `calendar.app.created`, which is declined by name. `calendar connect
--grant meetings` is the only way the write scope is asked for; `read` and `events` stay read-only. A
  calendar write mails every attendee, which makes it an outward action aimed at other people — the class
  `gmail send` is gated as — and every write verb HOLDS for the owner's digest whenever it would reach
  anyone but the owner
- **Free/busy needs no scope of its own.** `calendar free` asks `freebusy.query`, which Google admits under
  the `calendar.readonly` the read grant already holds (and under `calendar.freebusy` or
  `calendar.events.freebusy` from elsewhere); the narrow `events` grant refuses it by name. It consults the
  owner's primary calendar and the addresses named with `--with`, and a colleague's calendar that Google
  will not answer for makes common availability UNKNOWN rather than free — the slot list is emptied and the
  residue names the calendar.
- **Its grant is a SEPARATE FILE from the mailbox's and Drive's, and its token carries only its own
  consent.** `secrets/calendar-oauth.json` sits beside `secrets/gmail-oauth.json` and
  `secrets/drive-oauth.json`, all `0600` under the `0700` secrets directory; `calendar connect --status`
  reports that file and nothing else, and a calendar read is never authenticated by a mailbox grant.
  `src/live/google/oauth.ts` deliberately does NOT send `include_granted_scopes`, so a stored grant equals
  its own consent screen rather than the union of everything the shared Desktop-app client holds on the
  account, which would let a readonly consent land a grant carrying another door's write scopes. The Google
  Admin door also resolves its OWN client, `google-admin-client-id`, so
  once that names a different OAuth client from `google-client-id` the admin/user-data line holds even if
  that parameter came back. The standing line is write on Gmail, Drive, Docs and Calendar; read-only on
  Google Admin. The CLIENT is still shared by the mail, Drive and calendar doors, so revoking at
  <https://myaccount.google.com/permissions> revokes all three at once. The rails
  `src/__tests__/unit/live/google/actsOnlyAsTheBoundAccount.test.ts` checks are that nothing sends as another
  person, no Admin scope writes, no Drive scope can wipe a drive, each door resolves its own client
  credential, and no consent URL asks Google to merge scopes.
- **`--grant read` sees every calendar the account subscribes to, and the narrower `events` grant sees
  none.** Google does publish a calendar-list-only scope (`calendar.calendarlist.readonly`, in the installed
  SDK's own scope table), which this door does not request: the list is only ever asked for alongside the
  events on it, so `calendar.readonly` is the one scope that buys both. `--grant events` reads events on a
  calendar you already know the id of and cannot enumerate calendars at all; `calendar calendars` refuses
  on it by name.
- **`calendar read` output is UNREDACTED**, exactly as `gmail read` and `slack read-thread` are, and for the
  same reason: reasoning about the actual meeting is the point. Attendee addresses, the description and the
  join URL all enter the visible session and leave your machine with it, under [the visible-session egress](data-flow.md)
  above. If a meeting is too sensitive to send to that host, do not read it here.
- **A titleless event is not an empty hour.** An event on a calendar this grant can only see as free/busy,
  or one the owner marked private, comes back with no title at all — and every read says so in its residue
  rather than letting a reader treat the gap as free time.
- **Attachments and an event's own change history are never read.** A read reports the event as it stands
  now; Drive files attached to it are not fetched, and Google's revision history is not walked.
- **A write is only ever made to the BOUND account's own `primary`, and that is checked three times.**
  `assertWriteTargetIsOwnPrimary` (`src/live/calendar/write.ts`) runs at prepare, at commit and at apply,
  because `productionCalendarWriteDeps` resolves a fresh credential at each — so an intent previewed and
  approved under one account cannot be inserted into another account's diary after a re-connect, carrying a
  digest computed over the first. It is also what makes Google's `self` flag safe to read as "the owner":
  `self` is CALENDAR-relative, so it only means the owner because the calendar is always the owner's.
- **The approval is the owner's anchored word bound to a digest, not an authentication.** `calendar commit --anchor
<where the owner said yes>` reads the owner's whole words through the shared resolver (`src/handover/hisWords.ts`) and sends only when the
  plan rebuilt now digests to the `previewDigest` the intent stored at prepare; `--approve <digest>` is the
  other spelling. Either proves the change is the one that was previewed; neither proves a human spoke or
  typed it — an anchor is attributable, never proof. What it buys is that the yes is on the record: the
  applied intent carries `approvedBy` (anchor and instant, never the owner's words), so an over-read is findable.
  A session still never passes `--approve` with a digest it printed itself, and never asks the owner for one
  (the owner steers on the voice and does not type digests).
- **"Inward" is a claim about GUESTS, and about nothing else.** It means the write adds, removes or tells
  no attendee, so Google mails no invitation, update or cancellation — `sendUpdates: "none"`. It does NOT
  claim the event is unobserved. Anyone the owner has already shared the owner's calendar with sees it, and a
  subscriber who turned on their own new-event notifications is emailed by Google about it, through a setting
  that belongs to the subscriber rather than to this write. Establishing that would take reading the
  calendar's ACL and every subscriber's notification preferences, which is a wider grant than the one the
  owner chose — so the boundary is stated here rather than claimed away. The rails that DO hold are the three
  refusals: a write to any calendar but the owner's own primary, a series master whose exceptions can carry unseen
  guests, and a block whose `autoDeclineMode` composes refusals to strangers.
- **The WRITE cassette records INWARD writes only, and that is a rail rather than a convenience.**
  `src/__tests__/integration/calendarWrite.test.ts` (quarantined in `config/vitest/integration.ts` while no
  recording of it is committed) records one real `insert` → `get` → `patch` → `get` →
  `delete` cycle on the owner's own primary calendar with NO attendee, so nothing Google does on the back of
  a recording reaches another person. An outward leg is absent because it HOLDS for the owner's own
  anchored yes and a recording session has none to give — the hold is proven
  over fakes in `unit/cli/commands/calendar/writeRun.test.ts` instead. The suite asserts, in both lanes
  before anything is written, that the grant it runs under carries `calendar.events.owned` and no wider
  calendar write scope; the recording itself keeps no title, description, location or address, because the
  allowlist redactor blanks them on the way in and the request-body projection blanks them on the way out.
  **A request body is RECORDED, and it is recorded as a projection** (`src/__tests__/cassetteRequestBody.ts`):
  the field names, the nesting, every number, boolean and enum, and a placeholder wherever an identifier, a
  paging bookmark or a piece of free text stood. A replayed request is held to that text byte for byte, which
  is what turns a write cassette into evidence of what was sent rather than a shape check — and the allowlist
  that governs an inbound body governs the outbound one identically. What the recorder never wrote down cannot
  be recovered, so the entries predating it are enumerated rather than silently passed
  (`src/__tests__/cassetteBodyDebt.ts`).

**The calendar DOES enter the corpus, and only when you name it.** `refresh --source calendar` ingests every
calendar the grant can see into bronze, on exactly the terms the mailbox is ingested on and for the same
reason: a diary is the owner's own record of what the owner committed to, which is what a world model is for. Five
properties bound it, and each is a mechanism rather than an intention:

- **`--all-sources` does not include it.** That flag means the four org-shared surfaces
  (GitHub/Slack/Linear/Notion); the diary is reached by typing `--source calendar`, exactly as the mailbox
  is reached by typing `--source gmail`. There is deliberately no second opt-in flag beside it, because
  `calendar connect`'s browser consent round trip is already a more deliberate act than any flag.
- **Every calendar record is PRIVATE by source, not by stamp.** `calendar` is an always-private source
  (`src/corpus/visibility.ts`), so a calendar record reads back private with or without its field and can
  never be served to a non-owner — the same treatment `gmail` and `self` get, for the same reason: an
  event's attendees never joined this workspace and cannot be asked.
- **Addresses are scrubbed and names are kept.** Calendar records go through the same bronze write path as
  every other source, which replaces every email address with `[email]` in the text, title, attrs, raw
  payload AND author (`src/corpus/redactRecord.ts`). An attendee stored as `Jane Smith <[email]>` says who
  was in the room without saying how to reach them. A calendar record's author is the organiser's display
  name, else their address's local part, set at projection (`src/corpus/personName.ts`) so a name survives
  where the scrub alone would leave `[email]` — never a key, which is why `calendar` cannot move the
  derived identity roster (`docs/freshness-contract/rules-and-stamps.md`). A recorded Fathom call's author
  is its recorder or host by the same rule.
- **Recurrences are NOT expanded on the way in.** Bronze stores the recurring master carrying its rule,
  plus any instance that was individually changed. Expanding a daily standup into years of near-identical
  records would be a projection decision made once, badly, at write time — and a BOUNDED expansion would
  silently define "the calendar" as whatever window happened to be planned that day. `calendar list`
  expands for a human asking what is on; the corpus does not.
- **A cancelled event keeps its record, and the delta cursor cannot skip an edit.** Cancellations are
  ingested rather than dropped, because a corpus that discarded them would assert a meeting took place. The
  lane resumes from Google's own `syncToken` per calendar, so an edit made today that moved a meeting held
  last month is seen — a time-ordered cursor never would be. A token is withheld whenever the pass could not
  read every calendar, was capped by `--sample`/`--fetch-cap`, or would have been sent under parameters it
  was not minted for.

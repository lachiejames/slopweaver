# Gated rules: archived only once state says so

Bundled reference for [inbox-triage](inbox-triage.md#standing-rules). A gated rule is an entry in the policy's
`gatedRules` (`slopweaver gmail triage-rules`), the owner's word with its own `anchor` and `why`, so the three checks
under standing rules do not apply to it. `gmail triage` never applies one itself: a seat runs the check below on a
pinned group, and anything that fails the gate is carded as usual. An install that declares no gated rule cards every
such group. Two kinds exist:

- **`provider-integration-not-installed`**, keyed on one `from:` address: mail from a monitoring provider about an
  integration the provider's own API reads as not installed. For Datadog, read the integration catalogue with
  `slopweaver datadog raw --path /api/v1/integration --json` and find the named integration's entry in `.bodyText`,
  the answer as Datadog sent it, each entry carrying `installed`. Pin the group and read every subject: only when EACH
  message is about an integration reading `installed: false` is the pin archived. A pin holding any other mail from
  that address (a monitor, billing, an installed integration) is carded instead, and so is an entry absent from the
  list or an unreadable answer. Put the state read on the check-in card.
- **`calendar-invite-responded`**, keyed on no sender: an invite already on the owner's calendar with an attendance
  status set has no further purpose; an invite with no status is a different story. An invitation, updated invitation
  or reschedule comes from whoever organised it. Pin the group and, for EACH message, take the event's identity from
  the invite itself, never from a title: save its `text/calendar` part with
  `slopweaver gmail attachment <id> --name invite.ics` plus `--part <partId>` (the bare call lists the parts), read its
  `UID:` line, and run `slopweaver calendar read <event-id> --json`, the event id being the UID up to its `@`, the
  domain dropped. The event read must be the invite's own: its `iCalUID` equals the `.ics` UID exactly, since an event
  id is unique only within one calendar and a different event can carry it. The owner's own attendee entry there
  (`"self": true`) must have a `responseStatus` of `accepted`, `tentative` or `declined`. Archive the pin only when
  every message passes. One still `needsAction`, a message with no `invite.ics`, a UID that `calendar read` cannot find
  on the owner's calendar, an `iCalUID` that differs from the `.ics` UID, an `.ics` carrying `RECURRENCE-ID` (an invite
  to one instance, whose status the series read does not show), or any message that is not an invite, and the pin is
  carded: an invite the owner has not answered is exactly what the card is for. Put the attendee entry on the check-in
  card. An invite whose meeting already happened never reaches this check when the install declares `passed-invite`:
  `gmail triage` holds it out and `--ruled` archives it ([declared rules](inbox-triage-declared-rules.md)).

Record each act with `slopweaver autonomy record --kind gmail-archive --subject state:live/gmail/triage-cards/<the pin's slug>.json --steer
"<the gated rule's anchor>"` and the rest of its required fields (`--action-id`, `--by-session`, `--why`, `--said`,
`--witness`), the archive's own output the witness. A rule keyed on a `From` matches an unauthenticated header, the
residue the standing rules already name: the act is an archive, and archived mail stays searchable.

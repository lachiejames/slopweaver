# Which requests each write transport judges

The detail behind [private terms on outbound writes](./hygiene-gate.md#private-terms-on-outbound-writes): for each
guarded transport, which of its requests count as writes, what of each is judged, the order of the refusals, and
the residues that are named rather than closed. Every transport reads the policy afresh on each write, from the home
the verb resolved, and a read never loads it.

- **Which Slack calls are writes.** Every method not on the exact read list in
  `src/outbound/slack/writePrivacyPayload.ts`, so a method added later is judged until somebody lists it as a read.
  Ids, timestamps and the token are skipped at any depth; metadata is content.
- **Which Linear operations are writes.** A GraphQL document `isGraphqlMutation` reads as a mutation, one that
  fails to parse included; a query passes unjudged and never loads the policy. An upload is judged before its slot
  is reserved and again immediately before the PUT. A refused mutation never reaches the wire, so a create releases
  the ledger reservation THIS invocation took, still unconfirmed and matched by id and reservation instant, and a
  retry is not reported as a duplicate; a confirmed or earlier reservation is never released, an update releases
  nothing. The release claims the record by renaming it aside before judging it, so a confirm another process writes
  meanwhile is never deleted. Residues: a caller's own prefix around a transport refusal (`linear issue: `) is not
  judged; a refusal between the upload reservation and the PUT leaves a reserved upload slot unused, its bytes
  unsent; a private-term pattern matching committed GraphQL syntax refuses every mutation carrying it, since the
  whole document is judged; and while a claimed record that is not the release's own is out of place, a reservation
  of the same id would succeed.
- **Which Notion requests are writes.** Every request not on the exact five-route read list in
  `src/outbound/notion/writePrivacyPayload.ts`, matched on method AND path and measured off the pinned SDK's own
  `fetch` calls, so a route added later is judged until somebody lists it as a read. Every JSON string leaf is
  judged bar a STRING directly under a token, `auth`, an `id` or a `…_id` key (an object under one, such as a
  database property's `unique_id: { prefix }`, is walked); a body that is not JSON refuses. The dead-host refusal runs
  first, then the privacy check, then the real `fetch`. An upload is judged whole before its slot is reserved and
  each request again at the transport. A refused create releases THIS invocation's still-unconfirmed reservation,
  matched by intent and reservation instant, and reports `failed`; a refused update or move reports `failed`, never
  indeterminate. The release claims the record by renaming it aside before judging it, so a confirm another process
  writes meanwhile is never deleted. Residues: a caller's own prefix around a transport refusal is not judged; a
  refusal of a later request in an upload or an attach pass leaves what earlier requests placed; and while a claimed
  record that is not the release's own is out of place, a reservation of the same intent would succeed.
- **Which Google Calendar calls are writes.** The three `CalendarWriteApi` mutations (`src/live/calendar/writeApi.ts`):
  `events.insert`, `events.patch` and `events.delete`, judged at that seam before `safeProviderCall` starts, so a
  refusal takes no rate slot. The reads sit on separate APIs taking no capability, so a read (`freebusy.query`, a
  POST, included) never loads the policy; the seam is not the OAuth transport because a method cannot tell those
  reads from writes. Every string of the event body is judged, an attendee's email included (each invitee sees the
  others), bar the top-level `id` the door mints from the intent, skipped only while it has that 32-hex shape so
  an id edited into an intent file is judged; the calendar id, event id, ETag and
  `sendUpdates` are not. A delete has no body and still loads the policy, so a broken terms file refuses a
  cancellation too. Audience `strict`: an invitation reaches people outside the organisation. A refusal is
  `PRIVACY_REFUSED`, never `API_FAILED`, so the intent stays `pending` rather than `uncertain`: a repaired terms
  file retries the same `calendar commit`, a reworded change is a fresh prepare. Residues: a Calendar mutation made
  outside `CalendarWriteApi`, or a second Google surface built on `BoundCalendarClient.auth`, is not judged; a custom
  extended-property KEY is not read, only its value; and a preview can be approved that the commit then holds.
- **Which Gmail requests are writes.** Every request to a Gmail host that is not on the exact eight-route GET read
  list in `src/outbound/gmail/writePrivacyPayload.ts`, matched on method AND path and measured off the pinned
  `@googleapis/gmail`'s own `fetch` calls, so a route added later is judged until somebody lists it as a read; OAuth
  and every other Google host pass untouched. Every write is `strict`, a label change included. Every JSON string leaf
  is judged, ids and label ids included; a body that is not strict UTF-8 or not JSON refuses. A `raw` message is decoded strictly
  (base64url, then MIME through the pinned `postal-mime`) and its subject, every address and display name, every
  other header decoded, the text and HTML bodies, each attachment's type, filename, disposition and description, a
  text-like attachment's bytes as strict UTF-8, and a forwarded message up to four deep are judged; anything the
  decoder or parser refuses refuses the write. A send re-reads its draft with `format=raw` immediately before the
  POST and judges what Gmail holds, so a re-read that fails, carries no `raw` or carries a malformed one sends
  nothing. A one-click unsubscribe judges the sender's whole target URL and its body before its `fetch`. The
  dead-host refusal runs first, then the privacy check, then the wire. A refused board draft releases its claim,
  which is renamed aside, judged by its own id and restored without overwriting; any other failure keeps it.
  Residues: the parser does not expose a multipart preamble or epilogue, a nested part's own headers, or the
  filename of an inline text part, so none of those is judged; a draft edited in Gmail between the re-read and the
  send goes out as edited; a streamed request body refuses rather than being read; a caller's own prefix around a
  transport refusal is not judged; and while a claim that is not the release's own is out of place, another press
  could take a fresh one.

## Which writes a meant private term holds for review

Every guarded transport above hands its decision to one function, `privateTermWriteRefusal`
(`src/outbound/privateTermReview/gate.ts`), and a transport holding a review port HOLDS a write whose only findings
are private terms on rows carrying the owner's meaning. GitHub, Slack, Linear mutations, Notion's non-upload writes,
Google Calendar and Gmail hold one; a door with no port refuses the same match outright: a Linear or Notion upload,
and the Gmail one-click unsubscribe POST, which reaches a third party rather than the mailbox a reviewer is told
about. The hold key hashes the family, the
operation, the destination wording, every string sent, a digest of the whole request with its target ids, each
match's offsets and each matched row's exact-bytes digest, so a reworded text, another target, an edited row or a
new match is a new hold. Where a target id names an object only within one account, the request carries that
account too: Calendar's bound account (`primary`), Gmail's mailbox (`me`) and an opaque digest of Slack's token (a
channel id is per workspace). A retry spends one CLEAN Codex receipt for that
key by an exclusive create, so two racing retries cannot both send, and any BROKEN receipt for the key keeps the
write held. Residues, stated:

- **A write held while Codex is capped stays held.** A Claude fallback receipt records no session id, so
  `review-record` refuses one and the release spends none, rather than trust a recorder it cannot tell from the writer.
- **GitHub, Linear and Notion key on the target, not the credential.** A repository object, a Linear id and a
  Notion id each name one object whichever token writes it, so only the identity the words are posted under can
  differ.
- **A confirm races a writer that ignores the lock.** `private-terms confirm` compares the file's raw bytes once,
  under the advisory lock, then renames its staged file over the target; every writer in this repository takes
  that lock, and a process that does not can change the bytes in between. POSIX gives a rename no compare step.
  A confirm racing `private-terms retire` is not this residue: both take the lock and re-read the proposal under it,
  and a stale lock is cleared only while it still holds the bytes judged dead, so neither can delete the other's
  live lock (`src/hygiene/privateTermsLock.ts`, which names the three-way residue left).
- **A send that fails after the spend costs the receipt.** The receipt is spent before the wire, so a provider
  failure leaves the retry held for a fresh review: the fail-closed direction.
- **Gmail's draft and its send are two holds.** The send judges the draft Gmail holds, a different request from
  the one that wrote it, so each needs its own receipt.

## Every write family and its classification

`src/devLint/outboundPrivacyRegistry.ts` is the one list, and the `outbound-privacy-closure` lint gate
(`src/devLint/outboundPrivacyClosure.ts`) holds it closed over two inventories the repository already keeps: every
verb whose manifest declares `effect: "external-write"`, and every SDK factory in `scheduler-bypass`'s
`SANCTIONED_CLIENT_FACTORIES`. A verb no family selects, a factory no family owns (or two do), or a selector or
factory that names nothing live fails it. Each family is one of three:

- **Guarded**: GitHub (the write Octokit, and `github attach` where its fetch is bound to the publication scan),
  Slack, Linear (mutations and the asset PUT), Notion (the write `fetch` and the upload preflight), Google
  Calendar, and Gmail (the API client and the one-click unsubscribe). Each transport root and factory must reach a declared check module through its static runtime
  imports, and each check module must import `checkPrivacy` by name and call it, or the gate fails.
- **Read-only**: the Slack, Linear and Notion read clients and the connect probes, named so the factory inventory
  closes.
- **Residue**, judged by nothing yet, each with its reason in the registry: Outlook mail, Datadog, Cloudflare email
  routing, GCP, browser actions, Vanta Manage, the Claude and Codex usage resets, Codex model turns, and store backup. A residue row fails the moment
  every root of it reaches the check, so it moves to guarded in the same change that lands the guard.

What the gate cannot see, stated: a write whose verb is labelled `external-read` or `local-state`; a write no verb
reaches and no recognised SDK constructor builds; a second transport inside a family that its row does not list;
a dynamic `import()`; a named import used only as a type but written without `type`, which the syntax walk counts
as an edge the compiler elides; and a branch that imports the guard and sends around it, because reachability is
not dominance. Policy freshness and payload completeness stay each transport's own tests.

# The Twilio atlas maps a product nothing else here touches, and its last blocked surface is blocked on a WRITE

Part of [Atlases](../atlases.md).

The per-platform test of [atlas-intent.md](../atlas-intent/06-holdings.md) §6 comes out entities-included here:
no phone number, messaging service, subaccount or delivery status exists anywhere else in this
installation. So the atlas declares five kinds — `account`, `api`, `method`, `page`, `resource` — rather
than a surface map alone. `slopweaver atlas twilio <sync | walk | report | reset>` plus the two kit verbs.

**One `resource` kind rather than one per product, and that is Twilio's own model.** Every configured thing
in a Twilio account is addressed by a 34-character SID whose two-letter prefix IS its type — `PN` a phone
number, `MG` a messaging service, `VA` a Verify service, `WS` a TaskRouter workspace, `FW` a Studio flow. A
kind per product would invent a taxonomy Twilio does not have; the prefix is one it does.

## What `sync` compiles, and the two facts a path alone cannot carry

MEASURED against the pinned lock: **60 published definitions, 893 paths, 1,554 declarations
folding to 1,395 distinct operations**, every parameter and response field name recorded. Reproduce with
`slopweaver atlas twilio sync` and read with `slopweaver atlas twilio read --kind method`.

- **The HOST is part of the answer, because Twilio has thirty-eight of them.** Almost every product answers
  on its own subdomain, and a path item may override its document's server, so the origin is resolved per
  operation. "Which API is this" and "where do I send the request" are two questions and only the second
  has a URL in it.
- **A parameter is not only a query parameter.** Twilio's writes take `application/x-www-form-urlencoded`
  bodies, so an operation's real inputs live in `requestBody`. A reader that took `parameters` alone would
  map `POST …/Messages.json` as taking one path parameter and answer that Twilio has no way to set a
  message's `To`.

Every VERSION of every product is pinned, not just the newest — Twilio serves `/v1/Services` and
`/v2/Services` on the same host at once — and each pin also records which security scheme its operations
require, so "this endpoint exists" and "our credential reaches it" stay separable.

## The delivery-truth question the ask was about, and the honest limit on it

The ask names Twilio the delivery ground truth for customer comms — did the message land, when, and why not.
This atlas answers **where that lives and what can be asked**: `GET
/2010-04-01/Accounts/{AccountSid}/Messages.json` on `api.twilio.com`, filterable by `DateSent<`/`DateSent>`,
returning `messages[].status`, `messages[].error_code`, `messages[].error_message` and
`messages[].date_sent`, behind `accountSid_authToken`.

It does **not** answer whether one particular message landed, and never will: that is a row in the
voluminous family, and reading one is a live call rather than an atlas read. Saying so is the point — an
atlas that implied otherwise would be the more useful-sounding and less honest artefact.

## The voluminous bound is a disposition, and Twilio has the sharpest cut-through yet

MEASURED: **248 of the 1,395 distinct operations are shape-indexed**, every one still mapped with its
parameters and field names, none publishing a row per record. `disposition.ts` applies the criterion per
OPERATION because it cuts THROUGH a product area rather than along it, and the clearest pair is one
character apart in the noun: `/v1/Rooms/{RoomSid}/Recordings` returns the recordings a room produced and is
shape-indexed, while `/v1/Rooms/{RoomSid}/RecordingRules` returns the rules somebody configured to decide
which get made and is an entity. Studio is the same shape at the product level — a flow is authored, an
execution of it is an occurrence.

## The read-through-POST exemption is deliberately NOT taken, and the reason is measured

Exempting a POST family is only safe where the platform has a naming CONVENTION for a read whose input does
not fit a query string. **Twilio has no such convention.** Of the eight read-shaped POSTs in the
pinned catalogue, `POST /v3/InsightsDomains/Conversations/Query`,
`POST /v2/KnowledgeBases/{kbId}/Search` and `POST /v1/Stores/{storeId}/Profiles/Lookup` really are reads,
while `POST /v2/Services/{ServiceSid}/VerificationCheck` and `POST /v1/CallerIds/SmsVerificationChecks`
CONSUME a live verification attempt against a real phone number. The two groups share no suffix, no tag and
no marker, so a rule admitting "a POST that looks like a query" would admit the ones that spend a customer's
one-time code. Three reachable reads is not worth that, so the criterion is the HTTP method alone.

## The browser denominator is HARVESTED, and says that it is a floor

Twilio publishes no authenticated console sitemap and renders its navigation in a single-page application,
so the declared route list cannot be read off the product the way the Falcon one is. Instead it is
harvested from Twilio's own documentation: **80 routes across five console sections, every one carrying the
doc page that named it**, swept from the 828 depth-2 landing pages in `www.twilio.com/docs/sitemap.xml`.
`tools/generateTwilioConsoleRoutes.ts` carries the reproduction command. A route list written from memory
would look identical and be unfalsifiable.

It is a FLOOR rather than a ceiling and the atlas says so: `walk.ts` expands it with the console links each
landed page renders, up to three rounds, so the floor rises as pages are actually reached. Each route holds
`{region}` where the account's home region goes — `us1`, `ie1`, `au1` are the same page under three
prefixes, and a home region is an installation fact this repository does not carry.

## The console surface is FILLED, and the surface still empty is empty by decision

**MEASURED on the first walk**, the ask's `ACCESS: live Chrome session` was not there: `console.twilio.com`
redirected to `www.twilio.com/login` with an empty email field, the walk graded the route `signed-out` and
stored the 1 MB screenshot of the wall as the proof. **MEASURED AGAIN** after the owner signed
in, the same verb over the same browser landed and photographed **210 pages in region `us1`, from the 80
declared routes plus 165 the rendered navigation discovered over 3 rounds**, writing 233 screenshots.
Reproduce with `slopweaver atlas twilio walk` then `slopweaver atlas twilio coverage`.

- **`console`** — filled, and derived rather than declared: `surfaceFill.ts` keys it on the page kind's
  `lastSuccessAt`, which a signed-out walk deliberately does not advance.
- **`account-api`** — `not-configured`, and **not because of the browser surface**. The only route to a Twilio credential here
  is minting an API key, and minting one is a **WRITE**: it creates a durable credential in a production
  account.
  **Settled**: an unregistered platform is `refuse-every-write`, Twilio is not in
  `WRITE_POLICY_REGISTER`, and the browser-door guard refuses that mint — so "nothing would refuse it" has
  stopped being true, and the surface is unfilled **permanently under the current ruling** rather than
  pending one. The `account` and `resource` kinds hold nothing **by decision**, not for want of access —
  which is a different sentence and the honest one. Only the owner's word changes it: the owner mints the key
  personally, or the owner registers Twilio. **The owner has ruled for the first half**: the owner mints a
  restricted Messages-read key for the live read door, `slopweaver twilio` ([skill](../../skills/twilio/SKILL.md),
  `src/live/twilio/`), which prints delivery facts to an investigation and stores nothing. That door does not
  fill this surface: the atlas reads no key, and the door's three secrets are its own
  ([credentials](../security/credentials.md)).

**The walk still stops at the first sign-in wall**, because a session expires and the state it produces —
looked, reached nothing — is derivable from neither of the other two. A wall is a property of the SESSION
rather than of a route, so the second route through it carries no information the first did not; the
remainder are recorded `not-attempted` and one gap names the wall. The short-circuit is falsifiable in the
obvious way — `signedOut` requires that no page landed, so a session that was only partly signed out would
not set it.

## The first signed-in walk found a filter that had been discarding 98% of what it saw

**A first-party call is judged by Twilio's registrable DOMAIN, never by the console's origin**, and the
walk that proved it necessary is the one above. `kit/consoleFold.ts`'s `isRecordableResponse` judges a
first-party call by origin EQUALITY, which is exact on CrowdStrike and GitHub, where the console
and its API share one host. Twilio is the platform this atlas exists to say has **thirty-eight** of them.

MEASURED on the 210-page walk: **10,579 JSON response bodies were captured and the origin test
admitted 233 — folding to exactly ONE distinct operation**, on `console.twilio.com`. The browser channel was
not thin; it was filtered to nothing — and the tell was in the schema all along, since
`twilioMethodBrowserDetailSchema.host` is stored "so a console-only host is visible as one" and could never
have held anything else.

`webReduction.ts`'s `isFirstPartyTwilioResponse` is the replacement: Twilio's own domain matched at a **dot
boundary**, which is the lesson CodeQL already taught this file once
(`js/incomplete-url-substring-sanitization`, alert 40 — `endsWith("twilio.com")` is also true of
`eviltwilio.com`). An analytics beacon, a support widget and a font CDN are not served from `twilio.com`,
so the wider test keeps out exactly what the narrow one did.

**What it then found is not what the change was reaching for, and the difference is recorded rather than
smoothed over.** The expectation was that the console drives Twilio's public product hosts and the origin
test was discarding `api.twilio.com` and its siblings. It does not. The second walk — which **lost its
browser session after 131 of its pages landed, so its counts are a floor and are quoted as one** — recorded
3,424 calls folding to **51 distinct operations across two hosts, 50 on `www.twilio.com` and 1 on
`console.twilio.com`**, and every one of the fifty sits under a `/console/…` prefix
(`/console/api/navigation/rpc` on 128 pages, `/console/iam/assertions`,
`/console/admin/api/v2/managed-users/<sid>/accounts`). Twilio's console is served by a
backend-for-frontend on its MARKETING host, the same host the sign-in wall lives on, which is exactly why an
origin test anchored to `console.twilio.com` saw none of it. That is also why the fix could not have been a
list of product hosts written in advance: the one host it needed is the one such a list would have thrown
out as marketing.

**And not one of those 51 matches a spec-declared operation.** The whole observed console surface is
`report.ts`'s `browser-only` class — private console APIs no published Twilio definition declares — which is
the class the both-surfaces ruling ([atlas-intent.md](../atlas-intent/04-corroboration.md) §4) exists for, produced here for
the first time on this platform.

## `report` collects instances and resolves nothing

Three disagreements are computable and each answers a different question: `browser-only` (an operation the
console's own client calls that no definition declares — the class the both-surfaces ruling exists for),
`spec-only`, and `field-divergence` (both surfaces know it and one carries a response field the other does
not). Over a generation whose browser channel has never been filled it reports **nothing and says why**,
rather than listing all 1,395 spec-declared operations as browser-absent — which would be technically true
and a lie about what was measured. Which surface wins when two disagree stays the owner's call
([atlas-intent.md](../atlas-intent/04-corroboration.md) §4).

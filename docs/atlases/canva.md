# The Canva atlas is where the vendor's own PROSE carries the reachability contract

Part of [Atlases](../atlases.md).

It maps the Connect API's whole published surface with no credential and no network call, and it is the
atlas that had to read English to be correct.

**One published document, 59 operations, and the vendor names both its own operations and its own kinds.**
Canva serves a single OpenAPI description from its own developer site;
`atlas/canva/generated/specLock.ts` pins it by URL, digest, byte length, title, `info.version`, server and
operation count. Reproduce the fetch and the pin with

```bash
curl -sSL https://www.canva.dev/sources/connect/api/latest/api.yml | shasum -a 256
yarn tsx tools/generateCanvaSurfaces.ts --verify   # the committed table, no vendor bytes needed
```

Every sibling atlas derives a taxonomy from path segments and defends it. Here MEASURED all 59 operations
carry an `operationId` and all 59 carry EXACTLY ONE tag, so a kind is the vendor's tag kebab-cased and a
name is its `operationId` — and the generator ASSERTS both on every run rather than assuming them, so a
description that grew an untagged operation fails the run instead of landing under a guessed kind.

**The finding that shaped the whole build: a scope grant is not what makes an operation callable.** An
OpenAPI reader that took `security`, `parameters` and `responses` — which is every sibling atlas's
extraction — would publish a map saying `design:meta:read` is what the analytics family needs. It is not.
MEASURED: **nine operations declare, in an `<Availability>` block inside their own `description` prose**,
that the acting user must be in a Canva Enterprise organisation (seven) or on a premium plan (two). No
scope, security scheme or response code carries that anywhere. **Twenty more carry a `<Warning>` saying the
API is a preview** whose breaking changes produce no new API version and which a public integration cannot
pass review with, and one names its own replacement. `atlas/canva/eligibility.ts` reads both out of the
prose and THROWS on a block it cannot classify, because a `stable` verdict on a preview looks exactly like
a correct answer everywhere downstream.

**Canva disagrees with itself, and the atlas raises that rather than picking a side.** It publishes the
same eligibility contract twice — the prose above, and a machine-readable `x-required-capabilities`
extension — and the two do not agree:

```bash
grep -c 'x-required-capabilities' <spec-dir>/api.yml   # 7
grep -c '<Availability>'          <spec-dir>/api.yml   # 9
```

The difference is exactly `createDesignAutofillJob` and `getDesignAutofillJob`, whose prose requires a Canva
Enterprise organisation and which declare no capability at all. Both records are kept and neither is
preferred, which is [atlas-intent](../atlas-intent/04-corroboration.md) §4 applied to a disagreement INSIDE one surface.

**Three more gap conditions, each a fact about Canva rather than about this installation.** The description's
`tags` index declares `brands` — "Allow management of brands" — and **zero operations carry it**, so the
vendor advertises a product area and publishes no way to reach it. Two of the 18 declared OAuth scopes,
`collaboration:event` and `folder:permission:write`, are named by no operation at all, so the consent screen
a user is shown is strictly wider than what the published API can spend. And **the vendor's own descriptions
send the reader to the browser**: nine operations name the Canva UI, and two of them — `moveFolderItem` for
an item in several folders, `createDesignResizeJob` for in-place and section resizing — say outright that the
Connect API cannot do it. That is [atlas-intent](../atlas-intent/02-both-surfaces.md) §2's "both surfaces are mandatory because
they diverge", evidenced from the vendor's own bytes instead of asserted.

**No `summary` exists on any of the 59 operations, so the synopsis is derived and the rule is the
measurement.** Every operation declares a `description` and 25 of them OPEN with an MDX block, so the obvious
rule — take the first line — answers `<Warning>` for a third of the registry. `canvaSynopsisFor` takes the
first paragraph left once the blocks are removed, flattens markdown links to their words, and throws rather
than publishing an empty one.

**Two of three surfaces are `declared-unfilled`, and they are unfilled for DIFFERENT reasons.** MEASURED:
no `canva-*` entry exists under `$SLOPWEAVER_HOME/secrets` and 53 of the 59 operations declare
`oauthAuthCode`, so `connect-api` waits on an integration registered at canva.com/developers and its
authorisation-code grant — and even then, nine of those operations need an entitlement no token supplies.
`web-app` is the one unfilled surface in this build that waits on NOBODY:
`slopweaver browser cookies --origin https://www.canva.com` reports 21 cookies in the owner's own Chrome
profile, so a signed-in session already exists and what is missing is the walk itself. Saying "no session"
there — the way the Nightfall descriptor truthfully does for its console — would send a reader to perform a
sign-in that has already happened, which is why the two atlases carry different gap conditions rather than
one shared one.

**The publish gate is at the FILE boundary, and it guards the opposite thing to Nightfall's.**
`atlas/canva/store.ts` refuses a whole generation whose entities claim `connect-api` or `web-app`, because
this build fills neither — so a filled live channel could only come from a defect or a hand-edited file, and
a filled channel is what a reader trusts most. It cannot fire through today's sync, which is precisely why
it is not inside the sync: "this function happens not to make a request" is one refactor from being false.
The commit that lands a walk is the commit that relaxes the gate to admit its own.

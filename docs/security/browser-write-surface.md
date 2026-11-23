# The browser is a write surface, and is gated as one

Part of [Security & trust](../security.md).

A browser signed in as the operator **has no read-only mode.** In the `claude-in-chrome` tool set `screenshot`
and `type` are the same tool (`computer`), so a session that opens a provider's web client to look at
something is one missed click away from posting as the owner — which has happened: a search string aimed at
Slack's top-bar search box landed in the channel composer and was sent. That message
carried `client_msg_id` and no `bot_id`: no door, no send reservation, no form schema, no preview, and no
row in the send ledger, because nothing in this repository had been asked to produce it.

So **a provider that has a door is never reached through a hand-driven browser, for reads or for writes**
(doctrine rule 3), and Claude in Chrome is retired outright: the
`mcp__claude-in-chrome__.*` `PreToolUse` hook refuses every such call, with nothing that waives it
(`src/admit/chromeRetirement.ts`, `src/admit/browserDoorGuardRunner.ts`), and journals each refusal to
`$SLOPWEAVER_HOME/ledgers/browser-verdicts.jsonl` (`slopweaver browser verdicts`). A browser is driven only by
a `slopweaver browser` verb, through Playwright into the owner's own Chrome, and every action it takes is judged
against the live page's URL by `admitBrowserAction` (`src/browser/action.ts`) over the platform register in
`src/admit/browserSurface.ts`.

**The one break-glass names a page, and leaves a row.** `slopweaver browser break-glass --page <url> --reason
"<why>"` records a thirty-minute waiver against the session for that exact page, and only that lifts a page
rule on `browser act`. Nothing reopens a retired Claude in Chrome call.

Two things this is NOT. It is not a ban on browsers: a doorless surface — a dashboard, a logs or metrics
query, an atlas page — is untouched, and that is where the operator's own screenshot evidence overwhelmingly
lives. And it is not a ban on a Slopweaver verb reaching a page: rule 3's own words are that _a `slopweaver`
verb that drives a browser IS the door_, and such a verb drives the owner's own Chrome through Playwright over a
code-chosen page list, launching no browser of its own ([browser-route](../browser-route.md), [its brief](../browser-route/proof-and-capture-verbs.md#two-mechanisms-replaced-four-private-profile-lanes)).

**No write-capable action runs blind** — a type, a click, a fill, an upload runs only when it cites a look at
the live page in front of it (`actionNeedsObservation`, `src/browser/actionExecutor.ts`), and that look must be
of the URL the page is still on (`sessionObservationIsCurrent`, `src/browser/interactionSession.ts`).
That is the incident's own lesson kept: reading was never the risk, the inseparability of
reading and writing at the tool boundary was.

**A doored provider is in one of TWO categories, and moving it is one word.**
`refuse-every-write` refuses every write-capable action on its pages. `read-before-write` lets one through
when it cites a current look at the page, as above. Reads pass on both categories.

**All five doored providers — Vanta, Slack, GitHub, Linear and Notion — are `read-before-write`.**
`refuse-every-write` is uninhabited among doored providers and deliberately kept: the platforms left in it —
JumpCloud, Google Admin, CrowdStrike, Cloudflare — have no door, so this guard polices none of them, and the arm
is what makes the first of them to gain one a single word. **The residue this accepts, stated plainly:** the incident's own sequence —
screenshot the Slack page, then miss the click — is the shape `read-before-write` permits, so what still
stops it is the door rather than the category: the only browser a session may drive is a `slopweaver browser`
verb, and a hand-driven Claude in Chrome call is refused, reads included. `notion verify`'s screenshot half is reachable (`browser shot` photographs a
`read-before-write` provider); its page-script measurement has no verb, so its brief names that step
`no-verb-yet` (`src/cli/commands/notion/verifyRun.ts`). **An UNREGISTERED platform refuses every write, and no
platform may exist without a policy.** Everything above governs a platform the guard names. Asked what governed one
it did not, the honest answer would be nothing: a session could read an unregistered admin console and then take
a write-capable action on that tab, with no refusal and no door-ledger record. It must not be possible to have an atlas or an integration that is
undored: the right policy is enforced by default, and nothing may be added with no policy, because that brings in
undefined behavior. Two mechanisms carry it.
`UNREGISTERED_WRITE_POLICY` in `src/admit/browserSurface.ts` refuses every write on any host the register
does not name — reads still pass, which is the default for a new integration (read-only: only get requests, no
clicking or typing text into the page). And every atlas descriptor declares a
required `writePolicy` (`src/atlas/kit/contract.ts`), so an atlas that omits one fails to compile and fails
to parse, while `unit/admit/writePolicyRegister.test.ts` fails when a descriptor claims a policy the
register does not grant. The explicit write list is Slack, GitHub, Linear, Notion, Vanta and **Datadog** —
the organisation's SDLC metrics are a post to Datadog, so it is one where a write is legitimate.
Datadog's entry carries `door: null`, so its writes are
judged and its reads are not gated, because no verb replaces its console and a write ruling must not
silently revoke read access nobody discussed. **One thing is left open, for the owner to decide:**
a better name to distinguish an integration (read and write) from an atlas (read-only by construction).

**The fleet signs in to Datadog and GitHub itself.** This widens no policy above. The press set is three
buttons, closed: Datadog's "Sign in with Google", GitHub's organisation-SSO "Continue", and the Google chooser row
for the configured work account. Each is pressed as an ordinary `browser act`. The Google chooser still needs
its `break-glass --page` waiver, because `accounts.google.com` stays unregistered and refuses every write. A password,
passkey or second factor is never filled; it stays the owner's. Every other provider's sign-in stays the owner's under
least privilege. A card is refused unless a fresh look confirms an owner-only wall ([fleet sign-in](../browser-route/fleet-sign-in.md)).

`docs/browser-route/doored-provider-writes.md` § "Two categories of
doored provider" has the owner's words and the table; the logic is in `src/admit/browserSurface.ts`, and each provider's
`policy` field is on its own manifest, `browserWrite` in `src/integrations/<id>/integration.ts`.

# A Datadog or GitHub sign-in is the fleet's — owner ruling

Part of [the browser route](../browser-route.md).

The owner's ruling: the fleet clicks the buttons and does the sign-in itself, for Datadog and GitHub, those two
only. Every other provider's sign-in stays the owner's hand under [least privilege](../security/browser-write-surface.md) until the pain shows.

## The incident it answers

A seat on the experimental Datadog branch recorded a Queue question asking the owner to
sign in to Datadog in the work Chrome, and the asked-for PR stack stopped behind it. **No browser had been opened and
no session had been checked.** Its real blocker was the Google application-default credential the stack boots
on, already carded to the owner hours earlier, relabelled as a Datadog sign-in. When anything did look, the console read
signed in. The owner's answer — wait for the sign-in — was a ruling on a question that
should never have reached the owner.

## The look, and what it may press

```bash
slopweaver browser sign-in --provider datadog
slopweaver browser sign-in --provider github [--org <slug>]   # org defaults to the repository owner
```

Signed in is judged by the detectors already measured, never a new guess. For Datadog it is where the console
address settles (`isDatadogSignInWall`). For GitHub it is the organisation grant read off the owner's Chrome's own cookies
(`readOrgGrant`, the read `github attach status --org` makes). A personal-account owner has no organisation page, so
GitHub answers `/orgs/<login>` with 404. On exactly that answer `readOwnerGrant` reads `github.com/<login>` instead
and judges only its signed-in marker, because there is no SAML grant to read. A signed-in look closes its tab and exits 0.

A wall stays open in its session and exits 3. `src/browser/signInPress.ts` judges the landed page against a CLOSED
press set:

| Page                        | The fleet presses                          |
| --------------------------- | ------------------------------------------ |
| a Datadog login page        | "Sign in with Google"                      |
| `github.com/orgs/<org>/sso` | "Continue"                                 |
| Google's account chooser    | the row naming the configured work account |

None of the three submits a field. A password box beside one does not stop the press: Datadog's login page carries
both. Only the chooser path counts on Google. A challenge page names the owner's account too, on the chip that
switches it, and that chip is never pressed. Everything else is the owner's hands:

- a password, passkey or second-factor field with nothing from the set beside it;
- a chooser not listing the owner's work account;
- a Datadog login the Google press already bounced off (`google_invalid_email` in its address: Datadog has no account
  for the Google user Chrome sent), Google button and all;
- GitHub's own login;
- a page never seen.

The verb prints the exact
`browser act --session … --target <ref> --observation …` to fire. On Google's chooser it first prints the
`browser break-glass --page <url>` line, because `accounts.google.com` is unregistered and refuses every write
([the default](./doored-provider-writes.md#and-then-the-default-was-ruled)).
The press is an ordinary `act`, with its aim pictures and its read-only rail. The look after it is printed too, and
it goes THROUGH the pressed tab:

```bash
slopweaver browser sign-in --provider github --session <id>   # judge where the pressed tab is NOW
```

A fresh tab on the wall's address would show the button just pressed: measured, re-looking at the wall URL
can repeatedly return a `pressable` row after the pressed tab has already advanced to the organisation's
access login, so the card asking the owner for that step was refused every time. The session-aware look
follows the pressed tab: that login is a page off the press set and reads as needing the owner's hands (the non-`pressable` arm of `WallVerdict`,
`src/browser/signInPress.ts`), its tab left open for the owner. A session opened on another provider's page is refused,
so no unrelated tab stands behind a card. A signed-in re-look closes the session.

## The card gate

Every look appends a row to `$SLOPWEAVER_HOME/ledgers/sign-in-probes.jsonl`: provider, verdict, the page (origin
and path only) and why. `src/handover/fleetSignInGate.ts` reads it at every door a card the owner reads comes through:
`hand post`, `handover ask`, `correct`, the reshape, `offer`, `reconfirm` and `register`. It reads every field the card draws: a step's
`unblocks`, `if-ignored`, `witness` and details, and an ask's shape and example scenes. A card whose text makes Datadog or GitHub the
OBJECT of a sign-in passes only when that provider's newest look needs the owner's hands and is under 30 minutes old. Any other
case refuses with the four-line hatch refusal and names the look to take:

- no look;
- a stale look;
- a `signed-in` look, which means the blocker is something else;
- a `pressable` look, which means press it.

The hatch is `SLOPWEAVER_ALLOW_FLEET_SIGN_IN_CARD`.
"Sign in to Google Cloud … so the Datadog stack boots" names a Google credential and passes.

## A scheduled resync's wall

The `resync-signed-out` monitor raises a card from a page rather than from prose, so it reads the same look:
`fleetSignInHold` (`src/monitor/resyncSignedOut.ts`) HOLDS a Datadog or GitHub wall's card until a fresh look reached
the owner's hands. `automation seat` reads the same rule and SEATS that row rather than waiting on a card that will never
post, and `automation resync`'s deferred line tells the seated session to run `browser sign-in` and press
([resync-signed-out](../../skills/monitor/reference/resync-signed-out.md)).

## Not covered yet

- **The press is the seat's, not a loop.** No verb presses through by itself yet. That would need a Google page on
  the register and a click that may leave the page it was aimed at; both are deliberate rails, so stepping them is
  its own change, built against real wall snapshots.
- **A press that does not move the page reads `pressable` again.** The re-look judges the page honestly; it does
  not know a press was made, so a button that reloads its own page keeps the card refused until a look moves on.
- **A wall the press cannot clear re-seats.** A resync that walls again after a `pressable` or `signed-in` look is
  seated on the next pass, not cooled; only a look needing the owner's hands turns it into the owner's card.
- **`github attach`'s block is the `needs-owner-login` alert.** Its line names the press first, but the
  event keeps its name and its alert severity on the supervisor stream; a card built from it meets the gate.
- **The gate is a phrase tripwire, never a parser.** A sign-in sentence naming the provider some other way gets
  past it.
- **The run's title and summary are not read.** A run ABOUT a sign-in wall is named for one, and reading either
  would refuse every ask it makes; they name the work, the question and its shape carry the ask. `planSignInExit`
  draws the same line.
- **Gold on a real wall is OWED.** The signed-in path is proven live; no walled page has been met live.

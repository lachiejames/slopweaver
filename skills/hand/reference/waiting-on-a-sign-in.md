# Waiting on a sign-in: the command runs in the owner's terminal, the seat waits on the credential

A review seat once ran `gcloud auth application-default login` itself, then stopped. The command opens a browser
tab AND a localhost redirect listener in the shell that ran it; when the owner later signed in, the redirect landed
on a broken page because that shell had moved on. So the fleet waits on the owner longer, and a floating note
carries the one command to copy.

So a sign-in that starts a listener belongs in the OWNER's terminal, where the listener lives as long as the owner needs it, and
the seat never runs it. The admit hook refuses the application-default login in any session
(`src/admit/adcSigninCommand.ts`, hatch `SLOPWEAVER_ALLOW_ADC_SIGNIN`, which `SLOPWEAVER_ALLOW_RAW` does not open).

## The seat

```bash
slopweaver google adc --row <slug>
```

It reads the credential through the Google SDK, never `gcloud`, and prints one line:

- `valid` exits 0: carry on.
- A failure a sign-in cannot fix (a `GOOGLE_APPLICATION_CREDENTIALS` file, a network fault) exits 1 and says so.
  No note: a sign-in would not help.
- `absent` or `reauth` (`invalid_rapt`, the Workspace session-control re-ask) prints the ONE `hand post` line,
  and says who posts it. The pinned supervisor posts it itself. A seat sends it to the supervisor with
  `SendMessage` and nothing else about the sign-in. Then it exits 3.

If the owner's note for that sign-in is already up, the verb says so and prints no second line.

Then wait in the BACKGROUND, bounded, and let its completion resume the seat:

```bash
slopweaver google adc --row <slug> --wait --timeout-seconds 28800
```

It re-reads only when the credential file changed, or once a minute. It prints `WAIT-DONE google adc valid` plus
the `hand done` line that settles the owner's note, or `WAIT-TIMEOUT` (exit 4). A timeout means run the same wait again,
never send another line.

## The chair

Post the line exactly as sent. `hand post` holds it to the same form as any step: `--literal` plus `--where`,
`--row`, `--unblocks` and `--witness`. The literal carries `CLOUDSDK_CONFIG=<dir>` when the seat's gcloud config
is not the default one, so the owner's sign-in writes the file the seat reads. A row already carrying a DIFFERENT open card
is refused `ROW_ALREADY_OPEN`, one card per row ([row and re-cut](row-and-recut.md)): the chair decides whether the
sign-in re-cuts that card with `--supersedes` or waits behind it.

## The owner

The owner copies the literal into a plain terminal, not a Claude session, and picks the owner's work Google account. The seat's
background wait sees the new file, reads a token, and settles the note.

## A plan sign-in names the plan's email address

Name the email address of the plan, because otherwise the owner has to guess when the fleet says
Plan 3 or Plan 4. So a note or a queue question asking the owner to sign into a Claude or Codex plan carries the address
`slopweaver plans list` (or `claude gauge`) pairs with the alias — `claude-five@slopweaver.ai`, not `plan-five` alone.

Enforced, not remembered: `src/hand/planSignIn.ts` judges a note's `what` and `where` together, and the hand
register's append refuses one that names a registered alias without its cached address, or reads as a Claude or
Codex plan sign-in naming no plan by address. `handover ask` and `correct` refuse the same over a question and its
shape (`src/handover/planSignInGate.ts`, hatch `SLOPWEAVER_ALLOW_PLAN_SIGN_IN_WITHOUT_EMAIL`). The
`codex-plan-signed-out` and `claude-plan-unusable` cards lead on the address. An alias whose row caches no address asks for nothing.

## Any other browser sign-in: the fleet opens the window, the owner only signs in

The sign-in itself, in the already opened browser, is the only thing the owner has to do. A seat that hands the
owner `yarn nx run …:backtest-shot -- --login` to paste so it opens a Datadog window has made the paste the
owner's errand when it is the fleet's.

So a sign-in whose command the fleet CAN run — a capture's `--login`, the work-Chrome pin on a page — is run by the
seat, in the BACKGROUND when it waits on the owner, and the note says only what is left:

```bash
slopweaver hand post --id <id> --what "Sign in to Trelica in the work Chrome window that just opened" \
  --opened https://app.trelica.com/ --where "Your work Chrome window on the Trelica sign-in page" …
```

`--opened` names the page already on the owner's screen and needs `--where`; it draws no Open button, because a button
opens the owner's default browser, maybe the personal profile. The register refuses a `--literal` command the fleet could
run (`src/hand/runnableLiteral.ts`), naming the segment. A command posts only when every segment needs the owner's hands —
the owner's secret, password or approval, a grant only the owner's account holds, or a listener that must live in the owner's own
terminal, the application-default login above among them — and that list is `OWNER_HANDS_COMMANDS`, a register
row per command, never a hatch.

A scheduled resync's sign-in wall is this shape with no seat at all: the `resync-signed-out` monitor, fired every
`tick open`, opens the platform's page in the owner's work Chrome through the pin and THEN raises one card per origin
saying sign in in the window that opened. The owner signs in there and presses Done; the seat holds the row unseated until
then and seats it the pass after ([resync-signed-out](../../monitor/reference/resync-signed-out.md)).

## Datadog and GitHub: the fleet signs in, the owner is never carded first

The fleet can always click the buttons and do the sign-in, for Datadog and for GitHub. A wall on either is the seat's to
press, so the asked-for work does not halt on it:

```bash
slopweaver browser sign-in --provider datadog|github
```

The command exits 0 when the provider is signed in. That means whatever is blocking is NOT this sign-in, so go find
what it is. It exits 3 on a wall, with the one button to press as a `browser act` line, or the step that is the owner's. After the press,
look again with the printed `--session <id>`: a fresh look shows the button just pressed, never the identity
provider's login it led to, so only the session's look can stand behind the owner's card.
Every door a card comes through refuses a Datadog or GitHub sign-in card unless that look reached the owner's hands within
30 minutes ([fleet sign-in](../../../docs/browser-route/fleet-sign-in.md)).

## Not covered yet

Plain `gcloud auth login` (the CLI's own credential, not the application default; `--update-adc` IS refused) starts
the same listener and is not yet refused. The walk is a tripwire for the natural spellings, never a shell: an alias,
a function, `eval`, a variable or a script's own text goes past it.

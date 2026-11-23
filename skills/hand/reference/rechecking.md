# A step whose condition already holds leaves on the next tick

An owner who opens a sign-in card and lands straight on the dashboard should never have seen that card: when the
supervisor ticks, any queue card asking for a sign-in, or something that needs the owner's hand, is cleared if its
condition is met. The caution that goes with it: never probe a provider's UI in a way that risks a bot lockout.

## What it reads, and why that is safe

`hand recheck` takes each open step's PRECONDITION and reads it once per pass, however many steps share it:

| Kind              | The read                                                                                                                                                         | Met when                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-session` | ONE visit of the platform's bare origin through the relay every atlas walk attaches by — the owner's work Chrome, the same lease — never a click or a screenshot | it answers below HTTP 400, settles on the origin it asked for or a declared signed-in landing, and is not the platform's own sign-in page |
| `slack-member`    | `conversations.members` under the owner's own Slack token, through the door                                                                                      | the owner's recorded user id is a member                                                                                                  |

The visit is the first navigation that platform's own scheduled walk makes on every run, judged by that atlas's own
sign-in test (`src/hand/sessionProbes.ts`: Clerk, Xero, Hex, Trelica). So a recheck adds no new kind of traffic to
a provider. **Signed in is positive evidence, never the absence of a wall**: a Clerk sign-in step was once posted on a
navigation ETIMEDOUT, so a visit that fails is `unread`, the step stays, and the next tick reads again. The relay
lease wait is 20s, inside the tick reading's 120s budget; a busy relay is `unread` too.

**A row declares where a signed-in visit lands.** Signed in under an employee-only role, Xero sends `go.xero.com/` on to `payroll.xero.com`, so
its row visits on its walk's own lease (`src/atlas/xero/walkLease.ts`, the sign-in origin included) and names payroll
as a signed-in landing. Without that declaration, every pass failed `OFF_LEASE_ORIGIN` on that redirect and read
`unread`, and the step was settled by hand after the owner had signed in.

## Which steps carry one

- **Named**: `hand post --recheck browser-session:<https origin>` or `--recheck slack-member:<channel id>`. A
  browser origin no row in `src/hand/sessionProbes.ts` reads is refused at post: a recheck nobody can run is a claim.
- **Derived**: a step that waits on the owner (not a check-in, not a notice), whose act opens "Sign in" and joins no
  second act ("… and approve the SSO change" is never retired by a session read), with no literal or checklist, and whose
  `--opened` window, else `--url`, is an origin a row reads. That covers every `mon-signin-*` card the
  [resync-signed-out](../../monitor/reference/resync-signed-out.md) monitor posts, and every row written before the
  field existed.
- **Neither**: gcloud, plan and Docker sign-ins have no row — nothing settles them by a read the fleet already
  makes — and the pass counts them as naming no precondition.

## What a retirement writes

One lock-held settling per met step, `did` reading `retired by recheck — already met: <what the read saw> at <iso>,
no hand touched it`, so nothing takes it for the owner's Done; its note closes. A step settled by another writer under the
lock is skipped. `--dry-run` reads and writes nothing.

## Where it runs

The supervisor tick's `hand-recheck` reading, immediately BEFORE `sign-in-walls`, so a `mon-signin-*` card it
settles is HELD by that monitor rather than re-posted, and the seat re-seats the stopped resync. `tick open` prints
`hand recheck: <n> retired, …` and one line per retired or unread step by id. Exit 3 is the quiet answer: no open
step names a precondition.

```bash
slopweaver hand recheck --dry-run --json   # {"retired":[{"id","because"}],"unmet":[…],"unread":[…],"unchecked":<n>,…}
```

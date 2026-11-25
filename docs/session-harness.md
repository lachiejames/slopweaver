# The session harness

The seam every verb that reaches a running agent session goes through, so the thing hosting that session
can change without any verb changing. Two implementations stand behind it: cmux, the default, and the desktop
app (`--harness app`), which hosts Claude and Codex sessions.

## Why it exists

The chosen design is option C from the off-cmux briefing: a session harness per session,
plus a control plane that picks plans and runs the chair hand-off. The first step is this seam with cmux
behind it, so nothing changes for the fleet while the verbs stop knowing what cmux is. Its Recovery step, `slopweaver fleet recover`, opens one throwaway app session per vendor through this seam to prove each can still start one, with no cmux connection: [the Recovery check](../skills/fleet/reference/recovery-check.md).

## The contract

`src/sessionHarness/sessionHarness.ts` declares `SessionHarness`. Six operations, each answering a
`Result` over `SessionHarnessError` (`src/sessionHarness/errors.ts`):

| Operation   | What it does                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `list`      | Every live session, in the host's own order                                                                              |
| `resolve`   | A handle (a cmux ref or id today) to one session, carrying an optional endpoint (a cmux surface)                         |
| `message`   | Deliver a line with a `delivery` of `now` (interrupt a running turn first), `turn` (submit, queue behind one) or `later` |
| `interrupt` | Stop the running turn, without waiting for it to land                                                                    |
| `close`     | Close the session, forcing only past a proven-idle prompt; a close it will not force is `held` with its reason           |
| `park`      | Re-resolve the session by id and close it: `force` when the caller settled it, `bounded` like `close` otherwise          |

Launching is its own interface, `SessionLauncher` (`src/sessionHarness/launch.ts`), because it needs effects
the other operations never do (a worktree, the credential gate, a boot witness): `open` starts a run's first
session, `resume` a fresh one for a run already under way. Both open a new visible session and send it one
initial message; they stay two calls because the ledger records which act opened the session. A cmux `resume`
never continues a vendor transcript in place; an app `resume` does, whenever the slug still holds an open app row
([resuming an app session](#resuming-an-app-session)).

## The ledger row: one writer

The control plane's skeleton is one row per session in the session ledger
(`$SLOPWEAVER_HOME/sessions/sessions.jsonl`), written by ONE recorder from what the seam did:
`recordingSessionLauncher` and `recordingSessionHarness` (`src/sessionHarness/recordingHarness.ts`) wrap any
implementation, so a second harness behind the seam feeds the same writer. The JSONL ledger rather than the
store, because the store refuses on an outage and a ledger write must never stop a session opening or parking.

- A launch writes a `spawned` event keyed for life by the harness's `sessionId`, with `openedBy` (`open` or
  `resume`) and `harness` (`cmux` or `app`). A failed launch that left its session holding the initial message is
  recorded too; any other failed launch leaves no row. A launch that continued the session an open row records
  writes `resumed` naming that `sessionId` instead, which reopens the same row rather than adding one.
- A park writes the row's `closed` event naming that `sessionId`: BEFORE the park for the caller's own session,
  which does not outlive it, and only after a park that went through for any other, so a held or failed park
  never reads closed.
- **A ledger write never changes the act.** A failed append is one warning naming what the ledger lost, and so
  is a ledger present but unreadable at a park, which is never read as one tracking no row.

`foldSessions` closes a row by `sessionId` first, which survives a cmux restart renumbering refs, and falls back
to the ref only for a row that recorded no id. The `session-harness-lifecycle` gate refuses, outside
`src/sessionHarness/`, a `spawnCmuxSession` call or the function handed on as a value, a hand-appended `spawned` row, and a cmux client constructed
(`withCmuxClient`, `realCmuxClient`, `cmuxClientOver`; `src/cmux/client.ts`, which defines them, excepted). Its
debt list is empty. A session booted in two halves, the turn lane's worker and reviewer and a witness worker,
writes its row through the same recorder (`recordBootedSession`), since no launcher ran to write it; every
witness close parks through `recordingSessionHarness` (`src/live/witness/close.ts`), forced for the worker's own
seat and bounded otherwise, so no witness row is left open by a raw close. Both drawdown investigations open
through `openRecordedCmuxSession` (`src/sessionHarness/recordedSpawn.ts`).

**A delivery the host cannot honour is refused, never degraded.** cmux has no way to hold a line until the
running turn ends, so `later` answers `DELIVERY_UNSUPPORTED` before anything touches the session, and says
nothing was sent. The app holds `later` but cannot yet land a line between a running turn's tool calls, so it
refuses `turn` on a running session the same way; on an idle or starting one every delivery is the same act.

What stays in the verb, not the seam: the pinned-supervisor refusal, relay staging for a long send, and the
worktree residue reap after a close. Those are Slopweaver policy over a session, not a property of the host.

## The cmux implementation

`cmuxSessionHarnessOver` (`src/sessionHarness/cmuxHarness.ts`) wraps one open `CmuxClient`, and
`withSessionHarness`, beside it, opens and closes it around a body. It reuses what was already measured:
`reachSession` for delivery and the composer read-back ([§ 5b](cmux-client/spawn-witness-chain.md)),
`closeWorkspaceWithBoundedForce` for the close and a bounded park. A cmux failure keeps its message verbatim;
its `code` becomes `SESSION_NOT_FOUND`, `HARNESS_UNAVAILABLE` or `HARNESS_OPERATION_FAILED`, with the cmux code
kept as `causeCode`.

`cmuxSessionLauncherOver` (`src/sessionHarness/cmuxLaunch.ts`) runs the existing `spawnCmuxSession` unchanged
for both launch acts — credential gate, worktree, browser door, boot witness, pickup delivery — and translates
both ways, so `cmux spawn`'s output and left-open report are byte-identical through the seam. Which act a spawn
is comes from the run journal by the same phase that picks the pickup line's `start` versus `resume`
(`launchOperationForRun`, `src/cmux/pickupCommand.ts`). The line is re-read just before it is sent and carries
the act that read decided (`ResolvedInitialMessage`), and the recorder writes that act over the one called, so a
journal that moved during a capacity wait or the boot cannot leave the row and the line disagreeing.

`slopweaver cmux list --json` is byte-identical through the seam: `cmuxWorkspaceFromSession` rebuilds the row in the order readers key on.

## The app implementation

`--harness app` on `cmux spawn`, `list`, `send`, `stop`, `close`, `usage` and `picture` (`--delivery now|turn|later` on `send`)
points the verb at the desktop app's control plane, never at cmux as a fallback: an app that is not serving
is `HARNESS_UNAVAILABLE` naming the app (`src/sessionHarness/harnessChoice.ts`). `picture` reads what one session has
DONE, never its words or a tool's input, output or title: [the facts picture](session-harness/facts-picture.md).

- **The wire.** One owner-only Unix socket, `/tmp/slopweaver-<uid>/session-harness-v2.sock` (directory `0700`,
  socket `0600`, the directory checked as a real one however its path is spelled, and nothing served until the
  socket is `0600`), one JSON line each way. The boundary is another
  local user: an ACL the owner's own uid put on its own directory is out of scope, since nobody else can. `desktop/src/sessionControlProtocol.ts` is the protocol and
  `src/sessionHarness/appProtocol.ts` its byte-for-byte copy, because neither tree imports the other; its four siblings,
  `wireBasics.ts` (vendor, state, shape checks), `usageWire.ts` and `pictureWire.ts` (what a `usage` and a `picture` answer carry) and `credentialRouteWire.ts`
  (a Claude login's route) keep one name in both trees, and a mirror test holds every pair equal. The CLI half is `appSocketTransport.ts`, `appHarness.ts` and `appLaunch.ts`.
- **Rule 2, as an order.** `launch.prepare` opens the session's card window (JavaScript off, a Stop link), and
  only a card that is visible, loaded and showing THIS session mints the lease the worker is started from
  (`desktop/src/visibleSessionLease.ts`). The card's Stop closes through `cmux close --harness app`, under the
  state home the spawn recorded the row in (always passed, absolute, even when the spawn's came from its environment), so the ledger records it, and stops the session locally if that verb fails.
  The card catches its Stop link on `did-start-navigation` as well as `will-navigate`: Electron never raises
  `will-navigate` for a `slopweaver-session:` link, since nothing serves that scheme. Only the exact link the card
  draws counts, never an escaped spelling of the same id.
  `cmux close <handle> --harness app --via-card` presses that same Stop the way the owner would: the app clicks
  the control where the card pins it (`STOP_CONTROL_BOX`, `desktop/src/sessionCard.ts`) through the page's
  DevTools input domain, because `sendInputEvent` reaches only a focused window and a background app cannot focus
  its own. It sends the click only when the element at that point is the card's own Stop link, and answers only
  once the card's handler saw a click after that and the card's stop finished (`stop.press`). A card has one stop,
  so a press on a card whose stop already started is refused, and a click the card has not seen within 5s is
  refused, naming the element it hit and the navigations the card raised. One click starts one stop even when
  Electron reports it twice. An owner click in the moment between a press beginning and its click is the one case
  a press reports a stop it did not start; the session stops either way. A Stop pressed while another close is already
  stopping the session answers once that stop settles, never at once: a session has one stop at a time, and a close
  arriving while it runs is handed that same stop. That logic is `desktop/src/cardStop.ts`, with no
  Electron in it. The verb waits 120s, over the app's 100s worst case. A cmux workspace has no card, so it refuses.
  Every change the card shows is a whole-page reload, and a click landing during one is lost: 6 of 6 presses on
  streaming seats missed. So `desktop/src/sessionCardRedraw.ts` reloads streamed agent text at most once per 500ms
  after any reload, the newest always drawn last, and a state or note change at once. Both vendors' card Stops then
  landed mid-turn on the installed app. Loads never overlap, and nothing reloads while a
  press is landing. That hold runs from before a `--via-card` click until it is seen or given up on, and from a left
  mouse press on the Stop until its link is followed or 1.5s pass. It ends long before the stop it starts. A hold
  cannot stop a reload already under way, so a mouse press whose page changed before its release is pressed again
  through the `--via-card` click. A failed reload is tried once more and never counts as shown.
- **One worker per session**, picked by the spec's `vendor` (`desktop/src/workerLaunchOf.ts`). Electron run as
  Node, detached as its own process group, speaking IPC to the app; the card names the vendor beside the state.
  - **Codex**: one Agent Client Protocol connection to the pinned `codex-acp` adapter, which runs the native
    `codex` the app ships in `Resources/session-harness/`. The seat's routed `CODEX_HOME` is set and every API
    credential and `NODE_OPTIONS` dropped (`codexEnvironmentPolicy.ts`, the CLI client's own list), at the
    worker's launch and again at the adapter's.
  - **Claude**: one Agent SDK `query` (`claudeAgentWorker.ts`) over the native `claude` the app ships in
    `Resources/session-harness/claude/`, the worker starting that process itself so it can check the SDK's request
    against the launch and attach a setup token on descriptor 3, never in an environment or argument
    (`claudeProcessLaunch.ts`). Every setting source loads, so hooks, skills and rules run as in a cmux seat; the
    flag tier blanks `apiKeyHelper` and carries the seat template's rule exclusions, and no permission prompt is
    answered (`claudeSdkOptions.ts`). The plan's credential store is routed, the inherited `ANTHROPIC_` and `CLAUDE`
    namespaces are dropped whole bar `CLAUDE_CONFIG_DIR`, and the flag tier's `env` blanks every credential,
    auth header, provider switch and model endpoint the binary reads, since a settings file's `env` lands after any
    spawn scrub; any other variable a settings file sets applies as in a cmux seat
    (`claudeEnvironmentPolicy.ts`, held to `appCredentialContext.ts` by a test), and a session
    that opens on a metered key source or reports no subscription fails before it reports ready
    (`claudeMessages.ts`).

  A close ends the whole group, so does a worker dying or reporting a failure on its own, and a quit
  blocks until every group not yet proven gone has ended, SIGKILL after a 5s grace and a bounded wait for the kernel to
  reap it. A group the kernel will not reap ends its session failed, refuses the close so no `closed` row is written,
  and stays listed for the quit.

- **The recovery journal** is the app's own record of what a later run needs to resume a session it hosted:
  `session-harness.jsonl` in the app's data directory, `0600`, each row written whole and `fsync`ed before the app
  acts on it, and started on a line of its own after a torn write (`desktop/src/sessionRecoveryStore.ts`). That
  survives the app or a process of it being killed, never a power cut: macOS's `fsync` leaves the drive's cache
  unflushed, and `F_FULLFSYNC` is out of Node's reach. It is recovery state, never the session ledger, which keeps its one
  writer. A launch writes `group-started` (the worker's process group and the executables a process in it may run)
  as soon as the worker runs, and `opened` (the vendor's own transcript id and the launch spec, paths only: a Claude credential route is recorded as its store directory and, for a
  setup token, the token FILE's path, never the token, so a resume relaunches on the same route) before
  the launch is answered; a row that cannot be written fails the launch. Codex reports the thread id `session/new`
  returned. A Claude transcript's id is minted by the app and handed to the SDK, and a session streaming any other
  id fails. `closed` means somebody asked the session to end and it did, so a later run never resumes a session the
  owner stopped: it is written once a stop somebody asked for (a crash on the way out included, and a Stop pressed
  while a crash's cleanup is underway joins that stop and asks for it), begun while the
  session held its group, has proven that group gone. A quit, a crash or a worker's own failure report nobody asked to
  stop, a launch refused on its own failure, or a close racing a launch that holds no group yet leaves a session the
  journal does not call closed; a Stop pressed on a launch that holds its group is asked for, closes it, and refuses the launch.
  A stop whose closed row cannot be written ends its card failed and its `close` or `launch.abort` refused, since a later run would
  resume it, and the row stays owed until a later close of the session writes it. A group a crash's cleanup proved gone is
  owed the same way, so a Stop or close the owner asks for afterwards still journals the session closed
  (`desktop/src/launchRecording.ts` holds these rules and the launch's order). Each row decodes only as
  strict UTF-8, byte for byte as the app writes it (so a duplicated key or a byte-order mark is no row), in its exact shape, and a line
  that decodes to none, a torn last write included, is numbered rather than skipped
  (`desktop/src/sessionRecoveryRecord.ts`).

- **Delivery** is the control plane's pure reducer (`desktop/src/sessionRegistry.ts`): `now` cancels the running
  turn and lands at its end, `later` waits for the end, and a message to a starting session waits for ready. Only a
  starting session is released by ready and only a running one by a turn's end, so a repeated report releases nothing.
- **Launch** is three acts: prepare, resolve the pickup line, then `launch.deliver` — or `launch.abort` when the
  resolve fails. A Claude launch passes cmux's credential gate first, judged against the environment the app's
  worker really gets, and the app refuses one no plan routed a store for (`src/sessionHarness/appLaunchSpec.ts`).
  Before a Codex prepare, the worktree is made and the browser door read on it with cmux's own
  spawn effects, through the Codex binary the app names in its `pong` (the one its sessions run, never PATH's), so
  an app seat is refused on rule 3 exactly where a cmux one is. `launch.prepare` names the run of the app (the `pong`'s
  `instanceId`) whose binary was judged, and any other run refuses it (`desktop/src/judgedApp.ts`), since each
  request is its own connection and a reinstall or relaunch could hold the socket by then. The seat boots on the
  repository's Codex model (`CODEX_MODEL`), never the Claude tier `--model` names; and its adapter carries the
  same browser-off overrides a cmux boot line's `-c` flags do (`desktop/src/sessionWorker/codexBrowserOff.ts`,
  held to `src/codex/browserSurface.ts` by a test), since the door judges the server list as if they applied. Boot and delivery evidence is the app's own report (witness `event`). A launch token acts only
  once prepare has answered with it, and a launch nothing settles within 120s (a lost abort, a spawning CLI that
  died) is ended by the app itself.

The app serves the socket only as the owner's installed app, never a test instance, so the app harness is
proven on the installed app.

### Resuming an app session

`cmux spawn --harness app` looks for the newest OPEN app row for its slug, kept under the slug as its key, since
the `resumed` event is written there (`openAppSessionForSlug`, `src/sessions/sessionRow.ts`), once, before any
plan is routed (`src/sessionHarness/appContinuation.ts`). A row stays open only when nothing proved the session
closed, a quit or a killed app, so that row is the session worth continuing, and it decides the act whatever the
run journal's phase: a seat whose pickup was delivered but whose `handover start` never journalled `started` is
still resumed, not opened afresh beside its own transcript. The pickup line stays the journal's, so such a seat is
sent `handover start` again. With a row, the launcher sends `launch.resume` naming its id instead of
`launch.prepare`; with none, it opens a fresh card as before. An app answering with any other session is sent
`launch.abort`, and the launch fails.

**A Codex resume keeps the plan it opened on.** Before routing, the CLI asks the app for the session's recorded
spec (`launch.inspect`, answered `launch-spec` from the recovery journal's `opened` row by
`desktop/src/sessionRecordedSpec.ts`) and seats on its `codexHome`, never a newly ranked one, saying so. A `--plan`
naming another plan refuses. When the recorded plan cannot take the seat now (unregistered, paused, signed out, or
refused by the usage preflight), the spawn names the old home and the reason, routes afresh and opens a FRESH
session, leaving the old row open: an unavailable plan does not prove the session gone. An unreachable app, a
refused inspection or a malformed answer fails the spawn; it never falls back to fresh.

**A dead session's row is closed by `cmux close`.** When the app answers `SESSION_NOT_FOUND` and the operand names
exactly one open app row, `cmux close app:<id> --harness app` writes its `closed` event and prints `cmux close:
app:<id> is already gone; closed its ledger row` (`src/sessionHarness/absentAppClose.ts`). Every other failure
keeps its error; nothing selects by slug or by newest.

**A Codex seat's row records the model it boots**, the repository's Codex pin, never the Claude tier passed on
`--model` (`bootModelForLaunch`, `src/sessionHarness/recordingHarness.ts`); a respawn or reseat reading a pin that
names no Claude tier never hands it to `claude --model`.

**A lock taken inside Codex's sandbox carries a guardian.** Codex's seatbelt refuses to exec `/bin/ps`, so a verb
there cannot read its own start stamp and every never-stale lease (`handover start`'s among them) was refused. The
app's unsandboxed Codex worker hands its own exact `{ pid, start }` down as `SLOPWEAVER_SESSION_GUARDIAN_PID` and
`SLOPWEAVER_SESSION_GUARDIAN_START` (`desktop/src/sessionWorker/processGuardian.ts`); a lock record with no stamp
of its own carries it (`src/admit/processGuardian.ts`) and is never aged out. While the guardian is the same
process, a live holder is contention; once it is gone or its pid is another process's, a holder pid that still
answers is `LOCK_REFUSED`, since nothing tells the writer from a process that inherited its pid
(`src/admit/operationLockHeld.ts`). A pid the kernel no longer answers for is stale whatever it carries, so a
recycled holder pid costs a wedged lock until it exits or its record is removed, never a second writer.

The app decides from its own recovery journal, never the CLI's word (`desktop/src/sessionResume.ts`, effects in
`sessionResumeShell.ts`). It refuses a session this run of the app hosts in any state (a close journals only a hosted session, so
one hosted nowhere here cannot be journalled closed while it resumes), one with no `opened` row, one journalled
`closed`, a journal with an unreadable line, and a spec that changed the vendor, directory, ledger home, Codex home
or credential route, and a second resume of a session whose first is still checking or starting. Before the new
worker starts, each recorded process group still listed is ended when every process in it runs an executable the
row named and its leader started no later than the row (`ps` read under `TZ=UTC`, to the second), and refused,
untouched, when any does not, judged on a process table read again before SIGTERM and before SIGKILL. That second
read also refuses a process the first did not see, by pid and start time, since the group id may have gone to
another process in between. Every session of the app runs the same executables, so a `group-started` row of ANY
session naming an id retires every earlier row for it: the kernel reissues a pid only once no group holds it, so
another session's later worker is never read as an earlier session's leftover. A process could still exec something else between that read and the signal: POSIX has no atomic
check-and-signal for a group, so that gap is narrowed, never closed. A group read gone is journalled `group-ended`
before the next is looked at, retiring every earlier `group-started` row for that id, so a resume retried after a
later failure, or a later run, never signals it again; a resume that cannot write that row is refused, and the group
stays remembered gone for the rest of that run of the app, so only a later run can lose a row that was never written. The new worker then
continues the recorded transcript: Claude through the Agent SDK's `resume`, Codex through ACP `session/resume`. A
Codex session answering any other thread id fails before the launch is answered. The Claude SDK names its
transcript only once a turn streams, so a Claude session streaming any other id fails on that first message, as a
fresh launch's does. The card, the lease and the initial message are
exactly a new launch's, under the same app session id, and the CLI records `resumed` on the row.

### Reading an app session's usage

`cmux usage --harness app [--json]` asks the app `usage.read` and prints, for each session this run of the app
hosted (closed and failed ones included), the model asked for against the one the vendor named, the models each
turn was charged to, its tokens in that vendor's own categories, and tokens per hour since its first ready. An app
from before this refuses `usage.read` as `BAD_REQUEST`, which the verb reports as an app to update.

- **Spend lands at a turn's END**, so a session mid-turn has not counted that turn: poll until idle. Each worker
  sends its turn's OWN tokens ahead of `turn-ended`, over ordered IPC, so the registry counts it before it releases
  the next turn (`desktop/src/sessionUsage.ts`). Claude's comes from the SDK result's cumulative per-model count,
  differenced against the previous result's, so subagent and compaction calls are in it; Codex's from the prompt
  response's `_meta.quota`, read strictly against the pinned adapter's shape
  (`desktop/src/sessionWorker/claudeUsage.ts`, `codexUsage.ts`).
- **A floor says so.** A turn that ends, fails or is cut off with no readable report is MISSING, never zero. A
  Claude turn with no baseline to difference from (the first after a resume, after a `conversation_reset`, or after
  a cumulative count that went backwards) is counted from the main loop alone and is PARTIAL. A total with either
  behind it prints as a floor, as does one read while a turn is under way, and a missing fact prints `unknown` or
  `not-reported`. A report that lands after its session went (a stop racing the worker's last send) takes that turn's
  missing count over, so the turn is still counted once.
- **Codex's `usage_update` is context occupancy**, how full the window is, kept beside spend and never added to it.
- **A session names its plan by its STORE** (the Codex home, or the Claude login's store, or a setup token's
  directory), and the CLI resolves that to an alias from the plans register: a plan of the same vendor whose
  `storeDir` is that path, else `unregistered`. Tokens are summed per plan only, never across vendors.
- **Nothing persists**: a restarted app starts every session's window again. The whole report is one socket line
  under the protocol's 1 MiB cap, with no paging; a run hosting thousands of sessions would outgrow it.

## Which verbs go through it

Every cmux caller. `cmux send`, `cmux stop`, `cmux list` and `cmux close` call the harness; `cmux spawn` (open
or resume, so every verb that seats through it, `handover wake` included), the drawdown investigation and
`handover park` are recorded. Every other verb opens cmux through `withCmuxSessionHost`
(`src/sessionHarness/cmuxHost.ts`), whose body gets the harness and a `CmuxHostSurface`: its inventory
(`listWorkspaces`, `resolveWorkspace`) goes through the harness, and an access refusal keeps its own class
across it (`accessDenied` on `HARNESS_UNAVAILABLE`). A launch's spawn deps come from `productionSpawnDeps`
(`src/sessionHarness/recordedSpawn.ts`), the one other place a connection is opened.

**Stage-2 debt, named.** The host surface forwards cmux's raw operations unchanged (`CmuxHostRawOperations`):
screen reads and grids, the process tree and `workspaceTop`, a raw `sendLine` and `submitComposer`, pin, rename,
close and the strict listings; beside it, `CmuxHostReach`'s `reachSession`, which never interrupts and keeps cmux's own
error so a talk delivery can still tell a keystroke that may have landed from one that did not. Each is
cmux-only, reachable only over a connection the seam opened, and is what a second implementation has to answer
before it can stand behind these verbs. Stage 1 is done: no caller outside the seam constructs a client.

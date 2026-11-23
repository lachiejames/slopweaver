# 1. Why a socket client and not a `cmux` wrapper

Part of [The cmux client, the verbs over it, and the event model](../cmux-client.md).

The owner's ruling: Slopweaver reaches GitHub through Octokit rather than the `gh` CLI — better to code with,
no process boundary — and cmux follows the same precedent: a TypeScript SDK where one exists, otherwise the CLI
wrapped in verbs.

cmux publishes no npm SDK. It does publish a Unix socket its own CLI is a thin front on, and that socket is
the SDK. `src/cmux/socket.ts` speaks it directly; `src/cmux/client.ts` is the typed face.

**The wire format, measured live against cmux 0.64.22** (cmux's published CLI contract documents user-visible
CLI behaviour and explicitly not this):

```
→ {"id":"sw-1","method":"system.ping","params":{}}
← {"ok":true,"id":"sw-1","result":{"pong":true}}
← {"ok":false,"id":"a","error":{"code":"method_not_found","message":"Unknown method"}}
```

Newline-delimited JSON, both directions. Calls multiplex by `id` on one connection — three requests written
back to back returned three replies, each carrying its own. A frame without `method` is rejected outright
(`invalid_request: Missing method`), which is how the alternative `{"command":…,"args":…}` shape was ruled out: it
is not accepted on this socket at all.

**No handshake and no password — but a capability token for a process cmux did not start.** cmux reports
`access_mode: "cmuxOnly"`: a process it can trace to one of its own surfaces is answered bare, and any other
gets the single line `ERROR: Access denied - only processes started inside cmux can connect` and a closed
connection. The console's Next server is that other process — `scripts/docs-site.sh --start` backgrounds it
and exits, so it is reparented to launchd — and the voice's relay failed that way five times in two days
while reading as "the connection closed", because the refusal line was dropped as an unmatched frame. cmux's
own CLI answers it by prefixing every frame `_cmux_capability_v1 <CMUX_SOCKET_CAPABILITY> `; the token is
exported into every surface and a child keeps it after reparenting. Measured by capturing that CLI's frames
on a fake socket, then a detached node process: prefixed it is answered, bare it is refused. So the client
prefixes every frame with the inherited token (`socketFrames.ts`'s `encodeRequest`), presents it only to
the LIVE socket — a caller naming its own socket, a test's fake, gets none unless it passes one — and reports
an `ERROR:` line as `SOCKET_UNAVAILABLE` carrying cmux's own words — with `reason: "access-denied"` when it is
that refusal word for word (`socketFrames.ts`'s `refusalError`), since no reconnect changes it. The token is a
credential: it is never logged, persisted, forwarded or put in a message. A process started wholly outside cmux has
none and is still refused: a `docs-site.sh --refresh` run from a plain terminal restarted the
console that way, and every voice relay landed on the board but not in the chair. Access is never widened for it
(password mode is the owner's call): the relay hands the line to the pinned chair's own `talk courier`, which
cmux started, and records `cmux-access-denied` or `courier-unavailable` when nothing can type it
([voice relays](../security/voice-relays-and-retention.md)).
`CMUX_SOCKET_PASSWORD` is never sent — see [§ 8](sidebar-and-known-gaps.md#8-known-gaps).

The socket path resolves the way cmux's own CLI resolves it — `CMUX_SOCKET_PATH`, then
`~/.local/state/cmux/last-socket-path`, then the default. The deprecated `CMUX_SOCKET` alias is deliberately
NOT consulted: cmux exports it EMPTY inside a workspace, so trusting it would resolve to `""` in exactly the
environment the socket is most certainly present in.

Re-verify any of this in one command:

```bash
cmux capabilities | jq '.methods | length'    # 303 on 0.64.22
cmux rpc system.ping '{}'
```

## 2. The measured facts the client is shaped around

Five things found by probing, each of which shapes the design.

## (a) A ref that names nothing does not fail — it addresses the FOCUSED surface

This is the important one, and it is a safety property rather than a style preference.

**Measured**: `surface.send_text {"workspace":"workspace:999","text":"x"}` — a ref no workspace
answers to — returned `ok:true` and typed `x` into the surface that happened to be focused, naming that
surface's own refs back in the reply. The same call keyed by `workspace_id` returns
`not_found: Workspace not found` and touches nothing.

A `workspace:N` ref is index-SHAPED but is not an index, and the difference was measured rather than assumed.
**Measured, cmux 0.64.22**: three workspaces opened back to back took `workspace:268/269/270`;
closing `269` left `270` still answering to `270`, and moving `268` to the top of the sidebar left it still
answering to `268`. The live inventory agrees — sidebar order and ref order do not match at all. So a ref is a
monotonic allocation counter that survives both a close and a reorder, and a stale one names nothing rather
than naming somebody else — **for as long as cmux itself keeps running**, which is the part not measured: a
restart could reasonably re-allocate from a lower number, and nothing here would notice.

Either way the fallback above makes a stale ref unsafe to WRITE through, so: **every write in the client takes
UUIDs.**

`CmuxClient.resolveWorkspace` is the one place a ref becomes an
id, and it refuses loudly when the ref names nothing live. The dispatch record
(`live/turn/dispatch.ts`, schema v3) carries `workspaceId`/`surfaceId` alongside the refs for the same
reason — the refs remain because they are what a human reads in the sidebar and what every log line quotes.

## (b) `workspace.list` is scoped to the CALLER'S window, not global

Measured: a bare `workspace.list` returned 13 rows while `window.list` reported one window holding exactly
those 13 — and cmux's own CLI agrees. That is not a global inventory, and a shared-checkout collision check
believing it was would miss a colliding workspace in another window entirely.

`CmuxClient.listWorkspaces` therefore fans out: `window.list`, then `workspace.list` per `window_id`. cmux
names the required parameter in its own rejection (`supported_param: "window_id"`), which is how that spelling
was settled rather than guessed.

## (c) The sidebar family has NO socket method — none

`cmux capabilities` lists 303 v2 methods on this build. Not one of them names a todo, a status lane, a
progress bar, a status pill or a sidebar log. `workspace.action`'s own `invalid_params` reply enumerates every
action it accepts (`pin`, `rename`, `set_description`, …) and the checklist is not among them.
`extension.sidebar.snapshot` DOES exist and is a real socket read, but its workspace rows carry no todo,
progress, status or log field — verified by writing all four through the CLI and re-reading the snapshot,
which came back identical in shape.

So `src/cmux/sidebar.ts` shells the `cmux` binary, and says so. The process boundary is real and is not
pretended away. What the module buys is that **no caller anywhere else composes a `cmux` argv by hand**, which
is what rule 3 is actually protecting.

## (d) `system.top`'s process trees hang off SURFACES

`include_processes: true` looks like it does nothing at the two levels a reader tries first (the window row
and the workspace row — both report `processes: []`). The trees are under `workspaces[].panes[].surfaces[]`,
with `children` nested inside each. `parseProcessTrees` handles that, and `slopweaver cmux processes` renders
it.

So a session's OS pid is a `cmux processes` read, never a `ps aux | grep "bin/claude"` against a worktree
path: the tree goes down to the `claude`/`codex` process, cross-checked live against `ps -p <pid>` for an exact
match including the full command line.

## (e) cmux enforces no single-pin invariant — a caller wanting one must check itself

Measured: `workspace.action {action: "pin", …}` on a SECOND workspace left both it and the
already-pinned one reading `pinned: true` on the next `workspace.list` call — cmux places no bound on how many
workspaces may be pinned at once. The pin is how a supervised session tells the supervisor from a peer
(`.claude/rules/cross-session-messages.md`), so a fleet holding two silently downgrades that check for every
session reading it. `slopweaver cmux pin` refuses in exactly that case (`src/cmux/pin.ts`'s
`pinCollisionRefusal`) rather than leaving cmux to allow it; `slopweaver cmux unpin` has no such refusal and is
idempotent, since a caller about to take over a pin cannot know which state it is in without a read it has no
other reason to make.

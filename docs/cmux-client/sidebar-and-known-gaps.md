# 6. What a sidebar row carries: identity only

Part of [The cmux client, the verbs over it, and the event model](../cmux-client.md).

**No checklist, no status lane, no progress bar.** The owner's ruling: the sidebar checklist and status go entirely,
because producing them is a waste of tokens. A seat's state
reaches the owner only as a Queue card or a floating note, so nothing in Slopweaver writes any of the three and no
verb exists to. What a row carries is who it is:

| Event                                    | Title                | Role colour | `ws` pill               |
| ---------------------------------------- | -------------------- | ----------- | ----------------------- |
| `cmux spawn` (the SPAWNER, at open)      | the session name     | its role    | the new workspace's ref |
| any successful `handover` lifecycle verb | unchanged            | unchanged   | the caller's own ref    |
| `slopweaver cmux title`                  | the text it is given | unchanged   | unchanged               |

Three rules, all deliberate:

- **The `ws` pill re-publishes on every successful lifecycle verb** (`start`, `ask`, `withdraw`, `amend`,
  `finish`, `abandon`). A spawn already writes it from the ref cmux hands back at creation, so for a spawned
  session the write is usually the same value under the same key. It is there for the two cases a spawn cannot
  cover: a run started in a workspace nobody spawned, and a ref cmux has reassigned mid-run. Reading the
  caller's own ref costs one extra `cmux identify --json`.
- **A publish failure never fails the lifecycle verb.** The run journal is the source of truth; turning a
  cosmetic write into a refused lifecycle verb would destroy real work over a decoration.
- **Nothing publishes from outside a cmux workspace, and nothing publishes from a test.** The first keeps a
  `handover start` typed at a plain terminal quiet. The second because a suite running a real
  `handover start` INHERITS this session's `CMUX_WORKSPACE_ID` and would write to the developer's own live
  sidebar. `insideCmuxWorkspace` (`src/handover/workspaceRefPublish.ts`) declines whenever `VITEST` is set.

**The SPAWNER publishes the opening row, before the session exists.** Boot, pickup delivery and the child's own
first read of the doc are a minute or more, and until then the row shows the truncated first line of whatever was
last sent — the boot line. `bootCmuxWorkspace` therefore publishes the title, colour and ref pill to the
workspace it has just created, addressed by **id**: a `workspace:N` ref that names nothing live silently
addresses the FOCUSED surface, which during a spawn is the supervisor's own.

**A row from an older checkout may still show a checklist or a pinned lane.** Nothing clears them; they go when
the workspace closes. A raw `cmux todo`, `cmux workspace status`, `cmux set-progress` or `cmux clear-progress`
is blocked by the raw-command gate as retired, with a hint to drop the instruction rather than break glass
(`src/admit/rawTools.ts`).

**`system.identify` is the focused workspace, NOT the caller's.** Measured by doing it wrong: a
`slopweaver cmux title` run from a background session with no `--workspace` renamed the supervisor's workspace,
because the supervisor's tab was on screen. A verb that means "my own workspace" reads `CMUX_WORKSPACE_ID` from
its environment, which cmux exports into every surface it opens and which cannot move while the process runs. The
shelled sidebar family is unaffected — the `cmux` binary resolves its own workspace from that same environment,
verified by writing to a row with no `--workspace` and watching the caller's row change and the focused one stay put.

**`workspace.action`'s rename parameter is `title`, not `name`** — measured from its own
`invalid_params: Missing or invalid title`, even though `workspace.create` calls the same field `name`.

## What a sidebar row can carry at all, and what Slopweaver puts where

Measured against cmux 0.64.22, by writing each field and photographing the row. In row order, top
to bottom:

| Row element              | Written by                                                | Slopweaver puts                                                                                                                        | Hidden by                                                                           |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| lane glyph + **title**   | `workspace.create --name` / `workspace.action rename`     | the handover slug, or the ask's question                                                                                               | —                                                                                   |
| **description**          | `workspace.action set-description`                        | the raw dispatch id when the title lacks it, and who is being answered — otherwise NOTHING                                             | `sidebar.showWorkspaceDescription`                                                  |
| **notification message** | the agent's own hook output                               | (not ours)                                                                                                                             | `sidebar.showNotificationMessage`, capped by `notificationMessageLineLimit`         |
| **status pills**         | `cmux set-status <key> <value>`                           | `ws` → the workspace's own `workspace:N` ref                                                                                           | `sidebar.showCustomMetadata`                                                        |
| **progress bar**         | `cmux set-progress` / derived from the checklist          | nothing (the owner's ruling)                                                                                                           | `sidebar.showProgress`                                                              |
| **branch · cwd**         | cmux, from the worktree                                   | (not ours)                                                                                                                             | `sidebar.showBranchDirectory`, `sidebar.showPullRequests`, `sidebar.watchGitStatus` |
| **checklist summary**    | `cmux todo set`                                           | nothing (the owner's ruling)                                                                                                           | —                                                                                   |
| **log lines**            | `cmux log --level <level>`                                | nothing yet                                                                                                                            | `sidebar.showLog`                                                                   |
| colour, pin, spinner     | `workspace.action set-color` / `pin`, `workspace loading` | the session's role colour; the supervisor handoff pin (`cmux pin`/`cmux unpin`, [§ 3's table](verbs-and-events.md#3-the-verb-surface)) | —                                                                                   |

Three facts that decide the layout rather than merely describing it:

- **A pill renders one per line**, whatever its length — measured with a two-character value beside cmux's own
  `claude_code` pill, which still wrapped. So a pill costs exactly one line, and `--priority` decides which
  pill gets the line nearest the title.
- **The description WRAPS rather than truncating**, so it is the most expensive line on the row and carries
  only what the title cannot — for a handover spawn, nothing at all. Restating the slug and a spawn timestamp
  there is a less readable duplicate of the title, as the owner judged it.
- **The `workspace:N` ref appears nowhere on a row by default**, on any build or setting — which is why the
  supervisor could brief the owner in `ws:N` and have the owner unable to find the row it named. The pill is the only
  field a tool may key for itself, so that is where it goes, and the value published is the ref VERBATIM
  (`workspace:266`) rather than a shortened `ws:266`, because it is the exact token `cmux --workspace` accepts.

**The one field with no per-workspace write at all is the row's own layout.** `~/.config/cmux/cmux.json`'s
`sidebar` block is global — it can hide any of the rows above for every workspace at once, never for one — and
a genuinely custom row means a beta SwiftUI file under `~/.config/cmux/sidebars/` (`cmux docs sidebars`), which
is a different kind of commitment from a CLI call.

## 7. What still needs a screen read

- **The content of a session's reasoning.** Every mechanism here says a session ran a tool, finished a turn or
  is waiting; none says what it decided or why. `Notification` events are aptly named: they say "something
  needs attention", never what.
- **Diff text.** No `*.diff` method exists. `git -C <cwd> diff` against the cwd the inventory already reports
  is still the way, and `cmux diff` renders in a browser split with no text mode at all.
- **A two-way channel.** Events and sidebar state are one-way telemetry out of a session. Coordination is
  still `SendMessage`/`ListAgents` or `slopweaver cmux send` into a surface — cmux adds no messaging
  primitive of its own.
- **Mapping a `workspace_id` to a handover slug.** `session watch` joins to the cmux inventory for a title and
  a cwd; correlating that to a slug is still judgement, exactly as `skills/supervisor/SKILL.md` already flags.

## 8. Known gaps

- **A socket password would break every call.** The client sends no password because this install needs
  none ([§ 1](socket-and-measured-facts.md#1-why-a-socket-client-and-not-a-cmux-wrapper)). If `CMUX_SOCKET_PASSWORD` is ever set, every call fails and nothing here reads the setting.
- **Whether the capability token outlives a cmux restart is unmeasured.** A console started before a restart
  may hold a stale one; if cmux refuses it, the relay reports `failed` with cmux's words and the sweep
  lists it — restart the console from a cmux surface.
- **`send-key` is unwrapped, except for the two keys that matter.** `slopweaver cmux send` covers the
  paste-and-submit case and presses the rescue Enter itself ([§ 5b](spawn-witness-chain.md#5b-the-same-rescue-on-the-send-path-and-the-fleet-sweep-that-finds-what-it-missed)), `--interrupt` covers Escape via
  `CmuxClient.interruptTurn`, `slopweaver cmux submit` covers a bare Enter on one workspace via
  `CmuxClient.submitComposer`, and `slopweaver cmux strands --submit` does it across the fleet. Every OTHER
  bare keystroke — a ctrl-c, an arrow — still has no verb and needs the break-glass.
- **Nothing knows WHY an Enter fails, and [§ 5b](spawn-witness-chain.md#5b-the-same-rescue-on-the-send-path-and-the-fleet-sweep-that-finds-what-it-missed) fixes the consequence rather than the cause.** One condition
  is implicated and VERIFIED: a send landing while the host is mid-turn. The pinned supervisor measured a
  `cmux send` into `workspace:86` during that seat's first turn, which printed
  `submitted to workspace:86` and was still `composer: TYPED, unsubmitted` fourteen minutes later. But it is not the whole
  cause: the strands measured alongside it ran 1137 characters with a collapsed paste down to 374 plain
  ones, so paste length does not explain them either. What is known is that an unverified submit strands, so
  the send path verifies it.
- **`notify` is unwrapped.** `notification.create_for_caller` exists on the socket and nothing here calls it;
  a session surfacing to the owner outside the terminal still has no governed verb.
- **`session watch --follow` has no reconnect.** A dropped subscription ends the watch rather than resuming
  from the cursor. The cursor is written on every batch, so restarting the verb resumes correctly — but that
  restart is a human's job.

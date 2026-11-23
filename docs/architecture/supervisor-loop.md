# 4 · The supervisor loop

Part of [Architecture](../architecture.md).

One intake chat, every source of state loaded before it speaks, three things it can do with an instruction, and a
tick its skill has the chair re-arm every time.

```mermaid
flowchart TB
  owner["THE OWNER — one pinned intake chat,<br/>the only one the owner talks to"]
  voice["OPTIONAL — the console voice, a go-between both ways:<br/>reads the chat back to the owner; puts the owner's steer on the board<br/>and, when cmux takes it, types it in as the owner's turn<br/>slopweaver talk supervisor · slopweaver talk relay<br/>src/talk/supervisorDelivery.ts · docs/voice-flow.md"]

  subgraph load["1 · Load EVERY source of state first. A briefing built from one of them is a guess wearing one"]
    direction TB
    s0["everything the owner typed this week,<br/>read before anything else<br/>slopweaver supervisor owner-turns"]
    s1["the session ledger, and the standing sessions<br/>slopweaver session list · slopweaver session standing<br/>src/sessions/sessionStore.ts"]
    s2["the board of runs, ranked against the owner's outcomes<br/>slopweaver handover list · slopweaver handover reconcile<br/>src/handover/boardState.ts"]
    s3["LIVE reality<br/>slopweaver cmux list<br/>src/cmux/client.ts"]
    s4["needs-input, working,<br/>idle, silent<br/>slopweaver session watch<br/>src/sessions/watchReport.ts"]
    s5["how DEEP each one is, and which<br/>are worth respawning rather than nursing<br/>slopweaver session depth · src/sessions/depthReport.ts"]
    s6["the owner's open PRs in both repos, one next act each<br/>slopweaver github landing — the chair names<br/>both with --repo, and --author @me"]
  end

  nar["2 · A narrated briefing — what drifted, and<br/>the one or two things that need the owner.<br/>Never a table, never a JSON dump"]
  pages["The same state as pages the owner can open: the fleet briefing<br/>slopweaver briefing render — and the console,<br/>off the readings each tick recorded<br/>slopweaver reading last · src/readings/store.ts"]
  route{"3 · Route, resume, or spawn"}
  send["ROUTE — hand it to the live<br/>session that owns that work"]
  fix["RESUME — a wedged session, by hand<br/>src/cmux/plan.ts"]
  spawn["SPAWN — open the doc's worktree, boot a<br/>visible session, verify it, send its pickup line<br/>slopweaver cmux spawn · src/cmux/spawn.ts"]
  press["PRESS — every green, mergeable PR of the owner's and every<br/>bump into the merge queue in one pass, no seat; BOARD up to ten<br/>dispatchable rows for the fill step<br/>slopweaver github landing --press --register"]
  run["Each becomes a run over a handover doc<br/>— see the run lifecycle below"]
  tick["4 · Record the tick, then re-arm the wakeup — the skill's order,<br/>which the record itself does not check<br/>The record REFUSES a tick that saw a machine hold with no investigation<br/>seated, or left an outcome of the owner's uncovered with capacity free —<br/>unless it gave a reason, or took the hatch the refusal names<br/>slopweaver supervisor tick-record · src/supervisor/loadDispatchGate.ts<br/>The re-arm passes the prompt sweep-prompt renders to ScheduleWakeup,<br/>1200s by default · slopweaver supervisor sweep-prompt"]

  owner -->|typed — always first class| load
  owner <-.->|spoken| voice
  voice <-.->|reads it back · types the owner's steer in when cmux takes it| load
  load --> nar --> route
  nar --> pages
  route --> send --> run
  route --> fix --> run
  route --> spawn --> run
  s6 -->|every tick| press
  route --> tick
  press --> tick
  tick -.->|the next tick| load
```

**The console voice is the one optional box above.** How a spoken steer becomes a board row and a turn
typed into this chat, what the chair owes it the same tick, and how the answer gets back is its own page and
picture: [voice-flow.md](../voice-flow.md).

**What the fleet did, read from its own transcripts.** The state sources above describe sessions that
are LIVE. What each one was actually told, and how much of its traffic was a person rather than the harness
talking to itself, lives only in the Claude session transcripts under `~/.claude/projects`, and
`slopweaver transcripts` is the typed way in:

| Verb                     | What it answers                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `transcripts sessions`   | every transcript on this machine, newest first, with the measured retention floor                                                 |
| `transcripts turns`      | the turns a PERSON took — every tool result, reminder, wrapper, notification and injected skill body stripped                     |
| `transcripts summary`    | turn counts by role, the autonomy ratio, the tool-error count and the span                                                        |
| `transcripts errors`     | every tool call that came back an error, named with the tool that made it                                                         |
| `transcripts latency`    | how long each tool call took, bucketed by hour and split before/after an instant                                                  |
| `transcripts last-turn`  | one session's latest turn as ordered parts — the words that opened it, then text, thinking and tool calls joined to their results |
| `transcripts boot-hooks` | every `SessionStart` hook a transcript records as never run — a missing command or `hook.sh` target — exiting 1 on any            |
| `transcripts draw`       | what each verb cost in MEASURED tokens per tick, added and carried, and every cap refusal retried with the API calls its lap took |

Four properties are load-bearing rather than incidental, and each is a rail rather than a convention:

- **Structured access only. There is no search verb, and there never will be.** A lexical sweep over this
  corpus counts MENTIONS, and a sweeping session's own output is echoed back into its own transcript, so its
  top hits are its own words. Every verb asks about roles, counts and `tool_result.is_error` instead —
  properties of the record rather than of its prose.
- **The retention bound is in the verb's own output.** Claude Code deletes old transcripts, so "nothing
  found" over an aged-out window means the evidence was deleted rather than that nothing happened. Every
  invocation measures the oldest transcript on disk and says whether the requested window falls inside it.
- **A latency question is asked of a HOMOGENEOUS slice, or not at all.** `Bash` is not one tool — `git status`
  and a ten-minute test run share its name — so `transcripts latency` carries `--tool` and `--command-prefix`,
  and every sample says whether it shared an assistant record with others (a parallel batch measures queueing,
  not the tool). Its window bounds the SAMPLES as well as the files, because a transcript written an hour ago
  may hold calls from last week.
- **Nothing is loaded whole.** Transcripts reach tens of megabytes; the walker reads a file in fixed slices
  and yields one decoded line at a time, so what is resident is one chunk regardless of the file's size. A
  session's transcript is located by SEARCHING the project directories for the file named after it, never by
  reconstructing the mangled-directory path — a wrong guess there fails silently, which reads as a session
  nobody recorded rather than as a bug.

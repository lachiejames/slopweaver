# The confined harness trial

How to try a seat or a supervisor tick on the installed app against synthetic state, so nothing it runs reads or
writes the owner's own home, board, Queue or pull requests.

## The four pieces of scratch

- **A docs directory** holding the trial's handover doc, passed as `cmux spawn --dir <docs>`.
- **A state home**, `mkdtemp`'d, with its own `handovers/`, passed as `--home <scratch>`.
- **A git clone** of the repository whose doc names it as `repo:` and whose `origin` is the clone's source, so a
  worktree the spawn makes is cut from it and never from the owner's checkout.
- **Explicit flags**, never an environment the spawn inherits: `--driver`, `--dir`, `--home` and `--harness app`.

```bash
slopweaver cmux spawn <slug> --harness app --driver claude --dir <docs> --home <scratch>
slopweaver supervisor tick open --dir <tick-scratch> --home <scratch>
```

## What each flag reaches

- **The pickup line** carries `--dir` and `--home`, absolute and shell-quoted, onto the seat's `handover start`, so
  the doc it reads is the trial's (`src/transcripts/spawnPickupLine.ts`). A spawn given neither prints the bare line.
- **The app seat's verbs** run under `SLOPWEAVER_HOME=<scratch>`: the launch spec's `stateHome`, set by the worker
  ([the state home](../../../docs/session-harness/state-home.md)). An installed app older
  than `stateHome` refuses such a launch `BAD_REQUEST`, and the CLI names why.
- **A supervisor tick** confined by `--home` runs every reading's child under that home, rehearses each monitor
  without `--fire`, and withholds every reading that acts on the world or reads the owner's live state, plus
  stopped-recipe seating; its header opens `CONFINED tick:` and names each withheld one
  ([derived-narrative](../../supervisor/reference/derived-narrative.md)).

## What it does not confine

A path resolved from anything other than `SLOPWEAVER_HOME`: `CODEX_HOME`, the Claude config directory, the cmux
socket and the process table are still the machine's own, and a tick's build-freshness check may write the
checkout's source-listing cache under its `.git` (build metadata, never state-home state). A plain cmux seat (no `--harness app`) gets the pickup
line's `--home` but no exported `SLOPWEAVER_HOME`, so a verb it runs without `--home` reads the ambient home.

## Proof

The unit and subprocess lanes prove the confinement over fakes and the shipped binary
(`subprocess/cli/commands/supervisor/tickConfinement.test.ts`). The installed-app half — a real confined seat
opened on the installed app — is OWED: it needs the current app, built with `stateHome`, installed.

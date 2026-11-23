# `profile-unloaded`: a running session that lost the owner's profile, reported as a reload in flight

The owner's words: a session can only act as the owner if it can load the owner's profile. Then, to the
chair, in the owner's words: the owner would rather the chair do nothing than act misaligned for the owner, and the recovery
really needs to be automatic, none of this more floating notes and the owner having to explicitly tell the chair every
time. So the session recovers itself: the PreToolUse `profile-held` check (`src/admit/profileHeld.ts`) holds its
next guarded call and delivers the profile in the refusal, and the door holds an external write
(`src/admit/profileLoadGate.ts`). This monitor only REPORTS that, quietly.

- **What it reads** (`src/monitor/profileUnloadedSource.ts`). Every Claude transcript written in the last day,
  for its profile hook's boot records, and `$SLOPWEAVER_HOME/profile/loads.jsonl`, where the hook, the
  `profile-held` check, the prompt-time seat check and `slopweaver profile context` record every load. A
  session's NEWEST observation is its verdict, so a reload clears it. All local: a pass opens no connection.
  A first boot writes no row at all — not its session-start or prompt-time hook, its passed calls, nor its
  `profile context` (`src/admit/profileFirstBoot.ts`) — and on a machine never configured this monitor reads clear
  whatever a transcript says: there is no profile to have lost and no call is held, so a newcomer's first session
  never shows here.
- **Which evidence wins.** The hook exits zero on every path — killed by its bound, its binary missing, a
  throw it swallows — so a transcript's `hook_success` is judged by its `stdout`: the always-loaded block is a
  load, anything else a failure. The result of a Bash call whose command IS `slopweaver profile context`,
  ending `origin: live` or `origin: cache`, is a load too, which is how a seat on older code clears itself; a
  screen read off another seat is not. A transcript failure always counts, since a hook that never ran or was
  killed writes no row, and so does a transcript load, which is the only record of a run on code that writes
  none. A caller with two ids (a Claude session carrying a Codex thread id) is decided by its newest
  observation across both. A `PostCompact`
  run counts neither way: Claude Code reads no context from it, so only `SessionStart:compact` decides a
  compaction (measured in `src/context/loadLedger.ts`).
- **Its residue.** A by-hand reload records its row whatever happens to its output, so one piped through
  `jq` or `tail` clears the card without the session having read the profile — the hold still meets its next
  guarded call, since a by-hand run writes no delivery marker.
- **Its blind spots.** Claude transcripts only: a Codex thread whose hook never ran leaves nothing it reads. And a
  hold the hook ENVELOPE makes on a kill reads no payload, so it writes no row: a session whose every guarded call
  is killed under load is held, and prints the owner's profile each time, while this card says `not yet held` until the
  first call a gate judges ([envelope](../../../docs/hooks/mirrors-and-failure-policy.md)). The door's own
  `PROFILE_NOT_LOADED` hold delivers nothing, since a write reaching it with no guarded call in front has no context
  to deliver into, so a session met only there also reads `not yet held` (`src/admit/profileLoadGate.ts`).
- **What it posts.** ONE card over the whole set, keyed on the newest failure, naming each session's state from
  evidence. It says `held`, and reloading by itself, once a session's newest failure is the hold's own
  `PreToolUse` row, and `not yet held` before that, because a seat on hooks older than the hold looks the same
  from here until it is met. A hold row recording a delivery whose marker could not be written reads
  `marker unwritable` instead, since every retry is held again and a reload in flight would be false. It
  does not float, and a key the owner closed or one already shown is held rather than re-posted.
  It asks nothing of the owner.
- **What it never does.** Call a read it could not make clear: an unreadable transcript or ledger is
  `unmeasurable` — unless a failure was SEEN anyway, when the card still posts.

Measure it: `slopweaver monitor check --only profile-unloaded --json` (read-only without `--fire`). The load
lane as a whole: [owner registers](../../../docs/store/owner-registers-and-roles.md#loading-is-mechanically-enforced).

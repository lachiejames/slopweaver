/**
 * The usage line of `slopweaver github lap`, and nothing else — a LEAF, so the manifest barrel can quote it
 * without loading the verb.
 */

/** `slopweaver github lap`'s usage. */
export const GITHUB_LAP_USAGE =
  "usage: slopweaver github lap --repo <owner/name> --number <n>[,<n>...] [--land | --land-only] [--acknowledge <subject,...> --reason <text>] [--codex-loop-incomplete <n>=<reason> ...] [--dry-run] [--home <dir>]\n" +
  "  Run the whole CI lap on THIS machine over one pull request's head, then post the two contexts its base\n" +
  "  requires — `build` and `integration` — on that head through the door. The local stand-in for hosted\n" +
  "  Actions, which is off: the steps are CI's own register (`ci-offload-contract`), never a second list.\n" +
  "  Refuses before any lane when the lap could not end in a landing: the head does not contain the base\n" +
  "  tip (rebase and push first), the running CLI's CI model differs from the head's, the token is not an\n" +
  "  admin, the base requires a context a lap never posts. With --land on ONE pull request it also runs\n" +
  "  the landing itself first, as `github merge`'s own write-free dry run at the head, so a precondition no lap can\n" +
  "  fix (a native stack member, a draft, a missing Codex loop) refuses before the first\n" +
  "  lane; a batch's landings are not checked ahead. While a lap seat is designated (`github lap-seat`),\n" +
  "  any other session's lap is refused first (hatch SLOPWEAVER_ALLOW_OFF_SEAT_LAP; --dry-run exempt).\n" +
  "  One lap at a time on the machine; lanes see an\n" +
  "  allowlisted environment (CI=true, POLLY_MODE=replay, a throwaway HOME and Postgres 17, Vitest capped at 4 workers).\n" +
  "  Posts `pending` first, then `error` if it cannot start, else `failure` naming the first red step or\n" +
  "  `success`; an unrun step is never posted green. Logs and a receipt go under $SLOPWEAVER_HOME/laps/.\n" +
  "  A BATCH, `--number a,b,c` (at most 12, one base branch, landing order): fetch every head over one\n" +
  "  base tip, simulate the squash chain locally, lap its last commit ONCE and post the verdict on every\n" +
  "  head; its preflight starts no stage past a 10-minute deadline, naming the stage it finished. With --land, land each in order, measuring its merge's findings over the real tip and reading\n" +
  "  every landing back against the simulated tree; a red lap lands none, a stop fails the unlanded ones.\n" +
  "  --land             once both are green: take the `github hold`, refetch the base and head and require\n" +
  "                     both unmoved, land through `github merge`'s administrator bypass, release the hold\n" +
  "  --land-only        land exactly as --land does, running no lane, only when the head's `build` and\n" +
  "                     `integration` already read a lap's green over the base tip as it stands now\n" +
  "  --acknowledge <subject,...>  with --land and --reason: the finding subjects that merge accepts, verbatim\n" +
  "  --reason <text>    why, written by `github merge` to the door ledger; one lap only, a batch refuses both\n" +
  "  --codex-loop-incomplete <n>=<reason>  a batch with --land, repeatable: member n's merge alone accepts\n" +
  "                     `codex-loop-incomplete`, writing that reason; it covers no other member or finding\n" +
  "  --dry-run          read and refuse exactly as a lap would, print the steps, run and post nothing; with\n" +
  "                     --land, check the landing too. Refused with --land-only and with a batch's --land\n" +
  "  --home <dir>       the state home whose door records the post and whose laps/ keeps the logs\n";

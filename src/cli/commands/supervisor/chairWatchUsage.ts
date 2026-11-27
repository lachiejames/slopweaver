/**
 * The usage text of `supervisor chair-watch` — a leaf, so the manifest quotes it without loading the verb, and
 * `./chairWatchRun.ts` imports it back.
 */

/** `supervisor chair-watch`'s usage. */
export const CHAIR_WATCH_USAGE =
  "usage: slopweaver supervisor chair-watch [--home <dir>] [--json]\n" +
  "\n" +
  "One read-only pass over the pinned chair's hand-off cadence, judged on RECORDED plan readings only — each\n" +
  "plan's last `claude gauge` snapshot, fresh within the hour and its window not reset — so it never probes a plan\n" +
  "or spends a token. Prints STAY, HAND-OFF, HELD (the owner's hold), UNMEASURED or UNSUPPORTED (a chair the\n" +
  "control plane cannot hand off from: a cmux tab or a Codex thread), every reason, the successor's plan, each\n" +
  "plan's reading, the desktop app's per-session asked-against-ran model and tokens per hour, and the overrides.\n" +
  "Never a loop: the control plane calls it on its own timer. Exits 0 on any completed pass; --json is the report.\n" +
  "\n" +
  "example: slopweaver supervisor chair-watch --json";

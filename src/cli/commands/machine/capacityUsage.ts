/**
 * `slopweaver machine capacity`'s usage text, in its own leaf so the command module stays one a reader can
 * hold — `./capacity.ts` imports it back and prints it for `--help` and beside a flag error.
 */
import { IDLE_HOLD_FLOOR_PCT, OWNER_DISK_FLOOR_GB, SEAT_TREE_GB } from "../../../live/machine/capacityHolds.js";
import { BOOT_WINDOW_SECONDS, DEFAULT_RECENT_BOOTS_HOLD } from "../../../live/machine/recentBoots.js";

export const MACHINE_CAPACITY_USAGE =
  "usage: slopweaver machine capacity [--top <n>] [--home <dir>] [--json] [--brief] [--full] [--record-reading <by>] [--wait] [--timeout-seconds <n>]\n" +
  "  Top-N processes by memory footprint (Activity Monitor's Memory column — top's `mem` stat, NOT ps RSS),\n" +
  "  swap used, load average, the VM compressor's segments-limit percentage and the swapfile count, each\n" +
  "  process classified fleet (this checkout's own claude/node/cmux, or anything a live Claude Code session\n" +
  "  spawned, named with that session) or foreign. The verdict grades TWO subjects and says which — memory\n" +
  "  and cpu — so an `ok` never silently means `ok on memory`. Publishes an alert onto the supervisor stream\n" +
  "  when a foreign process or a session's spawned child crosses 8 GB, or swap 4 GB, and a HOLD — spawn\n" +
  "  nothing — when the compressor reaches 40% of its segments limit, 12\n" +
  "  swapfiles exist (the two readings the kernel panic's own log graded, 100% / 49), or the\n" +
  "  1-minute load average reaches 3x the core count (45 here) while top reads under\n" +
  `  ${String(IDLE_HOLD_FLOOR_PCT)}% idle (Activity Monitor's figure; unread idle leaves load to judge alone),\n` +
  `  or ${String(DEFAULT_RECENT_BOOTS_HOLD)} Claude sessions booted in the last ${String(BOOT_WINDOW_SECONDS)}s — load the 1-minute average cannot see yet (six boots in one\n` +
  "  pass reached load 45.9). A hold on boots alone pauses spawns and publishes no capacity-hold.\n" +
  `  The state home's volume below the owner's ${String(OWNER_DISK_FLOOR_GB)} GB, room for a ${String(SEAT_TREE_GB)} GB seat tree each for the\n` +
  `  ${String(DEFAULT_RECENT_BOOTS_HOLD)}-seat boots burst and the next, df-available (Finder shows at least that), HOLDs on disk — live seats' trees are already\n` +
  "  in df's used space, so they are not reserved again:\n" +
  "  discretionary seating stops until `slopweaver worktree prune --apply` frees space; like boots it\n" +
  "  publishes no capacity-hold, and it never blocks --wait.\n" +
  "  A process whose stats the kernel refuses (the Falcon sensor) is absent from top's table, so\n" +
  "  the verdict names it beside the top foreign hog with the CPU top's rows cannot attribute; it alerts and\n" +
  "  holds on nothing by itself.\n" +
  "  Above the machine lines, and under `ceilings` in --json: what is UNUSED now on every ceiling a seat\n" +
  "  spends — the machine's load of its hold, each Claude plan's five-hour and seven-day windows (one gauge\n" +
  "  probe per unpaused plan), each Codex plan's windows — as used of available with its reset, and the\n" +
  "  LOWEST one, the ceiling the sweep fills to. A plan read that fails is shown, never an exit.\n" +
  "  While the fleet-wide spawn backoff is closing the door (a held window, or one spawn at a time after one),\n" +
  "  one `spawn backoff:` line says until when; under `spawnBackoff` in --json always.\n" +
  "  --brief prints only what a supervisor tick acts on: the `unused now` clause, the spawn-backoff line and the\n" +
  "  verdict; with --json, one small document of the hold, its subjects and culprit, the gauges the briefing\n" +
  "  folds, the dispatch standing without its investigation list and the ceilings reduced to the lowest, the\n" +
  "  route and that clause. Exit code, published events and --wait are unchanged; drop --brief for the gauges.\n" +
  "  --record-reading <by> (needs --json) appends the reading to the readings ledger as <by> after printing it,\n" +
  '  so `reading last --producer "machine capacity"` serves it: the FULL document always, under --brief too, from\n' +
  "  the same single read. A refused append exits 1; under --wait only the reading the wait ended on is recorded.\n" +
  "  The text read counts the ranked processes and the fleet's live sessions on one line, and still prints every\n" +
  "  orphan group `machine reap` would act on; --full prints the fleet's load breakdown and one line per\n" +
  "  process. --json always carries every process.\n" +
  "  --wait re-reads on a stepped backoff until no HOLD but disk stands, printing the held subjects only when they\n" +
  "  change, then the report; exit 4 when --timeout-seconds (default 540) passes with the HOLD still on.";

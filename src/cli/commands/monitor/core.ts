/**
 * Flag specs, usage text and the shared parse for the `monitor` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../hand/core.ts` does.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `monitor`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const LIST_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

const CHECK_FLAGS: FlagSpec = {
  boolean: ["json", "fire", "push"],
  string: ["landing", "now", "by-session", "home", "only"],
};

const FILTER_FLAGS: FlagSpec = { boolean: ["json"], string: ["hook-script", "home"] };

/** The `--`-prefixed names of one spec, for the help-truth ratchet. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: booleans = [], string: strings = [] } = spec;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed list flags, read by the help-truth ratchet against {@link LIST_USAGE}. */
export const MONITOR_LIST_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_FLAGS });
/** `--`-prefixed check flags, read by the help-truth ratchet against {@link CHECK_USAGE}. */
export const MONITOR_CHECK_FLAG_NAMES: readonly string[] = flagNames({ spec: CHECK_FLAGS });
/** `--`-prefixed filter flags, read by the help-truth ratchet against {@link FILTER_USAGE}. */
export const MONITOR_FILTER_FLAG_NAMES: readonly string[] = flagNames({ spec: FILTER_FLAGS });

/**
 * Parse `monitor list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseMonitorListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * Parse `monitor check`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseMonitorCheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CHECK_FLAGS });
}

/**
 * Parse `monitor filter`'s flags. The action — `install`, `show` or `status` — is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseMonitorFilterArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: FILTER_FLAGS });
}

/** What `monitor list --help` prints. */
export const LIST_USAGE =
  "usage: slopweaver monitor list [--home <dir>] [--json]\n" +
  "\n" +
  "Every monitor this install declares: what it reads, when it fires, and what makes it stop. Reads\n" +
  "nothing and decides nothing — `monitor check` is the pass.\n";

/** What `monitor check --help` prints. */
export const CHECK_USAGE =
  "usage: slopweaver monitor check [--only <monitor>] [--landing <path>] [--fire] [--push] [--now <iso>] \\\n" +
  "         [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Run every monitor once over this machine's own ledgers. Without --fire it decides and writes nothing.\n" +
  "\n" +
  "  --only        run one monitor — a standing recipe row's own cadence; the others' cards are untouched\n" +
  "  --landing     a `slopweaver github landing --json` document; without one `prs-backed-up` is\n" +
  "                unmeasurable, because this lane never opens a network connection of its own\n" +
  "  --fire        post the hand steps that ARRIVED and settle the ones whose subject is gone; a\n" +
  "                floating monitor's arrival (`monitor list` names its delivery) also raises its note\n" +
  "  --push        after firing, run the push lane so one banner names what arrived (implies --fire)\n" +
  "  --now         the instant to judge at, ISO-8601 — replays a past pass exactly\n" +
  "  --by-session  which session is running it; provenance on every row it writes, never proof\n";

/** What `monitor filter --help` prints. */
export const FILTER_USAGE =
  "usage: slopweaver monitor filter <install|show|status> [--hook-script <path>] [--home <dir>] [--json]\n" +
  "\n" +
  "The cmux notification filter: no cmux banner or sound reaches the desktop, the supervisor chair's\n" +
  "included — the floating note (`hand post`) is the one surface that interrupts the owner. Suppresses the\n" +
  "BANNER only — every row keeps its record, its unread mark and its sidebar reorder — and fails open,\n" +
  "so the worst case is the noise that was already there.\n" +
  "\n" +
  "  install       write the filter and the shim cmux's own hook path hands off to, backing up first\n" +
  "  show          print the script that WOULD be written, touching nothing\n" +
  "  status        what is on disk, and how many notifications the filter has actually judged\n" +
  "  --hook-script the path cmux's config names; discovered from ~/.config/cmux/cmux.json when absent\n";

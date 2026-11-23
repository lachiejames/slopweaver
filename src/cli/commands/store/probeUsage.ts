/**
 * The usage text each detective-ladder verb prints for `--help` and beside a refusal.
 *
 * A leaf beside `./probe.ts` rather than a block inside it, the shape `src/cli/` gives a usage string
 * (`../listen/listenUsage.ts`): the shell is wiring, and six two-line strings were the part of it that grew
 * whenever a rung gained a flag — the human-only bot scope is what put it over its size floor.
 */

/** `store probe`, over the store and over Datadog. */
export const PROBE_USAGE =
  "usage: slopweaver store probe <keyword> [<keyword> ...] [--regex <pattern>] [--source <s>] [--enumerate-at-or-below <n>] [--ids <n>] [--include-bots|--exclude-bots] [--json]\n" +
  "       slopweaver store probe <keyword> ... --source datadog [--from 7d] [--to now] [--env <e,...>] [--json]\n" +
  "  Human-authored rows only by default; --include-bots widens to every author.";

/** `store groups`, over the store and over Datadog. */
export const GROUPS_USAGE =
  "usage: slopweaver store groups --term <t> --shape <s> --facet source|kind|container|author [--limit <n>] [--include-bots|--exclude-bots] [--json]\n" +
  "       slopweaver store groups --term <t> --source datadog --facet <f> [--rung <r>] [--limit <n>] [--from 7d] [--env <e,...>] [--json]";

/** `store hits`, over the store and over Datadog. */
export const HITS_USAGE =
  "usage: slopweaver store hits --term <t> --shape <s> [--source <s>] [--limit <n>] [--offset <n>] [--include-bots|--exclude-bots] [--json]\n" +
  "       slopweaver store hits --term <t> --source datadog [--rung <r>] [--limit <n>] [--regex <p>] [--from 7d] [--env <e,...>] [--json]";

/** `store peek`. `--source` is accepted so the shared vocabulary does not refuse it; the id decides the backend. */
export const PEEK_USAGE =
  "usage: slopweaver store peek --id <uuid|dd:...,...> [--match <term>] [--chars <n>] [--source <s>] [--json]";

/** `store open`. `--source` is accepted for the same reason as on `store peek`. */
export const OPEN_USAGE = "usage: slopweaver store open --id <uuid|dd:...,...> [--source <s>] [--json]";

/** `store around`, over the store and over Datadog. */
export const AROUND_USAGE =
  "usage: slopweaver store around --id <uuid | <channel>:<ts> | slack link> [--mode conversation|thread|container] [--before <n>] [--after <n>] [--chars <n>] [--json]\n" +
  "       slopweaver store around --id dd:<...> [--mode trace|request|session|ip|service] [--limit <n>] [--from 7d] [--json]";

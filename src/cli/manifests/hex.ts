/**
 * Lazy manifest for the `hex` noun — the READ integration over Hex's documented `/api/v1` surface
 * (`src/hex/**`), a peer of `src/datadog/**` rather than a tenant of `src/atlas/hex/**`.
 *
 * The two are deliberately separate and the difference is the whole design. **The atlas is the SURFACE MAP**
 * — what Hex offers, stored locally, with every result-bearing operation `withheld` by
 * `atlas/hex/disposition.ts` so no customer data lands on this disk. **This noun READS THE WORKSPACE**, live,
 * and prints what it reads to the session that asked. Hex is a first-class
 * integration for reading, never ingested into the corpus. Both hold at once because the atlas stores and does not read, while these verbs read and do not
 * store.
 *
 * Every verb here is `effect: "external-read"` and therefore not `doorRouted`, exactly as `github read`,
 * `notion read` and every Datadog read verb are classified. Nothing in this noun can write to Hex: the
 * client's `HexMethod` admits `GET` alone, so a mutation is not expressible rather than merely unused.
 */
import {
  HEX_CELLS_USAGE,
  HEX_CONNECTIONS_USAGE,
  HEX_OUTPUT_USAGE,
  HEX_PROJECT_USAGE,
  HEX_PROJECTS_USAGE,
  HEX_RAW_USAGE,
  HEX_RUNS_USAGE,
  HEX_VERIFY_USAGE,
} from "../commands/hex/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Every `hex` verb shares this classification — see the file header. */
const READ_META = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  parseRejectIsIoFree: true,
} as const;

export const hexManifest: Readonly<Record<string, VerbManifestEntry>> = {
  cells: lazy({
    load: () => import("../commands/hex/cellsRun.js").then((m) => m.hexCellsCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex cells --project 1b0c… --sql-only",
      summary:
        "A project's draft cells and their SOURCE — the SQL that says which table, filter and window a " +
        "notebook actually asks about. Sources are configuration; no result set is read here",
      usage: HEX_CELLS_USAGE,
    },
  }),
  connections: lazy({
    load: () => import("../commands/hex/connectionsRun.js").then((m) => m.hexConnectionsCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex connections",
      summary:
        "Which warehouses this workspace reads and what each points at — a BigQuery project, a Postgres " +
        "host and database. Identifiers only; no credential field is ever read",
      usage: HEX_CONNECTIONS_USAGE,
    },
  }),
  output: lazy({
    load: () => import("../commands/hex/outputRun.js").then((m) => m.hexOutputCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex output --cell abc123 --limit 20 --date-column created_at",
      summary:
        "The rows a SQL cell last produced in the DRAFT session, printed here and stored NOWHERE — Hex is " +
        "read, never ingested. `--date-column` splits them at Datadog's 15-day retention edge: what both " +
        "systems still see, and what only Hex does",
      usage: HEX_OUTPUT_USAGE,
    },
  }),
  project: lazy({
    load: () => import("../commands/hex/projectRun.js").then((m) => m.hexProjectCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex project --project 1b0c… --tables",
      summary:
        "One project's configuration — owner, status, schedules, categories — and with `--tables` the " +
        "warehouse tables its cells query, each naming the connection it is read through",
      usage: HEX_PROJECT_USAGE,
    },
  }),
  projects: lazy({
    load: () => import("../commands/hex/projectsRun.js").then((m) => m.hexProjectsCommand),
    meta: {
      ...READ_META,
      example: 'slopweaver hex projects --query "overnight schedule"',
      summary:
        "The workspace's projects, narrowed by words against title, description and categories, each with " +
        "its app URL — where an investigation opens, because somebody has usually already written the notebook",
      usage: HEX_PROJECTS_USAGE,
    },
  }),
  raw: lazy({
    load: () => import("../commands/hex/rawRun.js").then((m) => m.hexRawCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex raw --path /v1/context/topics",
      summary:
        "One authenticated GET against a documented operation the typed verbs do not cover, the body printed " +
        "as unparsed text. Read-only by TYPE — no method but GET is expressible — and refused outside `/v1/`",
      usage: HEX_RAW_USAGE,
    },
  }),
  runs: lazy({
    load: () => import("../commands/hex/runsRun.js").then((m) => m.hexRunsCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex runs --project 1b0c… --limit 10",
      summary:
        "A project's run history — trigger, status and time — which is how a reader dates the numbers " +
        "`hex output` hands back and sees a failed overnight schedule for what it is",
      usage: HEX_RUNS_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/hex/verifyRun.js").then((m) => m.hexVerifyCommand),
    meta: {
      ...READ_META,
      example: "slopweaver hex verify",
      summary:
        "Who the configured Hex token is and what role it CARRIES — Hex mints no read-only token, so the " +
        "role is the honest answer and the GET-only client is what bounds it",
      usage: HEX_VERIFY_USAGE,
    },
  }),
};

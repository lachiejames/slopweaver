/**
 * The sections of the state-home classification that the authored leg never imports: `scratch` (reproducible, or
 * dead by what it is), `credential` (token material, never stored) and `other-class` (a sibling migration owns it).
 * Each is named so leaving it out is a decision, not an oversight.
 *
 * Spread into `HOME_DIRECTORY_CLASSIFICATION` (`./authoredDirectories.ts`) after the authored rows, in this order;
 * a new directory of one of these classes goes in its array here.
 */
import type { HomeDirectoryClassification } from "./authoredDirectories.js";
import { exact } from "./homeClassificationRow.js";

/** Reproducible or dead directories: a log, a query's own working files, a re-taken reading. */
export const SCRATCH_DIRECTORY_ROWS: readonly HomeDirectoryClassification[] = [
  exact({
    because: "a process's own log; its outcome is in its journal",
    directoryClass: "scratch",
    name: "agent-logs",
  }),
  exact({ because: "scratch by name", directoryClass: "scratch", name: "audit-scratch" }),
  exact({
    because: "the Codex plugin export's pre-cache location; it is rebuilt under the cache root (src/cacheHome.ts)",
    directoryClass: "scratch",
    name: "codex-plugin",
  }),
  exact({
    because: "the console's saved readings' pre-cache location; they live under the cache root (src/cacheHome.ts)",
    directoryClass: "scratch",
    name: "console",
  }),
  exact({
    because: "the last desktop update notice's pre-cache location; it lives under the cache root (src/cacheHome.ts)",
    directoryClass: "scratch",
    name: "desktop",
  }),
  exact({
    because: "the console's run records' pre-cache location; docs-site.sh moves it under the cache root",
    directoryClass: "scratch",
    name: "docs-site",
  }),
  exact({
    because: "store read plans and shards, re-derived from the store by the same query",
    directoryClass: "scratch",
    name: "fanout",
  }),
  exact({ because: "a process's own log; its outcome is in its journal", directoryClass: "scratch", name: "logs" }),
  exact({ because: "a launchd plist its verb rewrites", directoryClass: "scratch", name: "machine" }),
  exact({
    because: "renders of Notion pages, re-fetchable from Notion",
    directoryClass: "scratch",
    name: "notion-renders",
  }),
  exact({
    because:
      "snapshots of live reads the next tick re-takes; judged scratch here, not measured — the audit's 257 MB excluded it",
    directoryClass: "scratch",
    name: "readings",
  }),
  exact({ because: "scratch by name", directoryClass: "scratch", name: "run-scratch" }),
  exact({ because: "scratch by name", directoryClass: "scratch", name: "scratch" }),
  exact({ because: "scratch by name", directoryClass: "scratch", name: "tmp" }),
];

/** Directories holding token material: never imported, because the store's dump goes to the backup destination. */
export const CREDENTIAL_DIRECTORY_ROWS: readonly HomeDirectoryClassification[] = [
  exact({
    because: "its plan-* and unbound directories are Claude config dirs holding OAuth material",
    directoryClass: "credential",
    name: "claude-accounts",
  }),
  exact({ because: "one 0600 file per token", directoryClass: "credential", name: "secrets" }),
];

/** Directories a sibling migration owns — a leg that already exists, or its own board row. */
export const OTHER_CLASS_DIRECTORY_ROWS: readonly HomeDirectoryClassification[] = [
  exact({ because: "the atlas import and the backup's files leg", directoryClass: "other-class", name: "atlas" }),
  exact({ because: "a cache of the backup's own staging", directoryClass: "other-class", name: "backups" }),
  exact({ because: "the measurements row", directoryClass: "other-class", name: "bakeoff" }),
  exact({ because: "a one-time import into the store", directoryClass: "other-class", name: "codex-fallback" }),
  exact({ because: "corpus ingest and the backup's files leg", directoryClass: "other-class", name: "corpus" }),
  exact({ because: "the measurements row", directoryClass: "other-class", name: "datadog" }),
  exact({ because: "the measurements row", directoryClass: "other-class", name: "datadog-shots" }),
  exact({ because: "the measurements row", directoryClass: "other-class", name: "evidence" }),
  exact({
    because:
      "the pre-cache location of the content-addressed binary cache older checkouts still hardlink; new entries go under the cache root",
    directoryClass: "other-class",
    name: "exec-store",
  }),
  exact({ because: "a one-time import into the store", directoryClass: "other-class", name: "grants" }),
  exact({ because: "the memories table and the backup's files leg", directoryClass: "other-class", name: "knowledge" }),
  exact({
    because: "the door and autonomy legs, and the three-of-six-door-ledgers row",
    directoryClass: "other-class",
    name: "ledgers",
  }),
  exact({
    because: "the codex leg reads its pass records; the rest is the scratch tier",
    directoryClass: "other-class",
    name: "orchestration",
  }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "page-fragments" }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "page-sources" }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "page-src" }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "pages" }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "pages-src" }),
  exact({ because: "the measurements row", directoryClass: "other-class", name: "proof" }),
  exact({ because: "the deliverable-tier row", directoryClass: "other-class", name: "published-pages" }),
  exact({
    because: "the owner-turns leg reads its owner-turn files; the rest is the scratch tier",
    directoryClass: "other-class",
    name: "supervisor-scratch",
  }),
];

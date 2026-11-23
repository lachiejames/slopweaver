/*
 * The console's sign-in reader (`site/components/live/readPlanConnections.ts`) parses what `plans connections --json`
 * prints. This file writes real attempts through the connection store, reads them back with the verb's own reader,
 * prints them the way the verb does (`{ connections }`, stringified), and feeds that to the console — so a field the
 * store stops writing, or a failure code the console does not word, breaks here.
 *
 * It lives in the `src` lane, not the site's, because the site build type-checks its own tests and cannot resolve
 * what the connection store imports.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readPlanConnections } from "../../../plans/connectCodex.js";
import { CONNECTION_FAILURES, type ConnectionPhase, type PlanConnection } from "../../../plans/connection.js";
import { writePlanConnection } from "../../../plans/connectionStore.js";

/** The console's reader and its failure list, loaded at run time: `src` cannot import `site/` statically. */
interface SiteReader {
  readonly read: (payload: unknown) => unknown;
  readonly failures: readonly string[];
  readonly phases: readonly string[];
}

/**
 * Load the site's sign-in reader.
 *
 * @returns the reader and the lists it validates against
 */
async function loadReader(): Promise<SiteReader> {
  const path = fileURLToPath(new URL("../../../../site/components/live/readPlanConnections.ts", import.meta.url));
  const site = (await import(path)) as Record<string, unknown>;
  return {
    failures: site["CONNECTION_FAILURES"] as readonly string[],
    phases: site["CONNECTION_PHASES"] as readonly string[],
    read: site["readPlanConnections"] as (payload: unknown) => unknown,
  };
}

const NOW_MS = Date.parse("2026-11-07T10:05:00.000Z");

/** An attempt in a given phase, as the worker writes one. */
const attempt = ({ phase }: { phase: ConnectionPhase }): PlanConnection => ({
  alias: "codex-1",
  deadlineAtIso: "2026-11-07T10:12:00.000Z",
  host: "codex",
  id: "0123abcd4567ef89",
  phase,
  startedAtIso: "2026-11-07T10:00:00.000Z",
  storeDir: "/acme/home/codex-accounts/codex-1",
  updatedAtIso: "2026-11-07T10:00:02.000Z",
  ...(phase === "connected" ? { email: "b@example.com" } : {}),
  ...(phase === "failed" ? { detail: "port 1455 is in use", failure: "START_REFUSED" as const } : {}),
});

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connections-contract-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** What the verb prints for the home's attempts. */
const printed = (): unknown =>
  JSON.parse(JSON.stringify({ connections: unwrap(readPlanConnections({ home, nowMs: NOW_MS })) }));

describe("the console reads what the connection store writes", () => {
  it("names every failure code the store can write, in order", async () => {
    const site = await loadReader();
    expect(CONNECTION_FAILURES.length).toBe(11);
    expect([...site.failures]).toEqual([...CONNECTION_FAILURES]);
  });

  it("reads an attempt in every phase the console knows", async () => {
    const site = await loadReader();
    expect(site.phases.length).toBe(5);
    const read = site.phases.map((phase) => {
      unwrap(writePlanConnection({ connection: attempt({ phase: phase as ConnectionPhase }), home }));
      const view = site.read(printed()) as { codex: { phase: string; failure: string | undefined } };
      return `${view.codex.phase}:${String(view.codex.failure)}`;
    });
    expect(read).toEqual([
      "starting:undefined",
      "browser:undefined",
      "connected:undefined",
      "failed:START_REFUSED",
      "cancelled:undefined",
    ]);
  });
});

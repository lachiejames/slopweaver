/*
 * What the `applyRowEvent` round-trip test files share: the two instants, the `started` event a journal opens on,
 * the seed that puts earlier events on disk before the write under test, and the throwaway runs directories each
 * case writes a journal into, removed after every case by the `afterEach` that `useRunsDirs()` registers.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";

/** The instant a seeded journal's events carry. */
export const AT = "2026-09-07T10:00:00.000Z";
/** An hour after {@link AT}: the instant a write under test usually carries. */
export const LATER = "2026-09-07T11:00:00.000Z";

const dirs: string[] = [];

/** Register the `afterEach` that removes every runs directory minted in the case. Call it once per test file. */
export function useRunsDirs(): void {
  afterEach(() => {
    while (dirs.length > 0) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop guard proves an entry is there; a guard would add a branch the old in-file cleanup never had
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway runs directory, removed after the test that minted it.
 *
 * @returns the new directory's absolute path
 */
export function runsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rowevent-"));
  dirs.push(dir);
  return dir;
}

/** Seed a journal with events that were already on disk before the write under test. */
export function seed({ dir, slug, events }: { dir: string; slug: string; events: readonly RunEvent[] }): void {
  writeFileSync(join(dir, `${slug}.jsonl`), events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
}

/** The `started` event a seeded journal opens on. */
export const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc123", kind: "started" };

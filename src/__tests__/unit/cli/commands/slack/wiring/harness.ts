/*
 * What the Slack wiring test files share: the throwaway homes each case asks from (removed after every case by the
 * `afterEach` that `useFreshHomes()` registers), the in-memory HUMAN override roster at its seeded revision, and the
 * writer and row shape for the DERIVED roster that `derive` persists. It moved here when `slack/wiring.test.ts` was
 * split by behaviour.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach } from "vitest";

import { silverIdentitiesPath } from "../../../../../../corpus/corpusPaths.js";
import type { IdentityRecord } from "../../../../../../silver/identity.js";
import type { IdentityRosterPort } from "../../../../../../silver/identityRoster.js";
import { memoryIdentityRosterPort } from "../../../../../identityRosterFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useFreshHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A real temp home with real files, read back — a fixture round-trip, not a mock.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function freshHome({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
}

/** The revision a seeded in-memory roster row is read at. */
export const ROSTER_REVISION = 1;

/**
 * The HUMAN override roster as the store's row (revision {@link ROSTER_REVISION}), over an in-memory store.
 *
 * @returns an in-memory roster port seeded with the given human records
 */
export function rosterPort({ records = [] }: { records?: readonly IdentityRecord[] }): IdentityRosterPort {
  return memoryIdentityRosterPort({ records });
}

/** Write the DERIVED roster exactly where `derive` writes it. */
export function writeDerived({ home, value }: { home: string; value: unknown }): void {
  const path = silverIdentitiesPath({ home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

/**
 * One derived person carrying a Slack identity, in the real persisted shape.
 *
 * @returns a persisted-shape person row with a github identity, plus a slack one when `slackId` is given
 */
export function derivedPerson({
  id,
  handle,
  slackId,
}: {
  id: string;
  handle: string;
  slackId?: string;
}): Record<string, unknown> {
  return {
    confidence: "email",
    displayName: handle,
    id,
    identities: [
      { handle: `${handle}-gh`, nativeId: `${handle}-gh`, source: "github" },
      ...(slackId === undefined ? [] : [{ handle, nativeId: slackId, source: "slack" }]),
    ],
    kind: "person",
  };
}

/**
 * The seat the `workstreams` candidate-verb suites share: a throwaway home, a register store, a minted-id counter
 * and a runner that drives one verb with recording seams and a fixed clock.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

import { unwrap } from "#lib/result.js";
import { runWorkstreamsCandidates } from "../../../cli/commands/workstreams/candidates.js";
import { runWorkstreamsCandidatesPut } from "../../../cli/commands/workstreams/candidatesPut.js";
import { runWorkstreamsDefine } from "../../../cli/commands/workstreams/define.js";
import { runWorkstreamsPropose } from "../../../cli/commands/workstreams/propose.js";
import { runWorkstreamsReact, type WorkstreamsReactDeps } from "../../../cli/commands/workstreams/react.js";
import { runWorkstreamsRetitle } from "../../../cli/commands/workstreams/retitle.js";
import { runWorkstreamsWhoFirst } from "../../../cli/commands/workstreams/whoFirst.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import type { StoredWorkstream, WorkstreamRegisterSnapshot } from "../../../workstreams/store/types.js";
import { inMemoryWorkstreamStore } from "../../workstreamStoreFake.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";
import { countingMintId, seededStore } from "../workstreams/storeRegisterFixture.js";

const cleanups: (() => void)[] = [];

/** Remove every scratch home a case minted; each suite calls it from its `afterEach`. */
export function cleanupScratch(): void {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
}

/** The fixed instant every verb run reads as now. */
export const NOW = "2026-10-02T13:30:00.000Z";

/** A throwaway home these verbs may write into — never the ambient home. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-ws-candidates-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** One test's seat: the home its ledgers live in, the store its register lives in, and the ids it mints. */
export interface Seat {
  readonly home: string;
  readonly store: WorkstreamStore;
  readonly mintId: () => string;
}

/** What one verb run wrote to each channel, and what it exited with. */
export interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
}

/**
 * Run one of the verbs with recording seams, a fixed clock and the seat's store — or the one a case hands it.
 * @returns the exit code and every line the verb wrote
 */
export async function run({
  seat,
  store,
  verb,
  rest,
}: {
  seat: Seat;
  store?: WorkstreamStore;
  verb: "candidates" | "candidates-put" | "define" | "propose" | "react" | "retitle" | "who-first";
  rest: readonly string[];
}): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  let runStore = seat.store;
  if (store !== undefined) {
    runStore = store;
  }
  const deps: WorkstreamsReactDeps = {
    mintId: seat.mintId,
    now: () => NOW,
    store: runStore,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  const runners = {
    candidates: runWorkstreamsCandidates,
    "candidates-put": runWorkstreamsCandidatesPut,
    define: runWorkstreamsDefine,
    propose: runWorkstreamsPropose,
    react: runWorkstreamsReact,
    retitle: runWorkstreamsRetitle,
    "who-first": runWorkstreamsWhoFirst,
  } as const;
  return { diagnostics, exit: await runners[verb]({ deps, rest }), out };
}

/**
 * Run each argv tail in turn, never at once: two writers at once would meet the ledgers' lock.
 * @returns one recording per argv tail, in order
 */
export async function runEach({
  seat,
  tries,
  verb,
}: {
  seat: Seat;
  tries: readonly (readonly string[])[];
  verb: "react";
}): Promise<readonly Recorded[]> {
  const recorded: Recorded[] = [];
  for (const rest of tries) {
    recorded.push(await run({ rest, seat, verb }));
  }
  return recorded;
}

/**
 * Write a candidates set through `candidates-put`, and say how it went.
 * @returns the recording of the `candidates-put` run
 */
export async function putCandidates({
  seat,
  value,
}: {
  seat: Seat;
  value: Record<string, unknown>;
}): Promise<Recorded> {
  const file = join(seat.home, "candidates.in.json");
  writeFileSync(file, JSON.stringify(value));
  return run({ rest: ["--file", file, "--home", seat.home], seat, verb: "candidates-put" });
}

/**
 * A seat over the acme register, with no candidates written yet.
 * @returns the seat
 */
export async function registered(): Promise<Seat> {
  return { home: scratch(), mintId: countingMintId(), store: await seededStore({ nowIso: NOW }) };
}

/**
 * A seat holding the acme register and the fixture candidates.
 * @returns the seat
 */
export async function seeded(): Promise<Seat> {
  const seat = await registered();
  expect((await putCandidates({ seat, value: validCandidates() })).exit).toBe(EXIT_OK);
  return seat;
}

/**
 * A seat with nothing at all: no register, no candidates.
 * @returns the seat
 */
export function empty(): Seat {
  return { home: scratch(), mintId: countingMintId(), store: inMemoryWorkstreamStore({ nowIso: NOW }) };
}

/**
 * A fresh install: candidates mined, no register yet.
 * @returns the seat
 */
export async function fresh(): Promise<Seat> {
  const seat = empty();
  expect((await putCandidates({ seat, value: validCandidates() })).exit).toBe(EXIT_OK);
  return seat;
}

/**
 * One candidate out of `workstreams candidates --json`, by id rather than position — stated ones list first.
 * @returns the candidate as the document lists it
 */
export async function listedCandidate({ seat, id }: { seat: Seat; id: string }): Promise<Record<string, unknown>> {
  const listed = JSON.parse((await run({ rest: ["--home", seat.home, "--json"], seat, verb: "candidates" })).out[0]!);
  return listed.candidates.find((one: { id: string }) => one.id === id);
}

/**
 * The register as the seat's store holds it.
 * @returns the register snapshot
 */
export async function registerOf({ seat }: { seat: Seat }): Promise<WorkstreamRegisterSnapshot> {
  return unwrap(await seat.store.read({ home: seat.home }));
}

/**
 * The register's workstream ids as stored, in the store's id order.
 * @returns the ids
 */
export async function registerIds({ seat }: { seat: Seat }): Promise<readonly string[]> {
  return (await registerOf({ seat })).workstreams.map((one) => one.id);
}

/**
 * One workstream as stored.
 * @returns the stored workstream
 */
export async function storedOf({ seat, id }: { seat: Seat; id: string }): Promise<StoredWorkstream> {
  return (await registerOf({ seat })).workstreams.find((one) => one.id === id)!;
}

/**
 * The text of a stored workstream's last entry, by position.
 * @returns the entry text
 */
export function lastEntryText({ stored }: { stored: StoredWorkstream }): string {
  return stored.entries.toSorted((a, b) => a.position - b.position).at(-1)!.text;
}

/*
 * What the `proposal` register verb-body test files share: the fixed clock, the argv every verb parses, the
 * throwaway home a case writes into, the deps that collect every line a verb prints, and the one registered
 * proposal most cases start from.
 *
 * `useRegisterHomes()` registers the `afterEach` that removes every home `tempHome()` minted, so call it once at
 * the top of a test file that mints one. Per `testing.md`, every write goes to a `home` a case minted — never the
 * ambient one. It moved here when the register verbs' one test file was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import type { ProposalRegisterDeps } from "../../../../../../cli/commands/proposal/registerRun.js";
import { unwrap } from "../../../../../../lib/result.js";
import { appendRegisterEvent } from "../../../../../../outbound/proposal/register/store.js";

/** The instant every verb's `now` dep answers, so a stamped event is exact. */
export const NOW: Date = new Date("2026-08-22T02:00:00.000Z");

/**
 * Build the argv a `proposal <verb>` invocation parses.
 *
 * @returns the node and binary prefix, then `proposal`, the verb and its tail
 */
export function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", verb, ...rest];
}

// Every fixture directory the importing test file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/**
 * Register the hook that removes every home {@link tempHome} minted, after each case. Call it once, at the top of
 * a test file whose cases mint one.
 */
export function useRegisterHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * Mint one throwaway state home, removed by the hook {@link useRegisterHomes} registers.
 *
 * @returns the new directory's absolute path
 */
export function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-register-run-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * The deps a verb runs over, with the lines it prints on each stream collected.
 *
 * @returns the deps, and the stdout and stderr lines they collect in order
 */
export function harness(): { deps: ProposalRegisterDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { deps: { err: (line) => err.push(line), now: () => NOW, out: (line) => out.push(line) }, err, out };
}

/** Register one strawman proposal, published to a fixture Notion page, under `slug` in `home`. */
export function seedRegistered({ home, slug }: { home: string; slug: string }): void {
  unwrap(
    appendRegisterEvent({
      event: {
        atIso: "2026-08-01T00:00:00.000Z",
        kind: "created",
        address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
        source: "publish",
        title: "A proposal",
      },
      home,
      slug,
    }),
  );
}

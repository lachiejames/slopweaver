/**
 * The rescan that recovers chain links from the transcripts themselves, over the throwaway `~/.claude` in
 * `./chainReadHarness.ts`.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { missingLinks, scanSupervisorChain } from "../../../supervisor/chainScan.js";
import { CHAIN, claudeHome, cleanScratch, NEW, OLD } from "./chainReadHarness.js";

afterEach(cleanScratch);

describe("scanSupervisorChain", () => {
  it("recovers exactly the sessions that invoked the supervisor skill, oldest first", () => {
    const claude = claudeHome();

    const scanned = unwrap(scanSupervisorChain({ projectsDir: join(claude, "projects") }));

    expect(scanned.links.map((link) => link.session.id)).toEqual([OLD, NEW]);
    expect(scanned.links.map((link) => link.source)).toEqual(["scan", "scan"]);
    expect(scanned.transcriptsRead).toBe(3);
    expect(scanned.problems).toEqual([]);
  });

  it("dates a recovered link from the session's first record, since a scan cannot see the pin move", () => {
    const claude = claudeHome();

    const scanned = unwrap(scanSupervisorChain({ projectsDir: join(claude, "projects") }));

    expect(scanned.links[0]!.pinnedAtIso).toBe("2026-09-04T22:00:05.000Z");
  });

  it("offers only the links the journal does not already hold", () => {
    const claude = claudeHome();
    const scanned = unwrap(scanSupervisorChain({ projectsDir: join(claude, "projects") }));

    expect(missingLinks({ found: scanned.links, known: [CHAIN[0]!] }).map((link) => link.session.id)).toEqual([NEW]);
  });

  it("says when the projects directory cannot be listed at all", () => {
    const result = scanSupervisorChain({ projectsDir: join(tmpdir(), "slopweaver-chain-absent-projects") });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("slopweaver-chain-absent-projects");
  });
});

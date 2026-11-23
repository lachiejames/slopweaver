/**
 * The checks-read gate — what makes a run refuse to close, and every case that is deliberately not one.
 *
 * The register read is a SEAM here rather than a mock: `checksReadGateRefuses` takes `readRegister`
 * precisely so the unreadable-register branch is reachable without chmodding a directory, and
 * `.claude/rules/testing.md` bans the mock that faking one would otherwise need. The journal is a real file
 * in a temp directory, because the branch the gate scopes by is what it reads out of one.
 *
 * Four properties, each a line of the rule this encodes:
 *
 * - a raise on this run's branch that nothing has read REFUSES the close;
 * - a raise on somebody else's branch does not, which is what makes an install-wide register safe;
 * - an unreadable register refuses rather than passing, so an outage can never answer "nothing outstanding";
 * - the break-glass works, and a run that was never started is never asked at all.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checksReadGateRefuses } from "../../../../../cli/commands/handover/checksReadGate.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { hatchEnvVar } from "../../../../../hatch/types.js";
import { err, ok } from "../../../../../lib/result.js";
import {
  type ChecksRaisedRecord,
  ChecksReadErrors,
  type ChecksReadRow,
} from "../../../../../outbound/github/checksReadLedger.js";

const SLUG = "a-row";
const BRANCH = "pr-raised-means-checks-read-once";
const ALLOW_UNREAD_CHECKS = hatchEnvVar({ suffix: "UNREAD_CHECKS" });

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
  delete process.env[ALLOW_UNREAD_CHECKS];
});

/** A runs directory holding one journal, started on {@link BRANCH} unless the case says otherwise. */
function runsDir({ started = true }: { started?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sw-crg-"));
  const dir = join(root, "runs");
  mkdirSync(dir, { recursive: true });
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  if (started) {
    appendRunEvent({
      event: { atIso: "2026-08-31T01:00:00.000Z", branch: BRANCH, docHash: "h", kind: "started" },
      runsDir: dir,
      slug: SLUG,
    });
  }
  return dir;
}

function raise({ branch = BRANCH }: { branch?: string } = {}): ChecksRaisedRecord {
  return {
    atIso: "2026-08-31T01:30:00.000Z",
    branch,
    headSha: "46cf2efe65",
    kind: "raised",
    number: 16415,
    repo: "acme/acme-admin",
  };
}

/** A reader that answers with exactly these rows. */
function holding({ rows }: { rows: readonly ChecksReadRow[] }) {
  return () => ok(rows);
}

describe("checksReadGateRefuses", () => {
  it("refuses a close while a raise on this run's branch has never been read", () => {
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows: [raise()] }),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(true);
  });

  it("allows a close once a later read discharges the raise", () => {
    const rows: readonly ChecksReadRow[] = [
      raise(),
      {
        atIso: "2026-08-31T02:00:00.000Z",
        headSha: "46cf2efe65",
        kind: "read",
        number: 16415,
        repo: "acme/acme-admin",
        rollup: "FAILURE",
      },
    ];
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows }),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(false);
  });

  it("ignores a raise on another session's branch", () => {
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows: [raise({ branch: "somebody-else" })] }),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "settle",
    });
    expect(refused).toBe(false);
  });

  it("allows a close when the register holds nothing at all", () => {
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows: [] }),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(false);
  });

  it("refuses when the register exists and cannot be read, rather than reading that as nothing outstanding", () => {
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: () => err(ChecksReadErrors.unreadable({ cause: "permission denied", path: "/x" })),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(true);
  });

  it("lets the break-glass through an unreadable register, which is when a session most needs one", () => {
    process.env[ALLOW_UNREAD_CHECKS] = "1";
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: () => err(ChecksReadErrors.unreadable({ cause: "permission denied", path: "/x" })),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(false);
  });

  it("lets the break-glass through an outstanding raise", () => {
    process.env[ALLOW_UNREAD_CHECKS] = "1";
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows: [raise()] }),
      runsDir: runsDir(),
      slug: SLUG,
      verb: "finish",
    });
    expect(refused).toBe(false);
  });

  it("never asks a run that was never started, even with a raise standing", () => {
    const refused = checksReadGateRefuses({
      home: "/unused",
      readRegister: holding({ rows: [raise()] }),
      runsDir: runsDir({ started: false }),
      slug: SLUG,
      verb: "settle",
    });
    expect(refused).toBe(false);
  });
});

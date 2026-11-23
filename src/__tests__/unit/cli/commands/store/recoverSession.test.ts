/**
 * `store recover`'s hold on the destination: the master password is asked for once and only when a step needs
 * it, and no step reads a backup the session has not opened.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { backupSession, recoverReader, stepFailed } from "../../../../../cli/commands/store/recoverSession.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { localDirectoryTransport } from "../../../../../store/backup/localDirectoryTransport.js";
import { RecoverErrors } from "../../../../../store/backup/recoverErrors.js";

const PASSWORD = "abcdefghijklmnopqrstuvwxyz";
const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway parent holding a home and an empty destination beside it.
 *
 * @returns both paths
 */
function world(): { home: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), "recover-session-"));
  minted.push(parent);
  const home = join(parent, "home");
  const root = join(parent, "backups");
  mkdirSync(join(home, "secrets"), { recursive: true });
  mkdirSync(root);
  return { home, root };
}

describe("stepFailed", () => {
  it("is the recovery's own step failure, naming the step", () => {
    expect(stepFailed({ reasons: ["gone"], step: "reading the backup" })).toEqual(
      RecoverErrors.stepFailed({ reasons: ["gone"], step: "reading the backup" }),
    );
  });
});

describe("backupSession", () => {
  it("asks for the master password once, however many steps need it", async () => {
    const { root } = world();
    let asked = 0;
    const session = backupSession({
      prompt: () => {
        asked += 1;
        return Promise.resolve(PASSWORD);
      },
      reader: { plain: localDirectoryTransport({ root, rootPolicy: "require-existing" }), root },
    });
    expect(asked).toBe(0);
    expect([await session.masterPassword(), await session.masterPassword()]).toEqual([PASSWORD, PASSWORD]);
    expect(asked).toBe(1);
  });

  it("refuses a read of a backup it never opened", () => {
    const { root } = world();
    const session = backupSession({
      prompt: () => Promise.resolve(PASSWORD),
      reader: { plain: localDirectoryTransport({ root, rootPolicy: "require-existing" }), root },
    });
    expect(unwrapErr(session.opened())).toEqual(
      RecoverErrors.stepFailed({ reasons: ["the backup was not opened before this step"], step: "reading the backup" }),
    );
  });

  it("names the master-password step when the chosen backup cannot be opened", async () => {
    const { root } = world();
    const session = backupSession({
      prompt: () => Promise.resolve(PASSWORD),
      reader: { plain: localDirectoryTransport({ root, rootPolicy: "require-existing" }), root },
    });
    const refused = unwrapErr(await session.open({ prefix: "slopweaver/2026-11-07T03-00-00Z/" }));
    expect(refused.code).toBe("RECOVER_STEP_FAILED");
    expect(refused.message).toContain("opening the backup with the master password");
    expect(unwrapErr(session.opened()).message).toContain("the backup was not opened before this step");
  });
});

describe("recoverReader", () => {
  it("reads the named destination through a plain transport, with no key", () => {
    const { home, root } = world();
    const reader = unwrap(recoverReader({ home, override: root }));
    expect(reader.root).toBe(root);
    expect(Object.keys(reader.plain).toSorted()).toEqual(
      Object.keys(localDirectoryTransport({ root, rootPolicy: "require-existing" })).toSorted(),
    );
  });
});

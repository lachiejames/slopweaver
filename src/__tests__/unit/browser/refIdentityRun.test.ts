import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import type { PageObservation } from "../../../browser/interactionSession.js";
import { citedElements, refuseARenamedRef } from "../../../browser/refIdentityRun.js";
import type { TerminalReply } from "../../../browser/terminalClient.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CITED = '- status "loading" [ref=f10e2]';
const ADMITTED = '- button "Continue with email" [ref=f10e2] [cursor=pointer]';
const CLICK = { expectFocus: undefined, kind: "click", target: "f10e2", value: undefined } as const;

/**
 * One admission reply, printed inline or filed.
 *
 * @param over the fields that differ from a reply naming a page and printing nothing
 * @returns the reply
 */
function reply(over: Partial<TerminalReply>): TerminalReply {
  return {
    modalState: null,
    pageTitle: "Sign in",
    pageUrl: "https://claude.ai/login",
    snapshotPath: null,
    snapshotYaml: null,
    stdout: "",
    ...over,
  };
}

describe("citedElements and refuseARenamedRef", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "ref-identity-"));
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  /**
   * A look filed the way `browser read` files one.
   *
   * @param yaml the snapshot it filed, or `undefined` to name a file that was never written
   * @returns the observation
   */
  function observation({ yaml }: { yaml: string | undefined }): PageObservation {
    const snapshotPath = join(workspace, "observation-1.yml");
    if (yaml !== undefined) {
      writeFileSync(snapshotPath, `${yaml}\n`);
    }
    return {
      id: "o-1",
      observedAtIso: "2026-09-25T00:00:00.000Z",
      screenshotPath: null,
      snapshotPath,
      title: "Sign in",
      url: "https://claude.ai/login",
    };
  }

  it("reads back what the cited look filed", () => {
    expect(unwrap(citedElements({ observation: observation({ yaml: CITED }) }))).toBe(`${CITED}\n`);
  });

  it("answers null when nothing is cited", () => {
    expect(unwrap(citedElements({ observation: undefined }))).toBeNull();
  });

  it("refuses a cited look whose filed snapshot is gone, rather than skipping the comparison", () => {
    expect(unwrapErr(citedElements({ observation: observation({ yaml: undefined }) }))).toEqual(
      BrowserActionErrors.observationUnusable({ because: "elements-unreadable" }),
    );
  });

  it("refuses a click whose ref the admission's inline read shows on another element", () => {
    const refused = refuseARenamedRef({
      admitted: reply({ snapshotYaml: ADMITTED }),
      observedYaml: CITED,
      request: CLICK,
      workspace,
    });
    expect(unwrapErr(refused)).toEqual(
      BrowserActionErrors.refNamesAnotherElement({
        admitted: 'button "Continue with email"',
        observed: 'status "loading"',
        ref: "f10e2",
      }),
    );
  });

  it("reads a filed admission snapshot relative to the session's workspace", () => {
    mkdirSync(join(workspace, ".playwright-cli"));
    writeFileSync(join(workspace, ".playwright-cli", "page-1.yml"), ADMITTED);
    const refused = refuseARenamedRef({
      admitted: reply({ snapshotPath: ".playwright-cli/page-1.yml" }),
      observedYaml: CITED,
      request: CLICK,
      workspace,
    });
    expect(unwrapErr(refused).code).toBe("REF_NAMES_ANOTHER_ELEMENT");
  });

  it("fails as a client failure when the filed admission snapshot cannot be read back", () => {
    const refused = refuseARenamedRef({
      admitted: reply({ snapshotPath: ".playwright-cli/missing.yml" }),
      observedYaml: CITED,
      request: CLICK,
      workspace,
    });
    expect(unwrapErr(refused).message).toContain("was filed at .playwright-cli/missing.yml and could not be read back");
  });

  it("passes a ref that still names what it named", () => {
    const passed = refuseARenamedRef({
      admitted: reply({ snapshotYaml: '- status "loading" [active] [ref=f10e2]' }),
      observedYaml: CITED,
      request: CLICK,
      workspace,
    });
    expect(unwrap(passed)).toBeNull();
  });

  it("compares nothing when the action cites no read, and never reads the admission's file", () => {
    const passed = refuseARenamedRef({
      admitted: reply({ snapshotPath: ".playwright-cli/missing.yml" }),
      observedYaml: null,
      request: CLICK,
      workspace,
    });
    expect(unwrap(passed)).toBeNull();
  });

  it("gives no verdict on a page that printed no snapshot at all", () => {
    const passed = refuseARenamedRef({ admitted: reply({}), observedYaml: CITED, request: CLICK, workspace });
    expect(unwrap(passed)).toBeNull();
  });
});

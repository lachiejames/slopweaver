/**
 * The outbound privacy check at the Linear write transport, through the real `makeLinearWriteApi` and a real
 * private-terms file under a throwaway home. The `request` option is a counting seam rather than a mock, so a refused
 * mutation is seen to send nothing and a clean one to send exactly once.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionLinearAttachDeps } from "../../../../cli/commands/linear/attachDeps.js";
import { productionLinearWriteDeps } from "../../../../cli/commands/linear/writeDeps.js";
import { makeLinearWriteApi } from "../../../../corpus/linear/write.js";
import { unwrap } from "../../../../lib/result.js";
import { refusedBeforeWire } from "../../../../outbound/linear/sendFailure.js";
import {
  type LinearWritePrivacy,
  linearUploadPrivacyRefusal,
  linearWritePrivacy,
  READ_ONLY_LINEAR_PRIVACY,
} from "../../../../outbound/linear/writePrivacy.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "linear-write-privacy-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

const ISSUE = {
  description: "d",
  id: "uuid-1",
  identifier: "AAA-1",
  title: "t",
  updatedAt: "2026-08-02T10:00:00.000Z",
  url: "https://linear.test/AAA-1",
};

/** A real Linear write API over `privacy` whose every request goes to a counting transport. */
function countingApi({ privacy }: { privacy: LinearWritePrivacy }) {
  let calls = 0;
  const api = makeLinearWriteApi({
    privacy,
    request: () => {
      calls += 1;
      return Promise.resolve({ issue: ISSUE, issueCreate: { issue: { id: "uuid-1" }, success: true } });
    },
    scheduler: (task) => task(),
    token: "lin_api_fake",
  });
  return { api, calls: () => calls };
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];

describe("the Linear write transport's privacy guard", () => {
  it("refuses a mutation whose variables carry a private term before any request, naming locus and class only", async () => {
    const { api, calls } = countingApi({ privacy: linearWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const result = await api.createIssue({ id: "uuid-1", input: { teamId: "t1", title: "for Quillfeather" } });
    expect(result.isErr()).toBe(true);
    const message = result._unsafeUnwrapErr().message;
    expect(message).toContain("linear linear.issueCreate input.title line 1: a private person term (redacted here)");
    expect(message).not.toMatch(/quillfeather/iu);
    expect(calls()).toBe(0);
  });

  it("is read as refused before the wire through the IngestError the transport returns", async () => {
    const { api } = countingApi({ privacy: linearWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const result = await api.createIssue({ id: "uuid-1", input: { title: "for quillfeather" } });
    expect(refusedBeforeWire({ error: result._unsafeUnwrapErr() })).toBe(true);
  });

  it("sends a clean mutation exactly once", async () => {
    const { api, calls } = countingApi({ privacy: linearWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const result = await api.createIssue({ id: "uuid-1", input: { teamId: "t1", title: "the build is green" } });
    expect(unwrap(result)).toEqual({ id: "uuid-1" });
    expect(calls()).toBe(1);
  });

  it("refuses every mutation when the private-terms file is absent, and still sends a query", async () => {
    const { api, calls } = countingApi({ privacy: linearWritePrivacy({ home: homeWith({ rows: undefined }) }) });
    const refused = await api.createIssue({ id: "uuid-1", input: { title: "clean" } });
    expect(refused._unsafeUnwrapErr().message).toContain("does not exist, so no outbound write is checked for them");
    const read = await api.readIssue({ id: "uuid-1" });
    expect(unwrap(read)!.identifier).toBe("AAA-1");
    expect(calls()).toBe(1);
  });

  it("refuses a later mutation once the private-terms file is gone, never reusing an earlier load", async () => {
    const home = homeWith({ rows: PERSON });
    const { api, calls } = countingApi({ privacy: linearWritePrivacy({ home }) });
    await api.createIssue({ id: "uuid-1", input: { title: "clean" } });
    rmSync(stateHomePaths({ home }).privateTerms);
    const second = await api.createIssue({ id: "uuid-2", input: { title: "clean" } });
    expect(second._unsafeUnwrapErr().message).toContain("does not exist");
    expect(calls()).toBe(1);
  });

  it("gives a read-only client its queries and refuses any mutation through it", async () => {
    const { api, calls } = countingApi({ privacy: READ_ONLY_LINEAR_PRIVACY });
    await api.readIssue({ id: "uuid-1" });
    const refused = await api.createIssue({ id: "uuid-1", input: { title: "clean" } });
    expect(refused._unsafeUnwrapErr().message).toContain("this Linear client was built to read, so it sends no write");
    expect(calls()).toBe(1);
  });
});

describe("the verb's own home reaches the capability", () => {
  it("judges each production client under the home it was built with, not the ambient one", async () => {
    // Both refuse before the wire, so nothing here reaches Linear: the difference between the two refusals is
    // which home's terms file was read.
    const withTerms = homeWith({ rows: PERSON });
    const withoutTerms = homeWith({ rows: undefined });
    const deps = productionLinearWriteDeps();
    const fromTerms = await deps
      .makeApi({ home: withTerms, token: "lin_api_fake" })
      .createIssue({ id: "uuid-1", input: { title: "for quillfeather" } });
    const fromAbsent = await deps
      .makeApi({ home: withoutTerms, token: "lin_api_fake" })
      .createIssue({ id: "uuid-1", input: { title: "for quillfeather" } });
    expect(fromTerms._unsafeUnwrapErr().message).toContain("a private person term (redacted here)");
    expect(fromAbsent._unsafeUnwrapErr().message).toContain("does not exist");
  });

  it("gives the attach verb the policy of the home it names", async () => {
    const privacy = productionLinearAttachDeps().privacy({ home: homeWith({ rows: PERSON }) });
    const refusal = await linearUploadPrivacyRefusal({
      bytes: new TextEncoder().encode("notes"),
      fileName: "quillfeather.txt",
      privacy,
    });
    expect(refusal).toContain("linear attach upload fileName line 1: a private person term (redacted here)");
  });
});

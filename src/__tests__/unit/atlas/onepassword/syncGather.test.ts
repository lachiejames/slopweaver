/*
 * The two gather halves called directly with their credential absent, with no `op`, no Events API and no
 * home: each marks its own kinds `not-configured`, keeps the stored file, and records why.
 */
import { describe, expect, it } from "vitest";

import {
  ONEPASSWORD_SIGNIN_STEP,
  type OnepasswordEventsCredentials,
} from "../../../../atlas/onepassword/credentials.js";
import {
  emptyOnepasswordKindFile,
  type OnepasswordKind,
  type OnepasswordKindFile,
} from "../../../../atlas/onepassword/model.js";
import {
  gatherAdminKinds,
  gatherEventsKind,
  type OnepasswordEventsClientBuilder,
} from "../../../../atlas/onepassword/syncGather.js";
import { err, type Result, unwrap } from "../../../../lib/result.js";

const AT = "2026-09-06T02:00:00.000Z";

/** Every kind's stored file, empty, as a first run reads them. */
const emptyStore = (): Record<OnepasswordKind, OnepasswordKindFile> => ({
  event: emptyOnepasswordKindFile({ kind: "event", updatedAt: AT }),
  group: emptyOnepasswordKindFile({ kind: "group", updatedAt: AT }),
  "group-member": emptyOnepasswordKindFile({ kind: "group-member", updatedAt: AT }),
  integration: emptyOnepasswordKindFile({ kind: "integration", updatedAt: AT }),
  user: emptyOnepasswordKindFile({ kind: "user", updatedAt: AT }),
  vault: emptyOnepasswordKindFile({ kind: "vault", updatedAt: AT }),
  "vault-grant": emptyOnepasswordKindFile({ kind: "vault-grant", updatedAt: AT }),
});

/** A builder the credential-absent branch must never reach: reaching it fails the test. */
const neverBuilt: OnepasswordEventsClientBuilder = () => {
  throw new Error("the Events API client was built with no credential");
};

describe("the halves a 1Password sync gathers", () => {
  it("marks every roster kind not-configured, in dependency order, when there is no op session", () => {
    const storedFiles = emptyStore();

    const results = unwrap(gatherAdminKinds({ at: AT, onProgress: () => {}, runOp: null, storedFiles }));

    expect(results.map((result) => result.kind)).toEqual([
      "user",
      "group",
      "group-member",
      "vault",
      "vault-grant",
      "integration",
    ]);
    expect(results.map((result) => result.complete)).toEqual(results.map(() => false));
    expect(results.map((result) => result.entityCount)).toEqual(results.map(() => 0));
    expect(results.map((result) => result.reasons)).toEqual(
      results.map(() => [`no usable \`op\` session - ${ONEPASSWORD_SIGNIN_STEP}`]),
    );
    expect(results.map((result) => result.file)).toEqual(results.map((result) => storedFiles[result.kind]));
  });

  it("marks the event kind not-configured with every credential reason, and builds no client", async () => {
    const storedFiles = emptyStore();
    const eventsCredentials: Result<OnepasswordEventsCredentials> = err(["no token stored", "no region set"]);

    const result = unwrap(
      await gatherEventsKind({
        at: AT,
        buildEventsClient: neverBuilt,
        eventsCredentials,
        onProgress: () => {},
        since: AT,
        storedFiles,
      }),
    );

    expect(result).toEqual({
      complete: false,
      entityCount: 0,
      file: storedFiles.event,
      kind: "event",
      reasons: ["no token stored; no region set"],
    });
    expect(result.file).toBe(storedFiles.event);
  });
});

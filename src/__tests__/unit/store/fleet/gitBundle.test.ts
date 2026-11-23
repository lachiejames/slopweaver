/**
 * Reading a git bundle's objects so the authored leg can scan what the pack carries — built here from its
 * documented byte layout, so each case controls exactly what the pack holds.
 */
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { projectAuthoredFile } from "../../../../store/fleet/authoredFile.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";
import { gitBundleObjects, isGitBundle } from "../../../../store/fleet/gitBundle.js";

const WHEN = new Date("2026-09-25T01:02:03.004Z");

/** One pack object: its type-and-size varint, an optional base reference, then its deflated body. */
function packObject({ type, body, base = [] }: { type: number; body: Buffer; base?: readonly number[] }): Buffer {
  const header: number[] = [];
  let size = body.length;
  let first = (type << 4) | (size & 0x0f);
  size >>= 4;
  while (size > 0) {
    header.push(first | 0x80);
    first = size & 0x7f;
    size >>= 7;
  }
  header.push(first);
  return Buffer.concat([Buffer.from(header), Buffer.from(base), deflateSync(body)]);
}

/** A v2 bundle holding the given objects. */
function bundleOf({ objects }: { objects: readonly Buffer[] }): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(objects.length);
  return Buffer.concat([
    Buffer.from(`# v2 git bundle\n${"a".repeat(40)} refs/heads/x\n\nPACK`, "latin1"),
    Buffer.from([0, 0, 0, 2]),
    count,
    ...objects,
    Buffer.alloc(20),
  ]);
}

describe("isGitBundle", () => {
  it("knows a bundle by its header, and nothing else by accident", () => {
    expect(isGitBundle({ bytes: bundleOf({ objects: [] }) })).toBe(true);
    expect(isGitBundle({ bytes: Buffer.from("# v2 git bundles are great\n") })).toBe(false);
  });
});

describe("gitBundleObjects", () => {
  it("inflates every object in pack order, a blob and both delta kinds alike", () => {
    const bundle = bundleOf({
      objects: [
        packObject({ body: Buffer.from("a blob body\n"), type: 3 }),
        packObject({ base: [0x05], body: Buffer.from("offset delta insert"), type: 6 }),
        packObject({ base: Array.from({ length: 20 }, () => 7), body: Buffer.from("ref delta insert"), type: 7 }),
      ],
    });

    const objects = unwrap(gitBundleObjects({ bytes: bundle }));

    expect(objects.map((object) => object.toString("utf8"))).toEqual([
      "a blob body\n",
      "offset delta insert",
      "ref delta insert",
    ]);
  });

  it("reads a size that needs more than one varint byte", () => {
    const body = Buffer.from("x".repeat(300));

    expect(unwrap(gitBundleObjects({ bytes: bundleOf({ objects: [packObject({ body, type: 3 })] }) }))[0]).toEqual(
      body,
    );
  });

  it("refuses a pack that ends before its objects do, rather than returning fewer", () => {
    const whole = bundleOf({ objects: [packObject({ body: Buffer.from("one"), type: 3 })] });
    const count = whole.indexOf("PACK", 0, "latin1") + 8;
    whole.writeUInt32BE(2, count);

    expect(unwrapErr(gitBundleObjects({ bytes: whole })).reason).toContain("object 2 of 2 would not inflate");
  });

  it("refuses a bundle with no packfile", () => {
    expect(unwrapErr(gitBundleObjects({ bytes: Buffer.from("# v2 git bundle\nno pack here") }))).toEqual(
      FleetImportErrors.unreadableGitBundle({ reason: "no packfile follows the bundle header" }),
    );
  });
});

describe("a git bundle through the authored projection", () => {
  it("refuses a bundle whose COMPRESSED objects carry a credential the raw bytes hide", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const bundle = bundleOf({ objects: [packObject({ body: Buffer.from(`export T=${token}\n`), type: 3 })] });

    expect(bundle.includes(token)).toBe(false);
    expect(
      unwrapErr(
        projectAuthoredFile({
          bytes: bundle,
          denylist: [],
          fileModifiedAt: WHEN,
          relativePath: "worktree-bundles/x.bundle",
        }),
      ).message,
    ).toBe(
      "worktree-bundles/x.bundle is not stored as authored working state: pack object 1, line 1 trips the github-oauth-token secret class, and the store's dump leaves this machine",
    );
  });

  it("stores a clean bundle, marked a bundle", () => {
    const bundle = bundleOf({ objects: [packObject({ body: Buffer.from("clean\n"), type: 3 })] });

    const projected = unwrap(
      projectAuthoredFile({
        bytes: bundle,
        denylist: [],
        fileModifiedAt: WHEN,
        relativePath: "worktree-bundles/x.bundle",
      }),
    );

    expect(projected.bundle).toBe(true);
    expect(projected.binary).toBe(true);
  });

  it("refuses a bundle it cannot inflate, rather than storing it unchecked", () => {
    const bundle = Buffer.concat([
      Buffer.from("# v2 git bundle\n\nPACK", "latin1"),
      Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 0x33, 1, 2, 3]),
    ]);

    expect(
      unwrapErr(
        projectAuthoredFile({
          bytes: bundle,
          denylist: [],
          fileModifiedAt: WHEN,
          relativePath: "worktree-bundles/bad.bundle",
        }),
      ).message,
    ).toContain("is a git bundle whose pack cannot be inflated to scan");
  });
});

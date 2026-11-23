import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bodyPath,
  bodyRef,
  bodyRefDigest,
  readBody,
  serialiseBody,
  storeBody,
} from "../../../../corpus/notion/bodyStore.js";
import type { NotionMdNode } from "../../../../corpus/notion/markdownNodes.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home, removed after the test that minted it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-body-"));
  homes.push(home);
  return home;
}

/**
 * Put arbitrary bytes in the body store UNDER THEIR OWN DIGEST, and answer with it.
 *
 * What the store would have written for content it never produced — which is how a test reaches the parse
 * and shape checks that sit AFTER the tamper check, without tripping the tamper check on the way.
 */
function plant({ bytes, home }: { bytes: Buffer; home: string }): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = bodyPath({ digest, home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return digest;
}

/** A small tree carrying one of every structural node a re-derivation actually reads. */
const TREE: readonly NotionMdNode[] = [
  { kind: "text", text: "## Runbook\n\nWhen the pool exhausts:" },
  {
    headerColumn: false,
    headerRow: true,
    kind: "table",
    rows: [
      ["symptom", "action"],
      ["timeouts", "cycle it"],
    ],
  },
  { dataSourceUrl: undefined, kind: "childPage", title: "Escalation", url: "https://notion.so/escalation" },
  { kind: "code", language: "sql", text: "select 1 < 2" },
];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("serialiseBody", () => {
  it("is deterministic, so an unchanged body hashes to the same digest on the next run", () => {
    expect(serialiseBody({ tree: TREE }).equals(serialiseBody({ tree: [...TREE] }))).toBe(true);
  });

  it("serialises the empty tree to an empty JSON array rather than to nothing", () => {
    expect(serialiseBody({ tree: [] }).toString("utf8")).toBe("[]");
  });
});

describe("bodyRef", () => {
  it("names the hash in the value it writes on the record", () => {
    expect(bodyRef({ digest: "ab".repeat(32) })).toBe(`sha256:${"ab".repeat(32)}`);
  });

  it("round-trips its own reference", () => {
    const digest = "cd".repeat(32);
    expect(bodyRefDigest({ ref: bodyRef({ digest }) })).toBe(digest);
  });

  it("reads nothing out of a value that is not a body reference", () => {
    expect(bodyRefDigest({ ref: "attachment: sha256:abc" })).toBe(undefined);
    expect(bodyRefDigest({ ref: "file: policy.pdf" })).toBe(undefined);
    expect(bodyRefDigest({ ref: "" })).toBe(undefined);
  });

  it("refuses a reference whose digest is the wrong length or not hex, rather than passing it on", () => {
    expect(bodyRefDigest({ ref: "sha256:abc" })).toBe(undefined);
    expect(bodyRefDigest({ ref: `sha256:${"zz".repeat(32)}` })).toBe(undefined);
    expect(bodyRefDigest({ ref: `sha256:${"AB".repeat(32)}` })).toBe(undefined);
  });
});

describe("storeBody", () => {
  it("stores the tree where the digest says, under the home's own bodies root", () => {
    const home = freshHome();
    const stored = storeBody({ home, tree: TREE });
    expect(stored.deduped).toBe(false);
    expect(stored.path).toBe(bodyPath({ digest: stored.digest, home }));
    expect(stored.path.startsWith(join(home, "corpus", "bodies", "notion"))).toBe(true);
    expect(readFileSync(stored.path, "utf8")).toBe(serialiseBody({ tree: TREE }).toString("utf8"));
  });

  it("writes nothing the second time the same body is read — 2A's idempotent re-pull", () => {
    const home = freshHome();
    const first = storeBody({ home, tree: TREE });
    const second = storeBody({ home, tree: TREE });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.digest).toBe(first.digest);
  });

  it("moves the digest when the body changes, so an edited page is a new row", () => {
    const home = freshHome();
    const before = storeBody({ home, tree: TREE });
    const after = storeBody({ home, tree: [...TREE, { kind: "text", text: "and one more line" }] });
    expect(after.digest === before.digest).toBe(false);
  });

  it("stores an empty body, so a later read can tell 'read and empty' from 'never stored'", () => {
    const home = freshHome();
    const stored = storeBody({ home, tree: [] });
    expect(unwrap(readBody({ digest: stored.digest, home }))).toEqual([]);
  });
});

describe("readBody", () => {
  it("gives back the tree that was stored, structure and all — no Notion call", () => {
    const home = freshHome();
    const stored = storeBody({ home, tree: TREE });
    const read = readBody({ digest: stored.digest, home });
    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toEqual(TREE);
  });

  it("names the missing digest when nothing is stored under it", () => {
    const home = freshHome();
    const read = readBody({ digest: "ef".repeat(32), home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("BODY_MISSING");
    expect(unwrapErr(read).message).toContain("is not in the store");
  });

  it("refuses bytes that do not hash to the name they are stored under", () => {
    // Content-addressing makes the path a CLAIM about the bytes, and nothing enforces that claim after the
    // write — a half-written file, a disk error or a hand-edit all leave one that is false. Read without
    // the check, this returns a tree from a page it did not come from, which is worse than a missing file
    // because it looks fine.
    const home = freshHome();
    const stored = storeBody({ home, tree: TREE });
    writeFileSync(stored.path, serialiseBody({ tree: [{ kind: "text", text: "a different page" }] }));
    const read = readBody({ digest: stored.digest, home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("BODY_DIGEST_MISMATCH");
    expect(unwrapErr(read).message).toContain("the stored bytes are not the ones it names");
  });

  it("says a stored body did not parse rather than throwing at the caller", () => {
    // Stored AT its own digest, so the tamper check passes and the parse failure is what is being tested.
    const home = freshHome();
    const digest = plant({ bytes: Buffer.from("{not json", "utf8"), home });
    const read = readBody({ digest, home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("BODY_UNPARSEABLE");
    expect(unwrapErr(read).message).toContain("did not parse");
  });

  it("refuses a stored document that parses but is not a node array", () => {
    const home = freshHome();
    const digest = plant({ bytes: Buffer.from('{"kind":"text"}', "utf8"), home });
    const read = readBody({ digest, home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("BODY_NOT_A_TREE");
    expect(unwrapErr(read).message).toContain("is not a node array");
  });
});

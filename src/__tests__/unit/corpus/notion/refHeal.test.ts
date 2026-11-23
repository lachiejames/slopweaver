import { describe, expect, it } from "vitest";

import {
  carriesMangledRef,
  healRecordRefs,
  isMangledDigest,
  mangledDigestPattern,
  type RefHealStore,
  resolveMangledDigest,
  type StoredFileFacts,
} from "../../../../corpus/notion/refHeal.js";
import { RefHealErrors } from "../../../../corpus/notion/refHealErrors.js";
import type { CorpusRecord } from "../../../../corpus/types.js";

// A real digest shape with two runs of nine-plus digits, and the form the earlier digit pass left behind.
const DIGEST = "2f9c62af266430130e38918a4d545fa95663514277aa05a2aee060c159ea11e9";
const MANGLED = "2f9c62af[number]e38918a4d545fa[number]aa05a2aee060c159ea11e9";
// A second stored name that shares the literal parts but whose digit runs are too short to be `[number]`.
const DECOY = "2f9c62af2664e38918a4d545fa9566aa05a2aee060c159ea11e9aaaaaaaaaaaa";
const BODY_DIGEST = "ab12345678901cd" + "e".repeat(49);
const BODY_MANGLED = "ab[number]cd" + "e".repeat(49);

/** A fake store over fixed names and facts — a plain seam, not a mock. */
function store({
  attachments,
  bodies = [],
  facts,
}: {
  attachments: readonly string[];
  bodies?: readonly string[];
  facts: Readonly<Record<string, StoredFileFacts>>;
}): RefHealStore {
  return {
    held: ({ kind }) => (kind === "attachment" ? attachments : bodies),
    inspect: ({ digest }) => facts[digest]!,
  };
}

const good = store({
  attachments: [DIGEST, DECOY],
  bodies: [BODY_DIGEST],
  facts: { [BODY_DIGEST]: { sha256: BODY_DIGEST, size: 10 }, [DIGEST]: { sha256: DIGEST, size: 515573 } },
});

/** A Notion page record carrying the given attrs. */
function page({ attrs }: { attrs: NonNullable<CorpusRecord["attrs"]> }): CorpusRecord {
  return {
    attrs,
    container: "notion",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId: "page:0000000000000000000000000000a002:chunk:0",
    text: "body text",
    title: "Support x Diagnostic Providers (1/3)",
    tsIso: "2026-09-10T04:48:00.000Z",
    url: "https://app.notion.com/p/0000000000000000000000000000a002",
  };
}

describe("isMangledDigest", () => {
  it("accepts hex carrying a [number] token", () => {
    expect(isMangledDigest({ digest: MANGLED })).toBe(true);
  });

  it("rejects an intact digest", () => {
    expect(isMangledDigest({ digest: DIGEST })).toBe(false);
  });

  it("rejects a token inside non-hex text", () => {
    expect(isMangledDigest({ digest: "zz[number]" })).toBe(false);
  });
});

describe("mangledDigestPattern", () => {
  it("matches the original and not a name whose digit runs are shorter than nine", () => {
    const pattern = mangledDigestPattern({ mangled: MANGLED });
    expect([DIGEST, DECOY].filter((name) => pattern.test(name))).toEqual([DIGEST]);
  });
});

describe("resolveMangledDigest", () => {
  it("resolves to the one stored file whose size matches the recorded count", () => {
    expect(resolveMangledDigest({ kind: "attachment", mangled: MANGLED, recordedSize: "515573", store: good })).toEqual(
      { digest: DIGEST, size: 515573 },
    );
  });

  it("accepts a carved byte count when the real size has nine or more digits", () => {
    const big = store({ attachments: [DIGEST], facts: { [DIGEST]: { sha256: DIGEST, size: 123456789 } } });
    expect(
      resolveMangledDigest({ kind: "attachment", mangled: MANGLED, recordedSize: "[number]", store: big }),
    ).toEqual({ digest: DIGEST, size: 123456789 });
  });

  it("refuses NO_CANDIDATE when nothing stored matches", () => {
    const empty = store({ attachments: [DECOY], facts: {} });
    const resolved = resolveMangledDigest({ kind: "attachment", mangled: MANGLED, recordedSize: "1", store: empty });
    expect(resolved).toEqual({ error: RefHealErrors.noCandidate({ mangled: MANGLED }) });
    expect(RefHealErrors.noCandidate({ mangled: MANGLED }).message).toBe(
      `sha256:${MANGLED} matches no stored file — only a re-pull of its page can restore it`,
    );
  });

  it("refuses AMBIGUOUS rather than choosing between two matches", () => {
    const twin = "2f9c62af9999999999e38918a4d545fa8888888888aa05a2aee060c159ea11e9";
    const two = store({ attachments: [DIGEST, twin], facts: {} });
    const resolved = resolveMangledDigest({ kind: "attachment", mangled: MANGLED, recordedSize: "1", store: two });
    expect(resolved).toEqual({ error: RefHealErrors.ambiguous({ candidates: [DIGEST, twin], mangled: MANGLED }) });
  });

  it("refuses SIZE_MISMATCH when the file is not the recorded size", () => {
    const resolved = resolveMangledDigest({ kind: "attachment", mangled: MANGLED, recordedSize: "7", store: good });
    expect(resolved).toEqual({
      error: RefHealErrors.sizeMismatch({ actual: 515573, digest: DIGEST, recorded: "7" }),
    });
  });

  it("refuses DIGEST_MISMATCH when the stored bytes do not hash to their name", () => {
    const overwritten = store({ attachments: [DIGEST], facts: { [DIGEST]: { sha256: DECOY, size: 515573 } } });
    const resolved = resolveMangledDigest({
      kind: "attachment",
      mangled: MANGLED,
      recordedSize: "515573",
      store: overwritten,
    });
    expect(resolved).toEqual({ error: RefHealErrors.digestMismatch({ actual: DECOY, digest: DIGEST }) });
  });

  it("resolves a body against the body store only", () => {
    expect(resolveMangledDigest({ kind: "body", mangled: BODY_MANGLED, store: good })).toEqual({
      digest: BODY_DIGEST,
      size: 10,
    });
  });
});

describe("healRecordRefs", () => {
  it("rewrites a carved attachment ref and leaves every other entry untouched", () => {
    const record = page({
      attrs: {
        chunkIndex: 0,
        files: [
          `attachment: sha256:${MANGLED} (515573 bytes)`,
          "attachment: sha256:a6477dd5860ba96a5c2e500335efa82e8c657f725d83387a272b6c4a451824f7 (260524 bytes)",
          "file://elsewhere",
        ],
      },
    });
    const heal = healRecordRefs({ record, store: good });
    expect(heal.healed).toBe(1);
    expect(heal.refusals).toEqual([]);
    expect(heal.record).toEqual({
      ...record,
      attrs: {
        chunkIndex: 0,
        files: [
          `attachment: sha256:${DIGEST} (515573 bytes)`,
          "attachment: sha256:a6477dd5860ba96a5c2e500335efa82e8c657f725d83387a272b6c4a451824f7 (260524 bytes)",
          "file://elsewhere",
        ],
      },
    });
  });

  it("rewrites a carved body ref", () => {
    const heal = healRecordRefs({ record: page({ attrs: { body: `sha256:${BODY_MANGLED}` } }), store: good });
    expect(heal.record.attrs).toEqual({ body: `sha256:${BODY_DIGEST}` });
  });

  it("returns the input record itself when nothing was carved", () => {
    const record = page({ attrs: { body: `sha256:${BODY_DIGEST}` } });
    expect(healRecordRefs({ record, store: good }).record).toBe(record);
  });

  it("keeps a refused ref as it was and reports why", () => {
    const record = page({ attrs: { files: [`attachment: sha256:${MANGLED} (9 bytes)`] } });
    const heal = healRecordRefs({ record, store: good });
    expect(heal.healed).toBe(0);
    expect(heal.record).toBe(record);
    expect(heal.refusals.map((refusal) => refusal.code)).toEqual(["SIZE_MISMATCH"]);
  });
});

describe("carriesMangledRef", () => {
  it("sees a carved attachment ref", () => {
    expect(carriesMangledRef({ record: page({ attrs: { files: [`attachment: sha256:${MANGLED} (1 bytes)`] } }) })).toBe(
      true,
    );
  });

  it("sees a carved body ref", () => {
    expect(carriesMangledRef({ record: page({ attrs: { body: `sha256:${BODY_MANGLED}` } }) })).toBe(true);
  });

  it("passes a record whose refs are intact", () => {
    expect(
      carriesMangledRef({
        record: page({ attrs: { body: `sha256:${BODY_DIGEST}`, files: [`attachment: sha256:${DIGEST} (1 bytes)`] } }),
      }),
    ).toBe(false);
  });
});

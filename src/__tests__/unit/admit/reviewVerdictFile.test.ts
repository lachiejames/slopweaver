import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReviewVerdict } from "../../../admit/reviewVerdictFile.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const DIGEST = `sha256:${"a".repeat(64)}`;

const VERDICT = {
  answerDigest: DIGEST,
  authorSession: "worker",
  claims: [{ evidence: "read the thread", impact: "high", support: "supported", text: "the pool exhausted" }],
  outcome: "clean",
  reviewerSession: "reviewer",
  schemaVersion: 1,
};

/** One fit observation of one attachment — the shape every observation case varies from. */
const OBSERVATION = {
  artifactDigest: DIGEST,
  contextRetained: true,
  legible: true,
  observedContent: "the 15d timeseries, query env:staging, y axis 0 to 40",
  path: "/shots/pool.png",
  targetState: "data",
};

/** The base verdict carrying one observation, with `over` replacing fields of that observation. */
const withObservation = (over: Record<string, unknown>): Record<string, unknown> => ({
  ...VERDICT,
  imageObservations: [{ ...OBSERVATION, ...over }],
});

const written = ({ body }: { body: string }): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-verdict-"));
  fixtureDirs.push(dir);
  const path = join(dir, "verdict.json");
  writeFileSync(path, body, "utf8");
  return path;
};

describe("readReviewVerdict", () => {
  it("reads a complete verdict off disk", () => {
    const result = readReviewVerdict({ path: written({ body: JSON.stringify(VERDICT) }) });

    expect(result.isOk()).toBe(true);
    const verdict = unwrap(result);
    expect(verdict.answerDigest).toBe(DIGEST);
    expect(verdict.reviewerSession).toBe("reviewer");
    expect(verdict.claims[0]?.evidence).toBe("read the thread");
  });

  it("omits the evidence KEY when a claim carries none, rather than storing undefined", () => {
    const noEvidence = { ...VERDICT, claims: [{ impact: "low", support: "unverifiable", text: "a guess" }] };

    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(noEvidence) }) }));

    expect(Object.hasOwn(verdict.claims[0]!, "evidence")).toBe(false);
  });

  it("REFUSES a verdict from a future schema rather than reading it as version 1", () => {
    const result = readReviewVerdict({ path: written({ body: JSON.stringify({ ...VERDICT, schemaVersion: 2 }) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("schemaVersion");
  });

  it("REFUSES an unknown claim support value, which a cast would have let through", () => {
    const bad = { ...VERDICT, claims: [{ impact: "high", support: "probably", text: "x" }] };

    const result = readReviewVerdict({ path: written({ body: JSON.stringify(bad) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("claims.0.support");
  });

  it("names the file in the error when it is not JSON at all", () => {
    const path = written({ body: "not json" });

    const result = readReviewVerdict({ path });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain(path);
  });

  it("reports a missing file rather than throwing", () => {
    const result = readReviewVerdict({ path: join(tmpdir(), "slopweaver-no-such-verdict.json") });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("--verdict");
  });

  it("KEEPS a claim's restsOn, which the rebuild used to drop", () => {
    // It was parsed and never copied, so every verdict read through this edge arrived with the field absent
    // — which `ReviewVerdict` defines as `live`, silently disabling the round-to-round carrying it exists
    // for. Found by a Codex review of the image-observations change.
    const carried = { ...VERDICT, claims: [{ ...VERDICT.claims[0], restsOn: "answer" }] };

    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(carried) }) }));

    expect(verdict.claims[0]?.restsOn).toBe("answer");
  });

  it("KEEPS a live claim's readCommand and readAtIso, which the next round re-runs", () => {
    const read = {
      ...VERDICT,
      claims: [
        {
          ...VERDICT.claims[0],
          readAtIso: "2026-09-15T05:22:08.364Z",
          readCommand: "slopweaver linear read JJJJ-646 --json",
          restsOn: "live",
        },
      ],
    };

    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(read) }) }));

    expect(verdict.claims[0]?.readCommand).toBe("slopweaver linear read JJJJ-646 --json");
    expect(verdict.claims[0]?.readAtIso).toBe("2026-09-15T05:22:08.364Z");
  });

  it("omits the read KEYS on a claim that recorded no read, rather than storing undefined", () => {
    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(VERDICT) }) }));

    expect(Object.hasOwn(verdict.claims[0]!, "readCommand")).toBe(false);
    expect(Object.hasOwn(verdict.claims[0]!, "readAtIso")).toBe(false);
  });

  it("refuses a readCommand with no readAtIso — a read is the command AND the instant", () => {
    const half = { ...VERDICT, claims: [{ ...VERDICT.claims[0], readCommand: "slopweaver linear read JJJJ-646" }] };

    const result = readReviewVerdict({ path: written({ body: JSON.stringify(half) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("claims[the pool exhausted]: carries `readCommand` and no `readAtIso`");
  });

  it("refuses a readAtIso with no readCommand, naming the missing half", () => {
    const half = { ...VERDICT, claims: [{ ...VERDICT.claims[0], readAtIso: "2026-09-15T05:22:08Z" }] };

    const result = readReviewVerdict({ path: written({ body: JSON.stringify(half) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("carries `readAtIso` and no `readCommand`");
  });

  it("refuses a readAtIso that is not an ISO 8601 instant", () => {
    const prose = {
      ...VERDICT,
      claims: [
        { ...VERDICT.claims[0], readAtIso: "about five minutes ago", readCommand: "slopweaver linear read JJJJ-646" },
      ],
    };

    const result = readReviewVerdict({ path: written({ body: JSON.stringify(prose) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("claims.0.readAtIso");
  });

  it("reads a text-only verdict written before imageObservations existed, as no observations", () => {
    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(VERDICT) }) }));

    expect(verdict.imageObservations).toEqual([]);
  });

  it("round-trips an observation, keeping every field it carried", () => {
    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(withObservation({})) }) }));

    expect(verdict.imageObservations).toEqual([OBSERVATION]);
  });

  it("omits the unfitReason KEY when the picture is fit, rather than storing undefined", () => {
    const verdict = unwrap(readReviewVerdict({ path: written({ body: JSON.stringify(withObservation({})) }) }));

    expect(Object.hasOwn(verdict.imageObservations![0]!, "unfitReason")).toBe(false);
  });

  it("REFUSES an observation whose digest is not a sha256", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify(withObservation({ artifactDigest: "the-pool-shot" })) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("expected sha256:<64 hex>");
  });

  it("REFUSES an observation that says nothing about what was visible", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify(withObservation({ observedContent: "" })) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("observedContent");
  });

  it("REFUSES an unreadable picture recorded with no reason", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify(withObservation({ legible: false })) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("names no `unfitReason`");
  });

  it("REFUSES a reason none of the observed fields supports", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify(withObservation({ legible: false, unfitReason: "empty-panel" })) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("which none of what it observed supports");
  });

  it("REFUSES a reason on an observation whose every field says the picture is fine", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify(withObservation({ unfitReason: "illegible" })) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("every observed field says the picture is fit");
  });

  it("accepts an unfit observation whose reason names one of several defects", () => {
    const body = JSON.stringify(withObservation({ contextRetained: false, legible: false, unfitReason: "illegible" }));

    expect(readReviewVerdict({ path: written({ body }) }).isOk()).toBe(true);
  });
});

describe("the voice record", () => {
  it("round-trips the whole record, violations included", () => {
    const voice = {
      pathsChecked: ["lead", "grounding.evidence.read.0.label"],
      rulesChecked: 3,
      violations: [{ path: "lead", rule: "no em dash" }],
    };
    const result = readReviewVerdict({ path: written({ body: JSON.stringify({ ...VERDICT, voice }) }) });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).voice).toStrictEqual(voice);
  });

  it("leaves the KEY absent when the verdict carries none, so the gate can read the absence", () => {
    const result = readReviewVerdict({ path: written({ body: JSON.stringify(VERDICT) }) });

    expect(result.isOk()).toBe(true);
    expect(Object.hasOwn(unwrap(result), "voice")).toBe(false);
  });

  it("REFUSES a violation of a rule the reviewer says it was never given", () => {
    const voice = { pathsChecked: ["lead"], rulesChecked: 0, violations: [{ path: "lead", rule: "no em dash" }] };
    const result = readReviewVerdict({ path: written({ body: JSON.stringify({ ...VERDICT, voice }) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("saying it was given no rules to check");
  });

  it("REFUSES a negative rule count", () => {
    const voice = { pathsChecked: [], rulesChecked: -1, violations: [] };
    const result = readReviewVerdict({ path: written({ body: JSON.stringify({ ...VERDICT, voice }) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("voice.rulesChecked");
  });

  it("REFUSES a violation naming a rule but no field", () => {
    const voice = { pathsChecked: ["lead"], rulesChecked: 1, violations: [{ rule: "no em dash" }] };
    const result = readReviewVerdict({ path: written({ body: JSON.stringify({ ...VERDICT, voice }) }) });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("voice.violations.0.path");
  });
});

/**
 * The reviewer's warrant for a DELETE, which is the one field on this verdict that authorises destroying
 * something rather than describing it.
 *
 * The absence case matters as much as the presence one: `supersession` missing must leave NO key at all,
 * because `live/turn/supersession/eligibility.ts` refuses on `undefined` and a key present-but-empty would
 * have to be told apart from one a reviewer actually wrote.
 */
describe("readReviewVerdict — the supersession warrant", () => {
  const SUPERSESSION = {
    reason: "the new answer replaces the affected-version claim the old one led on",
    targetTs: "1790054484.916599",
    warranted: true,
  };

  it("reads a warranted supersession back exactly as the reviewer wrote it", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify({ ...VERDICT, supersession: SUPERSESSION }) }),
    });

    expect(unwrap(result).supersession).toEqual(SUPERSESSION);
  });

  it("keeps `warranted: false` as the real finding it is, rather than dropping it as an absent one", () => {
    const additive = { ...SUPERSESSION, reason: "the follow-up adds a caveat", warranted: false };
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify({ ...VERDICT, supersession: additive }) }),
    });

    expect(unwrap(result).supersession!.warranted).toBe(false);
    expect(unwrap(result).supersession!.reason).toBe("the follow-up adds a caveat");
  });

  it("leaves NO key at all when the reviewer named no supersession", () => {
    const result = readReviewVerdict({ path: written({ body: JSON.stringify(VERDICT) }) });

    expect(Object.hasOwn(unwrap(result), "supersession")).toBe(false);
  });

  it("REFUSES a target that is not a Slack message timestamp", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify({ ...VERDICT, supersession: { ...SUPERSESSION, targetTs: "yesterday" } }) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("expected a Slack message timestamp");
  });

  it("REFUSES a warrant with no reason, so a journal row can never read empty", () => {
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify({ ...VERDICT, supersession: { ...SUPERSESSION, reason: "" } }) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("supersession.reason");
  });

  it("REFUSES a warrant that names a target and never says whether it is warranted", () => {
    const { warranted: _dropped, ...undecided } = SUPERSESSION;
    const result = readReviewVerdict({
      path: written({ body: JSON.stringify({ ...VERDICT, supersession: undecided }) }),
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("supersession.warranted");
  });
});

import { describe, expect, it } from "vitest";

import {
  GEMINI_AI_STUDIO_DISPOSITION_RULES,
  type GeminiAiStudioDispositionInput,
  geminiAiStudioDispositionFor,
  geminiAiStudioDispositionRuleIds,
} from "../../../../atlas/geminiAiStudio/dispositions.js";

/** One operation as a rule sees it. */
function operation(over: Partial<GeminiAiStudioDispositionInput> = {}): GeminiAiStudioDispositionInput {
  return { leafResource: "models", method: "GET", methodName: "list", rootResource: "models", ...over };
}

describe("geminiAiStudioDispositionFor", () => {
  it("has at least one entry in GEMINI_AI_STUDIO_DISPOSITION_RULES, so the guards below are not vacuously green", () => {
    expect(GEMINI_AI_STUDIO_DISPOSITION_RULES.length).toBeGreaterThan(0);
  });

  it("excludes every mutation, which on this platform is also every inference call", () => {
    const decided = geminiAiStudioDispositionFor({
      input: operation({ method: "POST", methodName: "generateContent" }),
    });
    expect(decided.disposition).toBe("excluded");
    expect(decided.ruleId).toBe("mutation-or-inference-excluded");
    expect(decided.reason).toContain("runs inference");
  });

  it("excludes a download, because bytes are not a name and this atlas only stores names", () => {
    const decided = geminiAiStudioDispositionFor({
      input: operation({ methodName: "download", rootResource: "media" }),
    });
    expect(decided.disposition).toBe("excluded");
    expect(decided.ruleId).toBe("media-payload-excluded");
  });

  it("calls the platform-emitted generated-file listing voluminous", () => {
    const decided = geminiAiStudioDispositionFor({
      input: operation({ leafResource: "generatedFiles", rootResource: "generatedFiles" }),
    });
    expect(decided.disposition).toBe("voluminous");
    expect(decided.ruleId).toBe("generated-file-stream-voluminous");
  });

  it("calls a long-running operation LISTING voluminous, whether nested or a root of its own", () => {
    const nested = geminiAiStudioDispositionFor({ input: operation({ leafResource: "operations" }) });
    const root = geminiAiStudioDispositionFor({
      input: operation({ leafResource: "operations", rootResource: "operations" }),
    });
    expect(nested.ruleId).toBe("operation-record-stream-voluminous");
    expect(root.ruleId).toBe("operation-record-stream-voluminous");
  });

  it("calls the single-record GET of the same family reachable — the criterion cuts through the family", () => {
    const decided = geminiAiStudioDispositionFor({
      input: operation({ leafResource: "operations", methodName: "get" }),
    });
    expect(decided.disposition).toBe("reachable");
    expect(decided.ruleId).toBe("configuration-reachable");
  });

  it("calls a person's own uploaded-file listing reachable, unlike the generated one beside it", () => {
    const decided = geminiAiStudioDispositionFor({
      input: operation({ leafResource: "files", rootResource: "files" }),
    });
    expect(decided.disposition).toBe("reachable");
  });

  it("always returns a reason, because a disposition nobody explained is not a judgement", () => {
    for (const rule of GEMINI_AI_STUDIO_DISPOSITION_RULES) {
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("geminiAiStudioDispositionRuleIds", () => {
  it("is every reviewed rule, in application order, so a sync can report a dead one", () => {
    expect(geminiAiStudioDispositionRuleIds()).toEqual([
      "mutation-or-inference-excluded",
      "media-payload-excluded",
      "generated-file-stream-voluminous",
      "operation-record-stream-voluminous",
      "configuration-reachable",
    ]);
  });

  it("names every id exactly once, so a dead-rule report cannot double-count", () => {
    const ids = geminiAiStudioDispositionRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

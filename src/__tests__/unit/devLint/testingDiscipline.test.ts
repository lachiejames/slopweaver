import { describe, expect, it } from "vitest";
import { isScannablePath, scanTestingDiscipline } from "../../../devLint/testingDiscipline.js";

describe("scanTestingDiscipline", () => {
  it("flags vi.mock(...)", () => {
    const hits = scanTestingDiscipline({ content: 'vi.mock("./thing.js");', path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-mocks"]);
  });

  it("flags vi.spyOn(...)", () => {
    const hits = scanTestingDiscipline({ content: "vi.spyOn(obj, 'method');", path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-mocks"]);
  });

  it("flags vi.fn(...)", () => {
    const hits = scanTestingDiscipline({ content: "const f = vi.fn();", path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-mocks"]);
  });

  it("does not flag an unrelated call named fn on another object", () => {
    expect(scanTestingDiscipline({ content: "const f = other.fn();", path: "src/x.test.ts" })).toEqual([]);
  });

  it("flags .toBeTruthy()", () => {
    const hits = scanTestingDiscipline({ content: "expect(result).toBeTruthy();", path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-weak-boolean-matcher"]);
  });

  it("flags .toBeFalsy()", () => {
    const hits = scanTestingDiscipline({ content: "expect(result).toBeFalsy();", path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-weak-boolean-matcher"]);
  });

  it("does not flag .toBe(true)", () => {
    expect(scanTestingDiscipline({ content: "expect(result).toBe(true);", path: "src/x.test.ts" })).toEqual([]);
  });

  it("flags a bare toHaveProperty('k')", () => {
    const hits = scanTestingDiscipline({ content: 'expect(obj).toHaveProperty("id");', path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-bare-to-have-property"]);
  });

  it("does not flag toHaveProperty('k', value)", () => {
    expect(
      scanTestingDiscipline({ content: 'expect(obj).toHaveProperty("id", "abc-123");', path: "src/x.test.ts" }),
    ).toEqual([]);
  });

  it("flags expect(typeof x)", () => {
    const hits = scanTestingDiscipline({ content: 'expect(typeof result).toBe("string");', path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-expect-typeof"]);
  });

  it("does not flag expect(result)", () => {
    expect(scanTestingDiscipline({ content: 'expect(result).toBe("abc");', path: "src/x.test.ts" })).toEqual([]);
  });

  it("does not count a matching pattern inside a comment or string (real AST, not text)", () => {
    const content = ['// vi.mock("./thing.js")', '"expect(typeof x)"'].join("\n");
    expect(scanTestingDiscipline({ content, path: "src/x.test.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("includes a tracked *.test.ts anywhere under the test tree", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/houseRules.test.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/integration/turnInlineCompletion.test.ts" })).toBe(true);
  });

  it("includes a shared FAKE, which is where somebody reaches for a mock", () => {
    expect(isScannablePath({ path: "src/__tests__/captureTransportFake.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/slackWorkspaceShapeFake.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/imageAdmitFake.ts" })).toBe(true);
  });

  it("includes a setup file and a nested fixture builder", () => {
    expect(isScannablePath({ path: "src/__tests__/setup-polly.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/unit/atlas/workos/workosFixtures.ts" })).toBe(true);
  });

  it("excludes production source outside the test tree", () => {
    expect(isScannablePath({ path: "src/lib/date.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/outbound/slack/types.ts" })).toBe(false);
  });

  it("excludes a non-.ts file inside the test tree", () => {
    expect(isScannablePath({ path: "src/__tests__/fixtures/replay/card-posted-never-dispatched/fixture.json" })).toBe(
      false,
    );
  });

  it("excludes this gate's own sources", () => {
    expect(isScannablePath({ path: "src/devLint/testingDiscipline.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/testingDiscipline.test.ts" })).toBe(false);
  });
});

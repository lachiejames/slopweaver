/*
 * What the named-object-params test files share: the in-memory fixture runner, which is the one the decision-stream
 * tests use too (`src/__tests__/namedObjectParamsFixture.ts`), so every case judges the same compile, and the
 * reader that asserts a clean compile before returning the names the scanner reported.
 */
import { expect } from "vitest";

import { scanFixture } from "../../../namedObjectParamsFixture.js";

export { scanFixture } from "../../../namedObjectParamsFixture.js";

/**
 * The names the scanner reported, in report order.
 *
 * @returns each reported violation's name, once the fixture is asserted to compile with no diagnostics
 */
export function reportedNames({ source }: { source: string }): readonly string[] {
  const { diagnostics, violations } = scanFixture({ source });
  // A fixture that does not compile would turn imported types into error types and manufacture findings, so
  // every case asserts a clean compile FIRST. This is the fail-closed rule, applied to the test itself.
  expect(diagnostics).toBe(0);
  return violations.map((v) => v.name);
}

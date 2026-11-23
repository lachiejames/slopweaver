/*
 * The no-Block-Kit doctrine run against every fixture: no parsed arm carries a rejected key anywhere in its
 * tree, and each rejected key injected at any object node is refused.
 */
import { describe, expect, it } from "vitest";

import { answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { FORM_FIXTURES } from "./fixtures.js";

/** Every key found anywhere in a value's tree — arrays and objects both walked. */
function collectKeys({ value, found }: { value: unknown; found: Set<string> }): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectKeys({ found, value: item });
    });
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    found.add(key);
    collectKeys({ found, value: nested });
  }
}

/**
 * The doctrine, executable: no rejected shape is representable ANYWHERE in the union, at ANY depth.
 *
 * The first half only proves the fixtures we happened to write are clean. The second half is what actually
 * closes the doctrine: it walks every OBJECT NODE in every fixture's tree (root, nested, and objects inside
 * arrays — a `grounding` branch, a `couldNotSee` variant, a citation, a body run) and tries to add each
 * rejected key AT THAT EXACT NODE, on a deep clone, then re-parses the WHOLE mutated fixture. A rejected key
 * that sneaks in three levels down inside `grounding.evidence.read[0]` is exactly as much a doctrine failure
 * as one at the root, and only walking every node can catch that.
 */
describe("the doctrine, executable: no rejected shape is representable anywhere in the union", () => {
  /** Every rejected block-family key, plus the top-level escape hatch the owner rejected by eye. */
  const REJECTED_KEYS = ["attachments", "blocks", "button", "container", "actions", "task_card"];

  /** `recordCounts` is a number-valued map — an array sentinel would refuse for the WRONG reason (a type mismatch on an already-rejected key would refuse either way, but a number sentinel proves the refusal is about the KEY, not the shape). */
  function sentinelFor({ path }: { path: readonly (string | number)[] }): unknown {
    return path.at(-1) === "recordCounts" ? 0 : [];
  }

  /** A node's path as a failure names it — the root, which has no segments, reads as `<root>`. */
  function pathLabel({ path }: { path: readonly (string | number)[] }): string {
    const joined = path.join(".");
    if (joined === "") {
      return "<root>";
    }
    return joined;
  }

  /** Every object node in a value's tree, as its path from the root. The root itself counts as a node. */
  function collectObjectNodes({
    value,
    path,
    into,
  }: {
    value: unknown;
    path: readonly (string | number)[];
    into: { path: readonly (string | number)[] }[];
  }): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        collectObjectNodes({ into, path: [...path, index], value: item });
      });
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    into.push({ path });
    for (const [key, nested] of Object.entries(value)) {
      collectObjectNodes({ into, path: [...path, key], value: nested });
    }
  }

  /** Deep-clone `fixture` and inject `key` at the object node named by `path`. */
  function injectAt({
    fixture,
    path,
    key,
    value,
  }: {
    fixture: unknown;
    path: readonly (string | number)[];
    key: string;
    value: unknown;
  }): unknown {
    const clone: unknown = JSON.parse(JSON.stringify(fixture));
    let node: Record<string, unknown> | unknown[] = clone as Record<string, unknown>;
    for (const segment of path) {
      node = (node as Record<string, unknown> & unknown[])[segment as never] as Record<string, unknown> | unknown[];
    }
    (node as Record<string, unknown>)[key] = value;
    return clone;
  }

  it("no parsed arm, anywhere in its tree, carries a rejected key", () => {
    const found = new Set<string>();
    for (const { value } of FORM_FIXTURES) {
      const parsed = answerFormSchema.safeParse(value);
      expect(parsed.success).toBe(true);
      collectKeys({ found, value: parsed.data });
    }

    expect(REJECTED_KEYS.filter((key) => found.has(key))).toEqual([]);
  });

  it("REFUSES every rejected key injected at every object node, in every fixture, at any depth", () => {
    const stillAccepted: string[] = [];
    for (const { name, value } of FORM_FIXTURES) {
      const nodes: { path: readonly (string | number)[] }[] = [];
      collectObjectNodes({ into: nodes, path: [], value });
      for (const { path } of nodes) {
        for (const key of REJECTED_KEYS) {
          const mutated = injectAt({ fixture: value, key, path, value: sentinelFor({ path: [...path, key] }) });
          if (answerFormSchema.safeParse(mutated).success) {
            stillAccepted.push(`${name}:${pathLabel({ path })}:${key}`);
          }
        }
      }
    }

    expect(stillAccepted).toEqual([]);
  });
});

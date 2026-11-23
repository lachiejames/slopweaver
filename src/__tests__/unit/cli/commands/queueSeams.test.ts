/*
 * The seam that makes `queue release`'s ordering a structure rather than a comment.
 *
 * `releaseThroughDoor` appends the `released` event only after the door confirms the post, so a refused or
 * failed release leaves the entry `held` and releasable. While the verb was one 556-line file that ordering
 * was a convention a reader had to keep. It is an import graph now: the modules that parse a held draft,
 * render it and hand it to the transport do not import the queue store at all, so none of them has any way
 * to record a send that did not happen.
 *
 * These cases read the source text because that is where the property lives. Every one opens on an input
 * proven non-empty, so a file that stopped existing reddens instead of passing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { verbArgs } from "../../../../cli/commands/queue/queueArgs.js";
import { parseHeldAnswer } from "../../../../cli/commands/queue/queueHeldDraft.js";
import { sendAnswerRelease } from "../../../../cli/commands/queue/queueReleaseAnswer.js";
import { sendArtifactRelease } from "../../../../cli/commands/queue/queueReleaseArtifact.js";
import { postReleasedPayload } from "../../../../cli/commands/queue/queueReleaseDoor.js";

/** Every module of the family, in the layer order the split intends. */
const FAMILY = [
  "queueArgs.ts",
  "queueHeldDraft.ts",
  "queueReleaseDoor.ts",
  "queueReleaseAnswer.ts",
  "queueReleaseArtifact.ts",
  "run.ts",
] as const;

/** The three modules between "we have a draft" and "the door confirmed the post". */
const SEND_PATH = ["queueHeldDraft.ts", "queueReleaseAnswer.ts", "queueReleaseArtifact.ts"] as const;

function sourceOf({ module }: { module: string }): string {
  return readFileSync(new URL(`../../../../cli/commands/queue/${module}`, import.meta.url), "utf8");
}

function importedSpecifiers({ module }: { module: string }): readonly string[] {
  return [...sourceOf({ module }).matchAll(/^import[^;]*?from "([^"]+)";$/gm)].map((match) => match[1]!);
}

function familyImportsOf({ module }: { module: string }): readonly string[] {
  return importedSpecifiers({ module }).filter((specifier) => specifier.startsWith("./queue"));
}

describe("the family these cases read", () => {
  it("finds all six modules, each with a real import block, so no case below is vacuous", () => {
    const counts = FAMILY.map((module) => importedSpecifiers({ module }).length);
    expect(counts.length).toBe(6);
    expect(counts.filter((count) => count === 0)).toEqual([]);
  });

  it("binds each module's public surface by name, so a rename reddens here rather than silently", () => {
    const bound = [verbArgs, parseHeldAnswer, sendAnswerRelease, sendArtifactRelease, postReleasedPayload];
    expect(bound.map((fn) => fn.name)).toEqual([
      "verbArgs",
      "parseHeldAnswer",
      "sendAnswerRelease",
      "sendArtifactRelease",
      "postReleasedPayload",
    ]);
    expect(bound.map((fn) => fn.length)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("only the door module may record that a release happened", () => {
  it("keeps the queue store out of every send-path module", () => {
    const reaching = SEND_PATH.filter((module) =>
      importedSpecifiers({ module }).some((specifier) => specifier.endsWith("/admit/queueStore.js")),
    );
    expect(reaching).toEqual([]);
  });

  it("keeps the Slack write transport out of them as well, so neither can post at all", () => {
    const posting = SEND_PATH.filter((module) =>
      importedSpecifiers({ module }).some((specifier) => specifier.endsWith("/corpus/slack/writeSend.js")),
    );
    expect(posting).toEqual([]);
  });

  it("appends the released event in queueReleaseDoor.ts and nowhere else in the family", () => {
    const appending = FAMILY.filter((module) => sourceOf({ module }).includes('kind: "released"'));
    expect(appending).toEqual(["queueReleaseDoor.ts"]);
  });

  it("leaves the drop verb its own append, which is a different event and not a send", () => {
    expect(sourceOf({ module: "run.ts" })).toContain('kind: "dropped"');
    expect(sourceOf({ module: "run.ts" })).not.toContain('kind: "released"');
  });
});

describe("the import graph runs one way", () => {
  it("leaves the vocabulary and the held-draft reader standing on nothing of the family", () => {
    expect(familyImportsOf({ module: "queueArgs.ts" })).toEqual([]);
    expect(familyImportsOf({ module: "queueHeldDraft.ts" })).toEqual([]);
    expect(familyImportsOf({ module: "queueReleaseDoor.ts" })).toEqual([]);
  });

  it("points both send paths at the door and never at each other", () => {
    expect(familyImportsOf({ module: "queueReleaseAnswer.ts" }).toSorted()).toEqual([
      "./queueHeldDraft.js",
      "./queueReleaseDoor.js",
    ]);
    expect(familyImportsOf({ module: "queueReleaseArtifact.ts" })).toEqual(["./queueReleaseDoor.js"]);
  });

  it("leaves the verb layer importing the two shapes and no module importing it back", () => {
    expect(familyImportsOf({ module: "run.ts" }).toSorted()).toEqual([
      "./queueArgs.js",
      "./queueHeldDraft.js",
      "./queueReleaseAnswer.js",
      "./queueReleaseArtifact.js",
    ]);
    const importingRun = FAMILY.filter((module) => importedSpecifiers({ module }).includes("./run.js"));
    expect(importingRun).toEqual([]);
  });
});

/*
 * `derivedTagsOf` — the tags a row's own fields and run journal derive: kind, priority, repo, reply and run, and the
 * same derivation read off a projected Slack-tag row. It moved here when `rowTags.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { RunDisposition } from "../../../../handover/boardTypes.js";
import { rowOfTag } from "../../../../handover/rank.js";
import { derivedTagsOf, fieldsOfSlackTag, rowTagsOf } from "../../../../handover/rowTagFold.js";
import { TAG_KEYS } from "../../../../handover/rowTags.js";
import { AT, fields, LATER, waiting } from "./harness.js";

describe("derivedTagsOf", () => {
  it("derives kind and the kind's default priority from a bare doc", () => {
    expect(derivedTagsOf({ fields: fields({ lines: [] }) })).toEqual([
      { key: "kind", source: "derived", value: "doc" },
      { key: "priority", source: "derived", value: "p2" },
    ]);
  });

  it("derives the declared priority and the repo's directory name", () => {
    const row = fields({ lines: ["priority: p0", "repo: /Users/x/dev/personal/slopweaver"] });
    expect(derivedTagsOf({ fields: row })).toEqual([
      { key: "kind", source: "derived", value: "doc" },
      { key: "priority", source: "derived", value: "p0" },
      { key: "repo", source: "derived", value: "slopweaver" },
    ]);
  });
});

describe("derivedTagsOf on a checkout name with a space", () => {
  it("derives a repo value its own key accepts", () => {
    const tags = derivedTagsOf({ fields: fields({ lines: ["repo: /tmp/my repo"] }) });
    expect(tags.filter((tag) => tag.key === "repo")).toEqual([{ key: "repo", source: "derived", value: "my repo" }]);
    expect(TAG_KEYS.find((spec) => spec.key === "repo")!.values).toEqual({
      kind: "pattern",
      pattern: /^[^/]+$/u,
      shape: "a checkout's directory name",
    });
  });
});

describe("derivedTagsOf on a repo that is not a path", () => {
  it("derives no repo from a declared repo: null", () => {
    expect(derivedTagsOf({ fields: fields({ lines: ["repo: null"] }) }).map((tag) => tag.key)).toEqual([
      "kind",
      "priority",
    ]);
  });
});

describe("derivedTagsOf on the open question's draft", () => {
  it("derives reply=drafted when the open question offers a draft", () => {
    expect(derivedTagsOf({ fields: fields({ lines: [], run: waiting({ drafted: true }) }) })).toContainEqual({
      key: "reply",
      source: "derived",
      value: "drafted",
    });
  });

  it("derives reply=none when it offers none", () => {
    expect(derivedTagsOf({ fields: fields({ lines: [], run: waiting({ drafted: false }) }) })).toContainEqual({
      key: "reply",
      source: "derived",
      value: "none",
    });
  });
});

describe("derivedTagsOf on the run journal", () => {
  it.each<[RunDisposition, string]>([
    [{ kind: "never-started" }, "none"],
    [{ kind: "active" }, "open"],
    [waiting({ drafted: false }), "waiting"],
    [{ deadSessionId: "s1", kind: "orphaned", lastEventIso: AT }, "orphaned"],
    [{ atIso: AT, kind: "finished", residue: [] }, "ended"],
    [{ atIso: AT, kind: "closed", summary: "shipped" }, "ended"],
    [{ kind: "abandoned", why: "superseded" }, "ended"],
  ])("reads %o as run=%s — the lifecycle, never a claim the seat is alive", (run, value) => {
    expect(derivedTagsOf({ fields: fields({ lines: [], run }) }).filter((tag) => tag.key === "run")).toEqual([
      { key: "run", source: "derived", value },
    ]);
  });

  it("derives neither run nor reply off an unreadable journal, rather than guessing", () => {
    const keys = derivedTagsOf({
      fields: fields({ lines: [], run: { kind: "unreadable", reason: "truncated line 3" } }),
    }).map((tag) => tag.key);
    expect(keys).toEqual(["kind", "priority"]);
  });

  it("derives reply=none off a run that is not waiting, since only an open question offers a draft", () => {
    expect(derivedTagsOf({ fields: fields({ lines: [], run: { kind: "active" } }) })).toEqual([
      { key: "kind", source: "derived", value: "doc" },
      { key: "priority", source: "derived", value: "p2" },
      { key: "reply", source: "derived", value: "none" },
      { key: "run", source: "derived", value: "open" },
    ]);
  });
});

describe("derivedTagsOf on a projected Slack-tag row", () => {
  it("reads the same derivation off the board row the lifecycle projects", () => {
    const row = rowOfTag({
      nowIso: LATER,
      tag: { capturedIso: AT, id: "C1/1727424000.000100", state: "claimed", userId: "U1" },
    });
    expect(rowTagsOf({ events: [], fields: fieldsOfSlackTag() })).toEqual({
      tags: [
        { key: "kind", source: "derived", value: row.kind },
        { key: "priority", source: "derived", value: row.priority },
      ],
      unrecognised: [],
    });
  });
});

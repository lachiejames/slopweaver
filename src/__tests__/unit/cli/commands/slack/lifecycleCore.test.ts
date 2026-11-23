/**
 * The lifecycle verbs' pure core: parsing, the artifact shaping, and the door request.
 *
 * The parser tests lean on the refusals rather than the happy paths, because every one of them is a
 * mistake that would otherwise reach Slack: an edit with no form, a delete with no ts, or an unknown flag
 * silently ignored.
 *
 * This file's `parseProgressArgs` suites went out with the `slack progress` verb family itself, on the
 * owner's ruling that ONE progress-card shape may exist in outbound comms — the parser they covered is not
 * in the tree any more, so restoring them would be asserting against code that does not exist. The
 * `deleted-with-code` marker that once named that deletion is spent — the symbol left non-test source on an
 * earlier landed branch, so it is gone at this diff's own base too, and re-asserting the claim here would be
 * a finding rather than a pass.
 */
import { describe, expect, it } from "vitest";
import { SlackArgumentErrors, slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  mentionedPeopleOf,
  requireSingleDripMessage,
  singleDripPayload,
} from "../../../../../cli/commands/slack/lifecycleArtifacts.js";
import {
  type LifecycleOptions,
  lifecycleDoorRequest,
  parseDeleteArgs,
  parseEditArgs,
} from "../../../../../cli/commands/slack/lifecycleCore.js";
import { SlackLifecycleErrors } from "../../../../../cli/commands/slack/lifecycleErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { DripArtifact, PlainArtifact, UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import type { ResolvedMentions } from "../../../../../outbound/slack/render.js";

const HOME = "/tmp/slopweaver-home";

describe("parseEditArgs", () => {
  it("parses a complete invocation", () => {
    const parsed = unwrap(
      parseEditArgs({
        defaultHome: HOME,
        rest: ["--channel", "C1", "--ts", "1700000000.000100", "--form", "-"],
      }),
    );
    expect(parsed).toEqual({
      actor: "bot",
      // Off unless asked for: an edit that cannot resolve an owner ping refuses rather than re-rendering a card
      // with the name as inert plain text.
      allowUnresolvedOwner: false,
      channel: "C1",
      dryRun: false,
      formJson: "-",
      home: HOME,
      json: false,
      kind: "edit",
      ts: "1700000000.000100",
    });
  });

  it("reports EVERY missing flag in one pass rather than stopping at the first", () => {
    const parsed = parseEditArgs({ defaultHome: HOME, rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["--channel is required", "--ts is required", "--form is required"],
      }),
    );
  });

  it("honours --home and the boolean flags", () => {
    const parsed = unwrap(
      parseEditArgs({
        defaultHome: HOME,
        rest: ["--channel", "C1", "--ts", "1.1", "--form", "{}", "--dry-run", "--json", "--home", "/other"],
      }),
    );
    expect(parsed.dryRun).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.home).toBe("/other");
  });
});

describe("parseEditArgs — --as me", () => {
  it("parses a --body invocation with no --form and no allowUnresolvedOwner field at all", () => {
    const parsed = unwrap(
      parseEditArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--as", "me", "--body", "-"] }),
    );
    expect(parsed).toEqual({
      actor: "me",
      channel: "C1",
      dryRun: false,
      home: HOME,
      json: false,
      kind: "edit",
      source: { kind: "body", text: "-" },
      ts: "1.1",
    });
  });

  it("parses a single-message --form invocation", () => {
    const parsed = unwrap(
      parseEditArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--as", "me", "--form", "-"] }),
    );
    expect(parsed).toEqual({
      actor: "me",
      channel: "C1",
      dryRun: false,
      home: HOME,
      json: false,
      kind: "edit",
      source: { json: "-", kind: "form" },
      ts: "1.1",
    });
  });

  it("refuses --body under --as bot (or no --as), naming it rather than ignoring it", () => {
    const parsed = parseEditArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--body", "-"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) }).join("\n")).toContain(
      "--body is not valid with `--as bot`",
    );
  });

  it("refuses --allow-unresolved-owner under --as me: that flag governs a digest owner ping this lane has none of", () => {
    const parsed = parseEditArgs({
      defaultHome: HOME,
      rest: ["--channel", "C1", "--ts", "1.1", "--as", "me", "--body", "-", "--allow-unresolved-owner"],
    });
    expect(parsed.isErr()).toBe(true);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]).toContain(
      "--allow-unresolved-owner is not valid with `--as me`",
    );
  });

  it("refuses an unrecognised --as value by name", () => {
    const parsed = parseEditArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--as", "everyone"] });
    expect(parsed.isErr()).toBe(true);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]).toContain('"everyone"');
  });

  it("still reports every other missing flag alongside an invalid --as, not just the --as failure", () => {
    const parsed = parseEditArgs({ defaultHome: HOME, rest: ["--as", "everyone"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(
      SlackArgumentErrors.argumentsRefused({
        reasons: ["--channel is required", "--ts is required", '--as must be `bot` or `me` (got "everyone")'],
      }),
    );
  });
});

describe("parseDeleteArgs", () => {
  it("needs both a channel and a ts, and takes no form", () => {
    const parsed = unwrap(parseDeleteArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1"] }));
    expect(parsed).toEqual({
      actor: "bot",
      channel: "C1",
      dryRun: false,
      home: HOME,
      json: false,
      kind: "delete",
      ts: "1.1",
    });
  });

  it("parses --as me, defaulting to bot when --as is absent", () => {
    const asMe = unwrap(parseDeleteArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--as", "me"] }));
    expect(asMe.actor).toBe("me");
  });

  it("refuses an unrecognised --as value by name", () => {
    const parsed = parseDeleteArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--as", "everyone"] });
    expect(parsed.isErr()).toBe(true);
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })[0]).toContain('"everyone"');
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const parsed = parseDeleteArgs({ defaultHome: HOME, rest: ["--channel", "C1", "--ts", "1.1", "--form", "{}"] });
    expect(unwrapErr(parsed)).toEqual(
      SlackArgumentErrors.flagsInvalid({ reasons: ["unknown flag: --form", "unexpected argument: {}"] }),
    );
  });
});

describe("requireSingleDripMessage", () => {
  it("passes a single-message drip through unchanged", () => {
    const artifact: DripArtifact = { kind: "drip", messages: [{ runs: [{ text: "hi", type: "text" }] }] };
    expect(unwrap(requireSingleDripMessage({ artifact }))).toBe(artifact);
  });

  it("passes the plain escape hatch through unchanged — it is always exactly one message", () => {
    const artifact: PlainArtifact = { kind: "plain", text: "hi" };
    expect(unwrap(requireSingleDripMessage({ artifact }))).toBe(artifact);
  });

  it("refuses a drip with zero messages, naming the count", () => {
    const artifact: DripArtifact = { kind: "drip", messages: [] };
    const result = requireSingleDripMessage({ artifact });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(SlackLifecycleErrors.singleMessageRequired({ count: 0 }));
    expect(unwrapErr(result).message).toContain("described 0");
  });

  it("refuses a drip with more than one message, naming the count", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [{ runs: [{ text: "one", type: "text" }] }, { runs: [{ text: "two", type: "text" }] }],
    };
    const result = requireSingleDripMessage({ artifact });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(SlackLifecycleErrors.singleMessageRequired({ count: 2 }));
    expect(unwrapErr(result).message).toContain("described 2");
  });
});

describe("singleDripPayload", () => {
  const NO_MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map() };

  it("renders a single-message drip to its one payload", () => {
    const artifact: DripArtifact = { kind: "drip", messages: [{ runs: [{ text: "hi", type: "text" }] }] };
    const payload = singleDripPayload({ artifact, mentions: NO_MENTIONS });
    expect(payload.form).toBe("rich");
    expect(payload.text).toBe("hi");
  });

  it("renders the plain escape hatch to its one payload", () => {
    const artifact: PlainArtifact = { kind: "plain", text: "hi" };
    const payload = singleDripPayload({ artifact, mentions: NO_MENTIONS });
    expect(payload.form).toBe("plain");
    expect(payload.text).toBe("hi");
  });
});

describe("mentionedPeopleOf", () => {
  it("collects every distinct mention in first-appearance order", () => {
    const artifact = {
      citations: [],
      detail: [
        {
          runs: [
            { person: "b", type: "mention" },
            { text: " and ", type: "text" },
            { person: "a", type: "mention" },
          ],
          type: "paragraph",
        },
        { runs: [{ person: "b", type: "mention" }], type: "paragraph" },
      ],
      index: [],
      kind: "update",
      media: [],
      tldr: "x",
    } satisfies UpdateArtifact;
    expect(mentionedPeopleOf({ artifact })).toEqual(["b", "a"]);
  });

  it("returns nothing for an artifact that mentions nobody", () => {
    const artifact = {
      citations: [],
      detail: [{ runs: [{ text: "no one here", type: "text" }], type: "paragraph" }],
      index: [],
      kind: "update",
      media: [],
      tldr: "x",
    } satisfies UpdateArtifact;
    expect(mentionedPeopleOf({ artifact })).toEqual([]);
  });
});

describe("lifecycleDoorRequest", () => {
  it("declares every lifecycle operation an external write that claims no approval", () => {
    const request = lifecycleDoorRequest({
      options: { actor: "bot", channel: "C1", dryRun: false, home: HOME, json: false, kind: "delete", ts: "1.1" },
      targetTs: "1.1",
    });
    expect(request.meta).toEqual({
      createsWorkItem: false,
      effect: "external-write",
      home: HOME,
      requiresApproval: false,
    });
  });

  it("names the actual operation as the door verb for EVERY lifecycle kind, so the ledger is specific", () => {
    const shared = { dryRun: false, home: HOME, json: false };
    const options: readonly LifecycleOptions[] = [
      { ...shared, actor: "bot", allowUnresolvedOwner: false, channel: "C1", formJson: "-", kind: "edit", ts: "1.1" },
      { ...shared, actor: "bot", channel: "C1", kind: "delete", ts: "1.1" },
    ];
    expect(options.map((option) => lifecycleDoorRequest({ options: option }).action)).toEqual([
      { kind: "verb", noun: "slack", verb: "edit" },
      { kind: "verb", noun: "slack", verb: "delete" },
    ]);
  });

  it("carries no prose — only the opaque target and a block count", () => {
    const request = lifecycleDoorRequest({
      blockCount: 2,
      options: { actor: "bot", channel: "C1", dryRun: false, home: HOME, json: false, kind: "delete", ts: "1.1" },
      targetTs: "1.1",
    });
    expect(request.artifact).toEqual({ actor: "bot", blockCount: 2, targetTs: "1.1" });
  });

  it("records the REAL actor for an --as me lifecycle mutation, not a hard-coded bot", () => {
    const request = lifecycleDoorRequest({
      options: { actor: "me", channel: "C1", dryRun: false, home: HOME, json: false, kind: "delete", ts: "1.1" },
      targetTs: "1.1",
    });
    expect(request.artifact).toEqual({ actor: "me", targetTs: "1.1" });
  });
});

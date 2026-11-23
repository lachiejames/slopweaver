/*
 * Admission for `slack post|reply --as bot`: the no-fold refusals, the all-or-nothing mention resolution, and the
 * form-parse refusal `admittedCardOrRefusals` answers before any destination or clock is consulted. Every case
 * is pure: plans are built by the production planner from parsed forms, and the admission reads go through a
 * fake whose unused members throw.
 */
import { describe, expect, it } from "vitest";

import {
  buildSlackWritePlan,
  parseSlackForm,
  type SlackCardOptions,
  type SlackWritePlan,
} from "../../../../../cli/commands/slack/core.js";
import {
  admittedCardOrRefusals,
  type CardAdmissionDeps,
  noFoldRefusals,
  resolveAllMentions,
} from "../../../../../cli/commands/slack/runAdmit.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../../outbound/artifact/botFormKinds.js";
import type { SlackBotArtifact } from "../../../../../outbound/artifact/types.js";
import { SlackDeliveryErrors } from "../../../../../outbound/slack/deliveryErrors.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const CARD_FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

const OPTIONS: SlackCardOptions = {
  actor: "bot",
  allowUnresolvedOwner: false,
  channel: "C0ADMIT",
  dryRun: true,
  formJson: CARD_FORM,
  home: "/nonexistent/admit-home",
  json: false,
  media: [],
  resendUnconfirmed: false,
  verb: "post",
};

function artifactOf({ json }: { json: string }): SlackBotArtifact {
  return unwrap(parseSlackForm({ json })).artifact;
}

function planOf({ artifact, formKind }: { artifact: SlackBotArtifact; formKind: string }): SlackWritePlan {
  return buildSlackWritePlan({
    artifact,
    chrome: {
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#12B5A6",
      detailLabel: "*Details*",
      metadataEventType: "test_card_v1",
    },
    formKind,
    mentions: { groups: new Map(), people: new Map() },
    options: OPTIONS,
  });
}

/** The registry's own no-fold fixture, as the planner renders it. */
function noFoldPlan(): SlackWritePlan {
  const entry = BOT_FORM_KINDS.find((candidate) => candidate.kind === "no-fold")!;
  return planOf({ artifact: artifactOf({ json: JSON.stringify(entry.fixtures[0]!) }), formKind: "no-fold" });
}

/** Admission reads whose every member throws, so a case proves which of them a function actually asks. */
function landmineDeps({ touched }: { touched: string[] }): CardAdmissionDeps {
  const trip = ({ name }: { name: string }): never => {
    touched.push(name);
    throw new Error(`admission touched \`${name}\``);
  };
  return {
    approvedScheduledChannels: () => trip({ name: "approvedScheduledChannels" }),
    bareRefContext: () => trip({ name: "bareRefContext" }),
    doorEnv: () => trip({ name: "doorEnv" }),
    // A port, not a function: an in-memory one, which a refusal before the door never writes to.
    doorLedger: memoryDoorLedger().port,
    ownerUserId: () => trip({ name: "ownerUserId" }),
    promptChannel: () => trip({ name: "promptChannel" }),
    resolveMentions: () => trip({ name: "resolveMentions" }),
  };
}

/** A roster resolving every person but `ghost`, recording each lookup it is asked. */
function rosterExceptGhost({
  asked,
}: {
  asked: Parameters<CardAdmissionDeps["resolveMentions"]>[0][];
}): CardAdmissionDeps["resolveMentions"] {
  return async (args) => {
    asked.push(args);
    const resolution: MentionResolution = {
      groupAddresses: new Map(),
      heldRequested: [],
      memberLookups: new Map(),
      resolved: new Map(
        args.people
          .filter((person) => person !== "ghost")
          .map((person) => [person, { origin: "derived" as const, slackId: "U0SYNRESOLVED" }]),
      ),
      roster: { addressableKeys: 3, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
    };
    return ok(resolution);
  };
}

/** An update card whose one paragraph mentions each person in turn. */
function mentionCard({ people }: { people: readonly string[] }): SlackBotArtifact {
  return artifactOf({
    json: JSON.stringify({
      detail: [{ runs: people.map((person) => ({ person, type: "mention" })), type: "paragraph" }],
      kind: "update",
      tldr: "A short lead.",
    }),
  });
}

describe("noFoldRefusals", () => {
  it("refuses nothing for a card plan, even one invoked with media", () => {
    const card = planOf({ artifact: artifactOf({ json: CARD_FORM }), formKind: "update" });
    expect([noFoldRefusals({ media: [], plan: card }), noFoldRefusals({ media: ["shot.png"], plan: card })]).toEqual([
      [],
      [],
    ]);
  });

  it("refuses a no-fold plan carrying media with both lines, and admits the same plan without media", () => {
    const plan = noFoldPlan();
    expect([noFoldRefusals({ media: ["shot.png"], plan }), noFoldRefusals({ media: [], plan })]).toEqual([
      [
        "a no-fold message cannot carry media: attaching a file re-sends the message with an `attachments` " +
          "wrapper, which is the one thing measured to make a Slack message fold. Nothing was uploaded.",
        'post the picture as its own `{"kind":"update"}` card, or link it from the no-fold message.',
      ],
      [],
    ]);
  });
});

describe("resolveAllMentions", () => {
  it("returns the roster's resolution when every mentioned person resolves, asking about both in one lookup", async () => {
    const asked: Parameters<CardAdmissionDeps["resolveMentions"]>[0][] = [];
    const touched: string[] = [];
    const deps = { ...landmineDeps({ touched }), resolveMentions: rosterExceptGhost({ asked }) };

    const result = await resolveAllMentions({
      artifact: mentionCard({ people: ["alice", "bob"] }),
      deps,
      home: "/h",
    });

    expect(result.isOk()).toBe(true);
    expect([...unwrap(result).resolved.entries()]).toEqual([
      ["alice", { origin: "derived", slackId: "U0SYNRESOLVED" }],
      ["bob", { origin: "derived", slackId: "U0SYNRESOLVED" }],
    ]);
    expect(asked).toEqual([{ groups: [], home: "/h", people: ["alice", "bob"] }]);
    expect(touched).toEqual([]);
  });

  it("refuses the whole send with the roster's own message when the store cannot say who anyone is", async () => {
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" });
    const deps = { ...landmineDeps({ touched: [] }), resolveMentions: async () => err(outage) };

    const result = await resolveAllMentions({ artifact: mentionCard({ people: ["alice"] }), deps, home: "/h" });

    expect(unwrapErr(result)).toEqual([outage.message]);
  });

  it("refuses the whole send when one of two mentioned people does not resolve, naming only that person", async () => {
    const asked: Parameters<CardAdmissionDeps["resolveMentions"]>[0][] = [];
    const deps = { ...landmineDeps({ touched: [] }), resolveMentions: rosterExceptGhost({ asked }) };

    const result = await resolveAllMentions({
      artifact: mentionCard({ people: ["alice", "ghost"] }),
      deps,
      home: "/h",
    });

    expect(result.isErr()).toBe(true);
    expect(asked).toEqual([{ groups: [], home: "/h", people: ["alice", "ghost"] }]);
    expect(unwrapErr(result)).toEqual([
      'cannot resolve a mention for "ghost": no exact match among the 3 addressable keys (canonical person id, ' +
        "Slack id, Slack handle, `@handle`, or email), and no colleague in the member index answers to it " +
        "either. Mentions are exact-match only — never guessed.",
    ]);
  });
});

describe("admittedCardOrRefusals", () => {
  it("refuses an empty form as FORM_NOT_JSON before reading any destination, roster or environment", async () => {
    const touched: string[] = [];

    const result = await admittedCardOrRefusals({
      cardOptions: OPTIONS,
      deps: landmineDeps({ touched }),
      formJson: "",
    });

    expect(result.isErr()).toBe(true);
    const refusal = unwrapErr(result);
    expect(refusal).toEqual(SlackDeliveryErrors.formNotJson({ reason: "SyntaxError: Unexpected end of JSON input" }));
    expect(refusal.code).toBe("FORM_NOT_JSON");
    expect(refusal.message).toBe("--form is not valid JSON: SyntaxError: Unexpected end of JSON input");
    expect(touched).toEqual([]);
  });
});

/**
 * What the owner corrected on parked Slack drafts, one kind at a time — the events the Alignment page's tiny charts draw.
 * Every fixture is a folded register row built by hand, so each case names exactly which cut changed what.
 */
import { describe, expect, it } from "vitest";

import {
  CORRECTION_RESIDUE,
  draftCorrectionChains,
  draftCorrectionLines,
  draftCorrections,
  draftSteersOf,
  lapKinds,
} from "../../../../outbound/slack/draftCorrections.js";
import type { ParkedSlackDraft, SlackDraftItem } from "../../../../outbound/slack/draftRegister.js";
import type { ExactVoiceRule } from "../../../../outbound/voice/exactRules.js";

/** One parked cut as the owner, a plain message in `C0ENG`, tagging nobody and attaching nothing. */
function cut(over: Partial<ParkedSlackDraft> & { id: string; text: string; tsIso: string }): ParkedSlackDraft {
  const { text, ...rest } = over;
  return {
    advisory: [],
    channel: "C0ENG",
    digest: "0".repeat(32),
    form: "{}",
    mentions: [],
    payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
    shape: "top-level",
    why: `why ${over.id}`,
    ...rest,
  };
}

/** A folded row around a cut. */
function row({
  draft,
  state,
  resolvedIso,
  outcome,
}: {
  draft: ParkedSlackDraft;
  state: SlackDraftItem["state"];
  resolvedIso?: string;
  outcome?: string;
}): SlackDraftItem {
  return { draft, id: draft.id, outcome, resolvedIso, state };
}

const FIRST = cut({
  id: "sd-00000001",
  text: "hey team, here is a long note about the rollout plan",
  tsIso: "2026-09-28T01:00:00.000Z",
});
const SECOND = cut({
  id: "sd-00000002",
  mentions: [{ key: "jonah", kind: "person", target: "U0JONAH" }],
  text: "hey <@U0JONAH>, rollout plan",
  tsIso: "2026-09-28T02:00:00.000Z",
});
const THIRD = cut({
  id: "sd-00000003",
  media: [{ bytes: 10, name: "proof.png", sha256: "a".repeat(64) }],
  mentions: [{ key: "jonah", kind: "person", target: "U0JONAH" }],
  text: "hey <@U0JONAH>, rollout plan",
  tsIso: "2026-09-28T03:00:00.000Z",
});

/** A three-cut chain sent on its third cut: one lap tagging and shortening, one lap attaching proof. */
const SENT_ON_THIRD: readonly SlackDraftItem[] = [
  row({
    draft: FIRST,
    outcome: "superseded by sd-00000002 (recorded with --supersedes)",
    resolvedIso: "2026-09-28T02:00:00.000Z",
    state: "dropped",
  }),
  row({
    draft: SECOND,
    outcome: "superseded by sd-00000003 (recorded with --supersedes)",
    resolvedIso: "2026-09-28T03:00:00.000Z",
    state: "dropped",
  }),
  row({ draft: THIRD, outcome: "C0ENG 1790000000.000100", resolvedIso: "2026-09-28T04:00:00.000Z", state: "released" }),
];

const FIRST_TRY = row({
  draft: cut({ id: "sd-0000000f", text: "all merged, thanks", tsIso: "2026-10-01T00:00:00.000Z" }),
  outcome: "C0ENG 1790100000.000100",
  resolvedIso: "2026-10-01T01:00:00.000Z",
  state: "released",
});

const BOT_ROW = row({
  draft: cut({ actor: "bot", id: "sd-000000b0", text: "a bot card", tsIso: "2026-10-01T00:00:00.000Z" }),
  outcome: "C0ENG 1790100000.000200",
  resolvedIso: "2026-10-01T02:00:00.000Z",
  state: "released",
});

const WITHHELD = row({
  draft: cut({ id: "sd-000000d0", text: "bump on the PR", tsIso: "2026-10-02T00:00:00.000Z" }),
  outcome: "moot: the PR merged before the bump",
  resolvedIso: "2026-10-02T05:00:00.000Z",
  state: "dropped",
});

const HELD = row({
  draft: cut({ id: "sd-000000e0", text: "still waiting on the owner", tsIso: "2026-10-03T00:00:00.000Z" }),
  state: "held",
});

const DASH: ExactVoiceRule = { kind: "literal", value: "—" };
const BOT_ONLY: ExactVoiceRule = { actors: ["bot"], kind: "word", value: "rollout" };

describe("draftCorrectionChains", () => {
  it("groups a re-cut chain under the cut that went out, oldest cut first", () => {
    const chains = draftCorrectionChains({ items: SENT_ON_THIRD });
    expect(chains.map((chain) => chain.live.id)).toEqual(["sd-00000003"]);
    expect(chains[0]!.cuts.map((one) => one.id)).toEqual(["sd-00000001", "sd-00000002", "sd-00000003"]);
  });

  it("puts three replies merged into one message in one chain", () => {
    const merged = [
      row({
        draft: cut({ id: "sd-0000000a", text: "a", tsIso: "2026-09-29T01:00:00.000Z" }),
        outcome: "merged into sd-0000000c on the owner's word",
        state: "dropped",
      }),
      row({
        draft: cut({ id: "sd-0000000b", text: "b", tsIso: "2026-09-29T02:00:00.000Z" }),
        outcome: "merged into sd-0000000c on the owner's word",
        state: "dropped",
      }),
      row({
        draft: cut({ id: "sd-0000000c", text: "a and b", tsIso: "2026-09-29T03:00:00.000Z" }),
        resolvedIso: "2026-09-29T04:00:00.000Z",
        state: "released",
      }),
    ];
    const chains = draftCorrectionChains({ items: merged });
    expect(chains.length).toBe(1);
    expect(chains[0]!.cuts.map((one) => one.id)).toEqual(["sd-0000000a", "sd-0000000b", "sd-0000000c"]);
  });

  it("leaves out a chain that goes out as the bot", () => {
    expect(draftCorrectionChains({ items: [BOT_ROW, FIRST_TRY] }).map((chain) => chain.live.id)).toEqual([
      "sd-0000000f",
    ]);
  });
});

describe("lapKinds", () => {
  it("names a lap that tagged somebody and cut words as stakeholders and shorter", () => {
    expect(lapKinds({ from: FIRST, to: SECOND })).toEqual(["stakeholders", "shorter"]);
  });

  it("names a lap that only attached a file as proof", () => {
    expect(lapKinds({ from: SECOND, to: THIRD })).toEqual(["proof"]);
  });

  it("names a lap that moved the message into a thread as place", () => {
    const threaded = { ...SECOND, shape: "thread" as const, threadTs: "1790000000.000001" };
    expect(lapKinds({ from: SECOND, to: threaded })).toEqual(["place"]);
  });

  it("names a lap that kept or grew the word count as reworded", () => {
    const longer = cut({
      id: "sd-00000004",
      mentions: SECOND.mentions,
      text: "hey <@U0JONAH>, here is the rollout plan",
      tsIso: "2026-09-28T02:30:00.000Z",
    });
    expect(lapKinds({ from: SECOND, to: longer })).toEqual(["reworded"]);
  });

  it("names nothing for a re-record of the same message", () => {
    expect(lapKinds({ from: SECOND, to: { ...SECOND, id: "sd-00000009" } })).toEqual([]);
  });
});

describe("draftCorrections", () => {
  it("counts a release as reviewed whether it took one cut or three, and a held or bot one not at all", () => {
    const result = draftCorrections({ items: [...SENT_ON_THIRD, FIRST_TRY, BOT_ROW, HELD], rules: [], steers: [] });
    expect(result.reviewed).toEqual(["2026-09-28T04:00:00.000Z", "2026-10-01T01:00:00.000Z"]);
  });

  it("dates each lap at the cut that replaced it, carrying both cuts' words and the drop note", () => {
    const result = draftCorrections({ items: SENT_ON_THIRD, rules: [], steers: [] });
    expect(result.events.map((event) => [event.kind, event.atIso, event.cut, event.next])).toEqual([
      ["stakeholders", "2026-09-28T02:00:00.000Z", "sd-00000001", "sd-00000002"],
      ["shorter", "2026-09-28T02:00:00.000Z", "sd-00000001", "sd-00000002"],
      ["proof", "2026-09-28T03:00:00.000Z", "sd-00000002", "sd-00000003"],
    ]);
    const proof = result.events.find((event) => event.kind === "proof")!;
    expect(proof.chain).toBe("sd-00000003");
    expect(proof.before).toBe("hey <@U0JONAH>, rollout plan");
    expect(proof.after).toBe("hey <@U0JONAH>, rollout plan");
    expect(proof.note).toBe("superseded by sd-00000003 (recorded with --supersedes)");
  });

  it("records a chain dropped whole as withheld, at its drop, with the note", () => {
    const result = draftCorrections({ items: [WITHHELD], rules: [], steers: [] });
    expect(result.events.map((event) => [event.kind, event.atIso, event.note])).toEqual([
      ["withheld", "2026-10-02T05:00:00.000Z", "moot: the PR merged before the bump"],
    ]);
    expect(result.reviewed).toEqual([]);
  });

  it("records a cut that reached the owner breaking one of their rules, and none that broke only a bot rule", () => {
    const dashed = row({
      draft: cut({ id: "sd-000000a1", text: "merged — thanks", tsIso: "2026-10-01T03:00:00.000Z" }),
      resolvedIso: "2026-10-01T04:00:00.000Z",
      state: "released",
    });
    const result = draftCorrections({ items: [dashed, ...SENT_ON_THIRD], rules: [DASH, BOT_ONLY], steers: [] });
    const voice = result.events.filter((event) => event.kind === "voice");
    expect(voice.map((event) => [event.cut, event.rules])).toEqual([["sd-000000a1", ['"—"']]]);
  });

  it("does not read a rule broken inside a quoted line, escaped the way Slack stores it", () => {
    const quoted = row({
      draft: cut({ id: "sd-000000a2", text: "&gt; happy — to\nsounds good", tsIso: "2026-10-01T03:00:00.000Z" }),
      resolvedIso: "2026-10-01T04:00:00.000Z",
      state: "released",
    });
    expect(draftCorrections({ items: [quoted], rules: [DASH], steers: [] }).events).toEqual([]);
  });

  it("joins what the owner said on any card of the chain to every event of it, oldest first", () => {
    const steers = [
      { about: "post:sd-00000002", anchor: "talk:b", atIso: "2026-09-28T02:30:00.000Z", words: "attach the video" },
      { about: "post:sd-00000001", anchor: "talk:a", atIso: "2026-09-28T01:30:00.000Z", words: "tag Jonah" },
      { about: "post:sd-0000000f", anchor: "talk:c", atIso: "2026-10-01T00:30:00.000Z", words: "send" },
    ];
    const result = draftCorrections({ items: [...SENT_ON_THIRD, FIRST_TRY], rules: [], steers });
    expect(result.events[0]!.steers.map((steer) => steer.words)).toEqual(["tag Jonah", "attach the video"]);
  });

  it("states what it cannot see with every result", () => {
    expect(draftCorrections({ items: [], rules: [], steers: [] }).residue).toEqual(CORRECTION_RESIDUE);
  });
});

describe("draftSteersOf", () => {
  it("keeps only receipts about a draft card, the owner's own words first and the relay line where they are absent", () => {
    const steers = draftSteersOf({
      receipts: [
        {
          about: "post:sd-00000001",
          anchor: "a",
          heard: "tag Jonah please",
          stagedAtIso: "2026-09-28T01:30:00.000Z",
          words: "relay line",
        },
        {
          about: "post:sd-00000002",
          anchor: "b",
          heard: " ",
          stagedAtIso: "2026-09-28T02:30:00.000Z",
          words: "older receipt words",
        },
        {
          about: "ask:some-row",
          anchor: "c",
          heard: "not a draft",
          stagedAtIso: "2026-09-28T03:30:00.000Z",
          words: "x",
        },
      ],
    });
    expect(steers).toEqual([
      { about: "post:sd-00000001", anchor: "a", atIso: "2026-09-28T01:30:00.000Z", words: "tag Jonah please" },
      { about: "post:sd-00000002", anchor: "b", atIso: "2026-09-28T02:30:00.000Z", words: "older receipt words" },
    ]);
  });
});

describe("draftCorrectionLines", () => {
  it("says per kind how many, when last, and how many reviews came after it", () => {
    const lines = draftCorrectionLines({
      corrections: draftCorrections({ items: [...SENT_ON_THIRD, FIRST_TRY], rules: [], steers: [] }),
    });
    expect(lines.slice(0, 8)).toEqual([
      "reviewed  2 drafts sent as you after your yes",
      "voice         0",
      "stakeholders  1 · last 2026-09-28T02:00:00.000Z · 2 reviewed since",
      "proof         1 · last 2026-09-28T03:00:00.000Z · 2 reviewed since",
      "place         0",
      "shorter       1 · last 2026-09-28T02:00:00.000Z · 2 reviewed since",
      "reworded      0",
      "withheld      0",
    ]);
  });
});

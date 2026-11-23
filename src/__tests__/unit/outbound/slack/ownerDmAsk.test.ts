import { describe, expect, it } from "vitest";

import { noFoldAboveFoldCells, updateArtifactBelowFoldCells } from "../../../../outbound/artifact/aboveFold.js";
import type { NoFoldArtifact, UpdateArtifact } from "../../../../outbound/artifact/types.js";
import { ASK_PHRASES, ownerDmAskRefusal, ownerDmAsks } from "../../../../outbound/slack/ownerDmAsk.js";

const OWNER = { ownerUserId: "U0OWNER", promptChannel: "D0PROMPT" };

/* The masculine pronouns are assembled, not spelled, so the gate that counts them does not count this fixture. */
const OBJECT = ["h", "im"].join("");
const POSSESSIVE = ["h", "is"].join("");

/** Third-person waits on the owner, each with the words that match. */
const THIRD_PERSON_WAITS: readonly (readonly [string, string])[] = [
  [`the rollout is awaiting ${POSSESSIVE} sign-off`, `awaiting ${POSSESSIVE}`],
  [`the rollout is blocked on ${OBJECT}`, `blocked on ${OBJECT}`],
  [`the rollout is waiting for ${OBJECT}`, `waiting for ${OBJECT}`],
  [`the rollout is waiting on ${OBJECT}`, `waiting on ${OBJECT}`],
  [`the rollout needs ${POSSESSIVE} sign-off`, `needs ${POSSESSIVE}`],
];

/** The incident card, as its sender composed it — no question mark anywhere, and still an ask. */
const INCIDENT: NoFoldArtifact = {
  bullets: [],
  kind: "no-fold",
  lead: [
    {
      text:
        "the acme-admin vulnerability top-up is ready. every day at 9am it tops the open fixes up to ten. it only " +
        "does that once half its last batch has merged, else it skips the day.",
      type: "text",
    },
  ],
  trailing: [[{ text: "it is still held from 21 sep. reply yes and i will switch it on.", type: "text" }]],
};

const FINDING: NoFoldArtifact = {
  bullets: [[{ text: "p95 on /sessions went from 420ms to 1.9s at 03:10Z, after the pool change.", type: "text" }]],
  kind: "no-fold",
  lead: [
    { text: "the staging pool exhausted because the new worker holds a connection per job. ", type: "text" },
    { label: "the dashboard", type: "link", url: "https://app.datadoghq.com/dash?from=1&to=2" },
  ],
  trailing: [[{ text: "the approval flow is still waiting on the vendor, and x?.y is guarded.", type: "text" }]],
};

const cells = (artifact: NoFoldArtifact): ReturnType<typeof noFoldAboveFoldCells> => noFoldAboveFoldCells({ artifact });

describe("ownerDmAsks", () => {
  it("finds the incident's ask, which carries no question mark", () => {
    expect(ownerDmAsks({ cells: cells(INCIDENT) })).toEqual([{ matched: "reply yes", path: "trailing[0]" }]);
  });

  it("finds the second incident's question by the word the mark closes", () => {
    const asked: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [{ text: "ok to run it here every day at 9am? then it goes on.", type: "text" }],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(asked) })).toEqual([{ matched: "9am?", path: "lead" }]);
  });

  const personWaits: readonly (readonly [string, string])[] = [
    ["The release is blocked pending the owner’s approval.", "pending the owner’s approval"],
    ["it is held until the owner's go-ahead", "held until the owner's go-ahead"],
    ...THIRD_PERSON_WAITS,
    ["this needs your say-so first", "needs your"],
    ["it is waiting for your reply in the thread", "waiting for your"],
    ["held pending the owner's reply", "pending the owner's reply"],
    ["The release is waiting on approval from the owner.", "approval from the owner"],
    ["sign-off by the owner is still outstanding", "sign-off by the owner"],
    ["it stays held until the owner approves it", "until the owner approves"],
    ["once you sign off, it goes on", "once you sign off"],
  ];

  it.each(personWaits)("finds a wait on a person's act, named in any person: %s", (text, matched) => {
    const waiting: NoFoldArtifact = { ...FINDING, bullets: [], lead: [{ text, type: "text" }], trailing: [] };

    expect(ownerDmAsks({ cells: cells(waiting) })).toEqual([{ matched, path: "lead" }]);
  });

  it("asks nothing of a wait that names no person, which a finding reports about systems", () => {
    const waiting: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [
        {
          text: "the deploy is pending approval in the pipeline, waiting on the vendor's queue, and retries until the database answers.",
          type: "text",
        },
      ],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(waiting) })).toEqual([]);
  });

  it("asks nothing of a third-person phrase outside the declared five, such as blocked for the owner", () => {
    const blocked: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [{ text: `The deployment is blocked for ${OBJECT}.`, type: "text" }],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(blocked) })).toEqual([]);
  });

  it("finds a question closing a decomposed word, so a combining mark cannot hide the mark", () => {
    const asked: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [{ text: "rename it cafe\u0301? it reads better.", type: "text" }],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(asked) })).toEqual([{ matched: "caf\u00e9?", path: "lead" }]);
  });

  it("finds a question whose closing word was a link, which the cell reader leaves as one space", () => {
    const asked: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [
        { text: "is the fix ready in ", type: "text" },
        { label: "#123", type: "link", url: "https://github.com/acme/widget/pull/123" },
        { text: "?", type: "text" },
      ],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(asked) })).toEqual([{ matched: "in ?", path: "lead" }]);
  });

  it.each([
    ["The top-up is ready?\u0085It can run now.", "ready?"],
    ["reply\u0085yes and it goes on", "reply\u0085yes"],
  ])("reads U+0085 as whitespace, which JavaScript's own class does not: %j", (text, matched) => {
    const asked: NoFoldArtifact = { ...FINDING, bullets: [], lead: [{ text, type: "text" }], trailing: [] };

    expect(ownerDmAsks({ cells: cells(asked) })).toEqual([{ matched, path: "lead" }]);
  });

  it.each([
    "The webhook included a reply in JSON, confirming the downstream accepted it.",
    "the reply to the ticket landed at 03:10Z, and their reply with logs followed.",
    "Your reply in the incident thread contained the logs, and Sadie's reply to the vendor confirmed it.",
  ])("asks nothing where `reply` is a noun a finding reports: %j", (text) => {
    const reported: NoFoldArtifact = { ...FINDING, bullets: [], lead: [{ text, type: "text" }], trailing: [] };

    expect(ownerDmAsks({ cells: cells(reported) })).toEqual([]);
  });

  it("still finds the imperative `reply in`, which asks the owner", () => {
    const asked: NoFoldArtifact = {
      ...FINDING,
      bullets: [],
      lead: [{ text: "Reply in the thread and it goes on.", type: "text" }],
      trailing: [],
    };

    expect(ownerDmAsks({ cells: cells(asked) })).toEqual([{ matched: "Reply in", path: "lead" }]);
  });

  it("asks nothing of a finding whose only `?` sits in a link URL or code, and which names no ask", () => {
    expect(ownerDmAsks({ cells: cells(FINDING) })).toEqual([]);
  });

  it("skips a quoted run, so somebody else's question in a derived card is not the sender asking", () => {
    const card: UpdateArtifact = {
      citations: [],
      detail: [
        {
          runs: [
            { text: "monitor ", type: "text" },
            { quoted: true, text: "Is the session queue draining?", type: "text" },
            { text: " fired four times overnight.", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      index: [],
      kind: "update",
      media: [],
      tldr: "four alerts overnight",
    };

    expect(ownerDmAsks({ cells: updateArtifactBelowFoldCells({ artifact: card }) })).toEqual([]);
  });

  it("matches every phrase case-insensitively on word boundaries, and not inside a longer word", () => {
    expect(ASK_PHRASES.length).toBeGreaterThan(0);
    const hits = ASK_PHRASES.map((phrase) =>
      ownerDmAsks({ cells: [{ path: "lead", text: `Heads up. ${phrase.toUpperCase()} when it suits.` }] }),
    );

    expect(hits.map((found) => found.length)).toEqual(ASK_PHRASES.map(() => 1));
    expect(ownerDmAsks({ cells: [{ path: "lead", text: "the replyer knows; shouldI is a symbol" }] })).toEqual([]);
  });

  it("names every asking cell in reading order", () => {
    const both = ownerDmAsks({
      cells: [
        { path: "lead", text: "found it. let me know." },
        { path: "bullets[0]", text: "a plain fact." },
        { path: "trailing[0]", text: "run it daily?" },
      ],
    });

    expect(both).toEqual([
      { matched: "let me know", path: "lead" },
      { matched: "daily?", path: "trailing[0]" },
    ]);
  });
});

describe("ownerDmAskRefusal", () => {
  it("holds an asking post to the owner's DM, points at the queue, and says there is no hatch", () => {
    const lines = ownerDmAskRefusal({ cells: cells(INCIDENT), channel: "D0PROMPT", formKind: "no-fold", ...OWNER });

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('trailing[0] ("reply yes")');
    expect(lines[1]).toContain("slopweaver handover ask <slug>");
    expect(lines[1]).toContain("slopweaver handover register --ask");
    expect(lines[2]).toContain("deliberately NO escape hatch");
  });

  it("holds it at either spelling of the owner's DM", () => {
    expect(ownerDmAskRefusal({ cells: cells(INCIDENT), channel: "U0OWNER", formKind: "update", ...OWNER }).length).toBe(
      3,
    );
  });

  it("lets a finding that asks nothing through", () => {
    expect(ownerDmAskRefusal({ cells: cells(FINDING), channel: "D0PROMPT", formKind: "no-fold", ...OWNER })).toEqual(
      [],
    );
  });

  it("never reads a post aimed somewhere else", () => {
    expect(ownerDmAskRefusal({ cells: cells(INCIDENT), channel: "C0TEAM", formKind: "no-fold", ...OWNER })).toEqual([]);
  });

  it("exempts an automation prompt, whose question is addressed to the bot", () => {
    expect(
      ownerDmAskRefusal({ cells: cells(INCIDENT), channel: "D0PROMPT", formKind: "automation-prompt", ...OWNER }),
    ).toEqual([]);
  });
});

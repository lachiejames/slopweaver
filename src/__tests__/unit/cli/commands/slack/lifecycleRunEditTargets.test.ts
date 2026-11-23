/*
 * `slack edit --as bot` sorting its TARGET by kind, through the whole `runEdit` dispatch: a kind with no renderer
 * is refused with the delete route, a form of the wrong kind is refused naming the right one, and the shared
 * event-type table `slack delete` accepts from covers every kind.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { SlackEditTargetErrors } from "../../../../../cli/commands/slack/lifecycleEditErrors.js";
import {
  botMessageEventTypes,
  botMessageKindsOf,
  deletableEventTypes,
} from "../../../../../cli/commands/slack/lifecycleEventTypes.js";
import { runEdit } from "../../../../../cli/commands/slack/lifecycleRunEdit.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { NOTICE_METADATA_EVENT_TYPE } from "../../../../../outbound/slack/noticeMetadata.js";
import { DEFAULT_TURN_METADATA_EVENT_TYPE } from "../../../../../profile.js";
import {
  editDeps,
  editOptions,
  editTransport,
  freshHome,
  ownMessage,
  type RecordedUpdate,
  TEST_CARD_TYPE,
  TEST_POLL_TYPE,
  TEST_PROGRESS_TYPE,
} from "./editKindFakes.js";

const minted: string[] = [];
const homes = { fresh: (): string => freshHome({ dirs: minted }) };
afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const TS = "1700000000.000500";
const AT = `C0EDIT/${TS}`;

const CARD_FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

const CHECKLIST_FORM = JSON.stringify({
  kind: "checklist",
  modelId: "claude-opus-5-5",
  steps: [{ id: "s1", state: "done", title: "Read the thread" }],
  task: "Why the pool exhausted",
});

describe("runEdit --as bot, sorting its target by kind", () => {
  it.each([
    {
      kind: "progress" as const,
      message: ownMessage({ eventType: TEST_PROGRESS_TYPE, renderer: "slack-progress-v1", ts: TS }),
    },
    {
      kind: "notice" as const,
      message: ownMessage({ eventType: NOTICE_METADATA_EVENT_TYPE, renderer: "slack-notice-v1", ts: TS }),
    },
  ])("refuses a $kind message with the delete route, updating nothing", async ({ kind, message }) => {
    const updates: RecordedUpdate[] = [];
    const deps = editDeps({ out: [], stdin: CARD_FORM, transport: editTransport({ message, updates }) });

    const code = await runEdit({ deps, options: editOptions({ home: homes.fresh(), ts: TS }) });

    expect(code).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect(SlackEditTargetErrors.unsupported({ at: AT, kind }).message).toContain("`slopweaver slack delete`");
  });

  it("refuses a checklist form aimed at a poll, naming the poll form, updating nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({
      eventType: TEST_POLL_TYPE,
      extra: { pollId: "p1" },
      renderer: "slack-poll-v1",
      ts: TS,
    });
    const deps = editDeps({ out: [], stdin: CHECKLIST_FORM, transport: editTransport({ message, updates }) });

    expect(await runEdit({ deps, options: editOptions({ home: homes.fresh(), ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect(SlackEditTargetErrors.formMismatch({ at: AT, formKind: "checklist", found: "poll" }).message).toContain(
      '`"kind": "poll"`',
    );
  });

  it("refuses a card form aimed at a turn checklist, updating nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({ eventType: DEFAULT_TURN_METADATA_EVENT_TYPE, renderer: "slack-turn-v1", ts: TS });
    const deps = editDeps({ out: [], stdin: CARD_FORM, transport: editTransport({ message, updates }) });

    expect(await runEdit({ deps, options: editOptions({ home: homes.fresh(), ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
  });
});

describe("runEdit --as bot, over a target whose event type and renderer disagree", () => {
  it("refuses a card form at a card-typed message laid out by the poll renderer, updating nothing", async () => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({
      eventType: TEST_CARD_TYPE,
      extra: { pollId: "p1" },
      renderer: "slack-poll-v1",
      ts: TS,
    });
    const deps = editDeps({ out: [], stdin: CARD_FORM, transport: editTransport({ message, updates }) });

    expect(await runEdit({ deps, options: editOptions({ home: homes.fresh(), ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect(SlackEditTargetErrors.rendererMismatch({ at: AT, kind: "card", renderer: "slack-poll-v1" }).message).toBe(
      `refusing to re-render ${AT}: its event type marks a card but it was laid out by renderer "slack-poll-v1", so ` +
        "which renderer re-draws it cannot be told. `slopweaver slack delete` still accepts it. Nothing was changed.",
    );
  });
});

describe("the shared event-type table", () => {
  const deps = editDeps({
    out: [],
    transport: editTransport({ message: ownMessage({ eventType: "x", renderer: "x", ts: TS }), updates: [] }),
  });

  it("lets delete accept every kind, each profile type beside its stock one", () => {
    expect(deletableEventTypes({ deps, home: "/unused" })).toEqual([
      TEST_CARD_TYPE,
      "slopweaver_card_v1",
      "slopweaver_assistant_answer_v1",
      "slopweaver_assistant_answer_v2",
      DEFAULT_TURN_METADATA_EVENT_TYPE,
      TEST_POLL_TYPE,
      "slopweaver_poll_v1",
      TEST_PROGRESS_TYPE,
      "slopweaver_progress_v1",
      NOTICE_METADATA_EVENT_TYPE,
    ]);
  });

  it.each([
    { eventType: TEST_CARD_TYPE, kinds: ["card"] },
    { eventType: "slopweaver_poll_v1", kinds: ["poll"] },
    { eventType: NOTICE_METADATA_EVENT_TYPE, kinds: ["notice"] },
    { eventType: "someone_elses_v1", kinds: [] },
  ])("sorts $eventType as $kinds", ({ eventType, kinds }) => {
    expect(botMessageKindsOf({ eventType, table: botMessageEventTypes({ deps, home: "/unused" }) })).toEqual(kinds);
  });

  it("names both kinds when a profile's card type is the notice type", () => {
    const colliding = editDeps({
      cardEventType: NOTICE_METADATA_EVENT_TYPE,
      out: [],
      transport: editTransport({ message: ownMessage({ eventType: "x", renderer: "x", ts: TS }), updates: [] }),
    });
    const table = botMessageEventTypes({ deps: colliding, home: "/unused" });

    expect(botMessageKindsOf({ eventType: NOTICE_METADATA_EVENT_TYPE, table })).toEqual(["card", "notice"]);
  });
});

describe("runEdit --as bot, over a profile that reuses one event type for two kinds", () => {
  const collidingEdit = async ({ renderer }: { renderer: string }): Promise<{ code: number; methods: string[] }> => {
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({ eventType: NOTICE_METADATA_EVENT_TYPE, renderer, ts: TS });
    const deps = editDeps({
      cardEventType: NOTICE_METADATA_EVENT_TYPE,
      out: [],
      stdin: CARD_FORM,
      transport: editTransport({ message, updates }),
    });
    const code = await runEdit({ deps, options: editOptions({ home: homes.fresh(), ts: TS }) });
    return { code, methods: updates.map(({ method }) => method) };
  };

  it("re-draws a card there when its renderer says card", async () => {
    expect(await collidingEdit({ renderer: "slack-card-v1" })).toEqual({ code: EXIT_OK, methods: ["updateCard"] });
  });

  it.each(["slack-notice-v1", "slack-poll-v1"])(
    "refuses a card form at a message there laid out by %s, updating nothing",
    async (renderer) => {
      expect(await collidingEdit({ renderer })).toEqual({ code: EXIT_USAGE, methods: [] });
    },
  );

  it("names both kinds when the renderer does not settle which it is", () => {
    expect(
      SlackEditTargetErrors.ambiguous({ at: AT, eventType: NOTICE_METADATA_EVENT_TYPE, kinds: ["card", "notice"] })
        .message,
    ).toContain("(card, notice)");
  });
});

import { describe, expect, it } from "vitest";

import { storeTables } from "../../../store/policies.js";
import {
  missingQueueChangeTriggers,
  QUEUE_CHANGE_CHANNEL,
  QUEUE_CHANGE_NOTIFY_STATEMENTS,
  QUEUE_CHANGE_TRIGGERS,
  QUEUE_STORE_SLUGS,
  queueStoreSlugOf,
} from "../../../store/schema/queueChangeNotify.js";

describe("the Queue's store notify triggers", () => {
  it("give every store-kept Queue register at least one trigger", () => {
    expect(QUEUE_CHANGE_TRIGGERS.length).toBeGreaterThan(0);
    const covered = new Set(QUEUE_CHANGE_TRIGGERS.map((trigger) => trigger.slug));
    expect(QUEUE_STORE_SLUGS.filter((slug) => !covered.has(slug))).toEqual([]);
  });

  it("name only tables the schema declares", () => {
    expect(QUEUE_CHANGE_TRIGGERS.length).toBeGreaterThan(0);
    const declared = new Set(storeTables());
    expect(QUEUE_CHANGE_TRIGGERS.filter((trigger) => !declared.has(trigger.table)).map((t) => t.table)).toEqual([]);
  });

  it("give each trigger its own name", () => {
    const names = QUEUE_CHANGE_TRIGGERS.map((trigger) => trigger.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("notify once per statement, except a keyed row's table, which has a row trigger and a truncate one", () => {
    const perRow = QUEUE_CHANGE_TRIGGERS.filter((trigger) => trigger.fires.includes("for each row"));
    expect(perRow.map((trigger) => [trigger.table, trigger.slug])).toEqual([
      ["singleton_register", "reviewers"],
      ["singleton_register", "board"],
      ["home_file_import", "standing-asks"],
    ]);
    const truncates = QUEUE_CHANGE_TRIGGERS.filter((trigger) => trigger.name.endsWith("_truncate"));
    expect(truncates.map((trigger) => trigger.fires)).toEqual([
      "after truncate on public.singleton_register for each statement execute function public.queue_change_notify('reviewers')",
      "after truncate on public.singleton_register for each statement execute function public.queue_change_notify('board')",
      "after truncate on public.home_file_import for each statement execute function public.queue_change_notify('standing-asks')",
    ]);
  });

  it("pick the standing asks' import marker by its register column", () => {
    const trigger = QUEUE_CHANGE_TRIGGERS.find(
      (one) => one.name === "trg_home_file_import_standing_asks_queue_change",
    )!;
    expect(trigger.fires).toBe(
      "after insert or update or delete on public.home_file_import for each row execute function public.queue_change_notify_row('register', 'standing-asks', 'standing-asks')",
    );
  });

  it("pass each statement trigger's register as the function's argument", () => {
    const trigger = QUEUE_CHANGE_TRIGGERS.find(
      (one) => one.name === "trg_standing_ask_event_standing_asks_queue_change",
    )!;
    expect(trigger.fires).toBe(
      "after insert or update or delete or truncate on public.standing_ask_event for each statement execute function public.queue_change_notify('standing-asks')",
    );
  });

  it("create both functions before any trigger, and enable every trigger ALWAYS in its own statement", () => {
    const functions = QUEUE_CHANGE_NOTIFY_STATEMENTS.filter((s) => s.startsWith("create or replace function"));
    expect(functions.length).toBe(2);
    expect(QUEUE_CHANGE_NOTIFY_STATEMENTS.slice(0, 2)).toEqual(functions);
    const triggers = QUEUE_CHANGE_NOTIFY_STATEMENTS.slice(2);
    expect(triggers.length).toBe(QUEUE_CHANGE_TRIGGERS.length);
    expect(triggers.filter((s) => !s.includes("enable always trigger"))).toEqual([]);
  });

  it("send every notification on the one channel", () => {
    const functions = QUEUE_CHANGE_NOTIFY_STATEMENTS.filter((s) => s.startsWith("create or replace function"));
    expect(functions.filter((s) => !s.includes(`pg_notify('${QUEUE_CHANGE_CHANNEL}'`))).toEqual([]);
  });
});

describe("missingQueueChangeTriggers", () => {
  it("names every trigger for a store reporting none", () => {
    expect(missingQueueChangeTriggers({ installed: [] })).toEqual(QUEUE_CHANGE_TRIGGERS.map((t) => t.name));
  });

  it("names none when every trigger is installed, whatever else the store has", () => {
    const installed = [{ name: "trg_unrelated", table: "content" }, ...QUEUE_CHANGE_TRIGGERS];
    expect(missingQueueChangeTriggers({ installed })).toEqual([]);
  });

  it("counts a trigger of the right name on the wrong table as missing", () => {
    const installed = QUEUE_CHANGE_TRIGGERS.map((trigger) =>
      trigger.name === "trg_autonomy_event_autonomy_queue_change"
        ? { ...trigger, table: "autonomy_register" }
        : trigger,
    );
    expect(missingQueueChangeTriggers({ installed })).toEqual(["trg_autonomy_event_autonomy_queue_change"]);
  });
});

describe("queueStoreSlugOf", () => {
  it("reads a register a trigger sends", () => {
    expect(queueStoreSlugOf({ payload: "workstreams" })).toBe("workstreams");
  });

  it("refuses a payload no trigger sends", () => {
    expect(queueStoreSlugOf({ payload: "drafts" })).toBeUndefined();
    expect(queueStoreSlugOf({ payload: "" })).toBeUndefined();
  });
});

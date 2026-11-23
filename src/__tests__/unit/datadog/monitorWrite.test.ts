import { describe, expect, it } from "vitest";

import {
  alertOnlyViolations,
  isIacManaged,
  monitorDeleteDigest,
  monitorUpdateDigest,
  parseMonitorPatch,
  planMonitorUpdate,
  readBackMismatches,
} from "../../../datadog/monitorWrite.js";
import { DatadogMonitorWriteErrors } from "../../../datadog/monitorWriteErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { cpuMonitor } from "../../monitorApiFake.js";

const EXCLUDED = "avg(last_5m):avg:system.cpu.user{!host:adaowner-macbook-pro} by {host} > 90";

describe("parseMonitorPatch", () => {
  it("accepts the fields this verb changes", () => {
    expect(unwrap(parseMonitorPatch({ value: { query: EXCLUDED, tags: ["a"] } }))).toEqual({
      query: EXCLUDED,
      tags: ["a"],
    });
  });

  it("refuses a field this verb does not change, naming it", () => {
    const error = unwrapErr(parseMonitorPatch({ value: { query: EXCLUDED, type: "log alert" } }));
    expect(error.code).toBe("PATCH_INVALID");
    expect(error.message).toContain("type");
  });

  it("refuses an empty change rather than reading it as nothing to do", () => {
    expect(unwrapErr(parseMonitorPatch({ value: {} }))).toEqual(
      DatadogMonitorWriteErrors.patchInvalid({ detail: "it names no field to change" }),
    );
  });

  it("refuses a document that is not an object, at the root", () => {
    expect(unwrapErr(parseMonitorPatch({ value: [] })).message).toContain("(root)");
  });
});

describe("planMonitorUpdate", () => {
  it("puts only the changed field in the body", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    expect(plan.body).toEqual({ query: EXCLUDED });
    expect(plan.changes).toEqual([{ after: EXCLUDED, before: cpuMonitor().query, field: "query" }]);
  });

  it("leaves out a field the patch names but does not change", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { name: "Host CPU high", query: EXCLUDED } }));
    expect(Object.keys(plan.body)).toEqual(["query"]);
  });

  it("merges an option over the live options and sends the merged object whole", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { options: { notify_no_data: true } } }));
    expect(plan.body.options).toEqual({ ...cpuMonitor().options, notify_no_data: true });
    expect(plan.changes).toEqual([{ after: true, before: false, field: "options.notify_no_data" }]);
  });

  it("answers NO_CHANGE when the monitor already reads that way", () => {
    expect(unwrapErr(planMonitorUpdate({ live: cpuMonitor(), patch: { query: cpuMonitor().query } }))).toEqual(
      DatadogMonitorWriteErrors.noChange({ id: 50100 }),
    );
  });
});

describe("alertOnlyViolations", () => {
  it.each(["{{#is_recovery}}", "{{ #is_alert_recovery }}", "{{#is_warning_recovery}}", "{{#is_no_data_recovery}}"])(
    "refuses a message that adds a recovery block spelled %s",
    (block) => {
      const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { message: `${block}ok{{/is_recovery}}` } }));
      expect(alertOnlyViolations({ plan })).toEqual(["adds a {{#is_recovery}} block to the message"]);
    },
  );

  it("does not refuse a change that keeps a recovery block the live monitor already had", () => {
    const live = cpuMonitor({ message: "{{#is_recovery}}ok{{/is_recovery}}" });
    const plan = unwrap(planMonitorUpdate({ live, patch: { query: EXCLUDED } }));
    expect(alertOnlyViolations({ plan })).toEqual([]);
  });

  it.each([
    [60, "sets renotify_interval to 60"],
    ["60", 'sets renotify_interval to "60"'],
  ])("refuses a renotify interval of %j", (interval, violation) => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { options: { renotify_interval: interval } } }));
    expect(alertOnlyViolations({ plan })).toEqual([violation]);
  });

  it("allows setting renotify to null, which Datadog reads as never", () => {
    const live = cpuMonitor({ options: { renotify_interval: 30 } });
    const plan = unwrap(planMonitorUpdate({ live, patch: { options: { renotify_interval: null } } }));
    expect(alertOnlyViolations({ plan })).toEqual([]);
  });

  it("allows setting renotify back to zero", () => {
    const live = cpuMonitor({ options: { renotify_interval: 30 } });
    const plan = unwrap(planMonitorUpdate({ live, patch: { options: { renotify_interval: 0 } } }));
    expect(alertOnlyViolations({ plan })).toEqual([]);
  });

  it("does not blame a query change for a renotify interval the live monitor already carries", () => {
    const live = cpuMonitor({ options: { renotify_interval: 30 } });
    const plan = unwrap(planMonitorUpdate({ live, patch: { options: { notify_no_data: true } } }));
    expect(alertOnlyViolations({ plan })).toEqual([]);
  });
});

describe("readBackMismatches", () => {
  it("names a changed field that reads otherwise afterwards", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    expect(readBackMismatches({ after: cpuMonitor(), plan })).toEqual(["query"]);
  });

  it("reads an option change inside the options", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { options: { notify_no_data: true } } }));
    const after = cpuMonitor({ options: { ...cpuMonitor().options, notify_no_data: true } });
    expect(readBackMismatches({ after, plan })).toEqual([]);
  });
});

describe("isIacManaged", () => {
  const TAGS = ["managed-by:acme-iac", "owner:acme-platform"] as const;

  it("is false for every monitor when no ownership tag is configured — the guard is inert", () => {
    expect(isIacManaged({ iacManagedTags: [], monitor: cpuMonitor({ tags: ["managed-by:acme-iac"] }) })).toBe(false);
  });

  it("is false for a monitor carrying none of the configured tags, nor a near-miss of one", () => {
    expect(isIacManaged({ iacManagedTags: TAGS, monitor: cpuMonitor() })).toBe(false);
    expect(isIacManaged({ iacManagedTags: TAGS, monitor: cpuMonitor({ tags: ["managed-by:acme"] }) })).toBe(false);
  });

  it("is true for a monitor carrying either configured tag exactly", () => {
    const first = cpuMonitor({ tags: ["team:platform", "managed-by:acme-iac"] });
    const second = cpuMonitor({ tags: ["owner:acme-platform"] });
    expect(isIacManaged({ iacManagedTags: TAGS, monitor: first })).toBe(true);
    expect(isIacManaged({ iacManagedTags: TAGS, monitor: second })).toBe(true);
  });
});

describe("the approval digests", () => {
  it("moves when the monitor is edited after the preview", () => {
    const before = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    const edited = unwrap(
      planMonitorUpdate({ live: cpuMonitor({ modified: "2026-09-30T00:00:00Z" }), patch: { query: EXCLUDED } }),
    );
    expect(monitorUpdateDigest({ plan: edited })).not.toBe(monitorUpdateDigest({ plan: before }));
  });

  it("moves when the change is worded differently", () => {
    const one = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    const other = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: `${EXCLUDED}0` } }));
    expect(monitorUpdateDigest({ plan: other })).not.toBe(monitorUpdateDigest({ plan: one }));
  });

  it("is sixteen hex characters and stable across reads", () => {
    const plan = unwrap(planMonitorUpdate({ live: cpuMonitor(), patch: { query: EXCLUDED } }));
    expect(monitorUpdateDigest({ plan })).toMatch(/^[0-9a-f]{16}$/u);
    expect(monitorUpdateDigest({ plan })).toBe(monitorUpdateDigest({ plan: { ...plan } }));
  });

  it("binds a delete to the exact list, in order", () => {
    const first = cpuMonitor();
    const second = cpuMonitor({ id: 50792 });
    expect(monitorDeleteDigest({ monitors: [first, second] })).not.toBe(
      monitorDeleteDigest({ monitors: [second, first] }),
    );
    expect(monitorDeleteDigest({ monitors: [first] })).not.toBe(monitorDeleteDigest({ monitors: [first, second] }));
  });
});

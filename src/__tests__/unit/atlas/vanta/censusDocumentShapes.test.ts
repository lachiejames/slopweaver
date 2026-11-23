/**
 * The person, group and monitored-computer rows as the pinned Manage API document declares them, where that
 * is wider than any live row has yet been: a nullable name half, an open-ended leave, a task switched off with
 * its date and reason, an integration source with no resource id, a group with no creation date, a device that
 * reports no UDID or operating system. Every one of these once refused its whole page. Every id is synthetic.
 */
import { describe, expect, it } from "vitest";

import { vantaGroupDtoSchema, vantaMonitoredComputerDtoSchema } from "../../../../atlas/vanta/censusApiSchemas.js";
import { vantaPersonDtoSchema } from "../../../../atlas/vanta/personApiSchemas.js";

const SOURCE = { integrationId: "shape-integration", resourceId: "shape-resource", type: "INTEGRATION" } as const;

const TASK = { completionDate: null, disabled: null, dueDate: null, status: "COMPLETE", taskType: "t" } as const;

const personJson = {
  emailAddress: "shape.person@example.test",
  employment: { endDate: null, jobTitle: null, startDate: "2026-01-01T00:00:00.000Z", status: "CURRENT" },
  groupIds: [],
  id: "shape-person-id",
  leaveInfo: null,
  name: { display: "Shape Person", first: "Shape", last: "Person" },
  sources: { emailAddress: SOURCE, employment: { endDate: SOURCE, startDate: SOURCE } },
  tasksSummary: {
    completionDate: null,
    details: {
      acceptPolicies: { ...TASK, acceptedPolicies: [], unacceptedPolicies: [] },
      completeBackgroundChecks: TASK,
      completeCustomTasks: { ...TASK, completedCustomTasks: [], incompleteCustomTasks: [] },
      completeOffboardingCustomTasks: {
        ...TASK,
        completedCustomOffboardingTasks: [],
        incompleteCustomOffboardingTasks: [],
      },
      completeTrainings: { ...TASK, completedTrainings: [], incompleteTrainings: [] },
      installDeviceMonitoring: TASK,
    },
    dueDate: null,
    status: "COMPLETE",
  },
  userId: null,
} as const;

const TASK_KINDS = [
  "acceptPolicies",
  "completeBackgroundChecks",
  "completeCustomTasks",
  "completeOffboardingCustomTasks",
  "completeTrainings",
  "installDeviceMonitoring",
] as const;

/** The person with one task switched off, the rest left as they were. */
function withDisabledTask({
  kind,
  disabled,
}: {
  kind: (typeof TASK_KINDS)[number];
  disabled: unknown;
}): Record<string, unknown> {
  const details = personJson.tasksSummary.details;
  return {
    ...personJson,
    tasksSummary: { ...personJson.tasksSummary, details: { ...details, [kind]: { ...details[kind], disabled } } },
  };
}

describe("vantaPersonDtoSchema against the document", () => {
  it("reads a person with neither a first nor a last name, both declared nullable", () => {
    const row = { ...personJson, name: { display: "Mononym", first: null, last: null } };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads the program scopes the served document added, and a person without them", () => {
    const row = { ...personJson, programScopeIds: ["scope-1", "scope-2"] };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
    expect(vantaPersonDtoSchema.parse(personJson)).toStrictEqual(personJson);
  });

  it("reads an open-ended leave, whose null endDate the document calls indefinite", () => {
    const row = {
      ...personJson,
      leaveInfo: { endDate: null, startDate: "2026-10-01T00:00:00.000Z", status: "ACTIVE" },
    };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("reads an integration source whose resourceId is null, as the INTEGRATION arm declares", () => {
    const nullResource = { ...SOURCE, resourceId: null };
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: nullResource } };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("still reads a VANTA source carrying only its type, a shape live people have carried", () => {
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: { type: "VANTA" } } };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("still refuses each widened field at its own path when it is neither null nor its declared type", () => {
    const cases = [
      { ...personJson, name: { ...personJson.name, first: 1 } },
      { ...personJson, name: { ...personJson.name, last: 1 } },
      { ...personJson, leaveInfo: { endDate: 1, startDate: "2026-10-01T00:00:00.000Z", status: "ACTIVE" } },
      { ...personJson, programScopeIds: "scope-1" },
      { ...personJson, programScopeIds: null },
    ];
    expect(cases.map((row) => vantaPersonDtoSchema.safeParse(row).error!.issues.map((issue) => issue.path))).toEqual([
      [["name", "first"]],
      [["name", "last"]],
      [["leaveInfo", "endDate"]],
      [["programScopeIds"]],
      [["programScopeIds"]],
    ]);
  });

  it("reads a SCIM source carrying only its type, the document's third arm", () => {
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: { type: "SCIM" } } };
    expect(vantaPersonDtoSchema.parse(row)).toStrictEqual(row);
  });

  it("refuses an INTEGRATION source missing the ids its arm requires, at that source's path", () => {
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: { type: "INTEGRATION" } } };
    const parsed = vantaPersonDtoSchema.safeParse(row);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path)).toEqual([
      ["sources", "emailAddress", "integrationId"],
      ["sources", "emailAddress", "resourceId"],
    ]);
  });

  it("refuses a source type the document does not declare, at its type", () => {
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: { type: "HRIS" } } };
    const parsed = vantaPersonDtoSchema.safeParse(row);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["sources", "emailAddress", "type"]);
  });

  it("refuses ids on a VANTA source, whose arm carries its type alone", () => {
    const row = { ...personJson, sources: { ...personJson.sources, emailAddress: { ...SOURCE, type: "VANTA" } } };
    const parsed = vantaPersonDtoSchema.safeParse(row);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
  });

  it("reads every one of the six tasks switched off, with its date and a null reason, whole", () => {
    expect(TASK_KINDS.length).toBe(6);
    const rows = TASK_KINDS.map((kind) =>
      withDisabledTask({ disabled: { date: "2026-10-03T00:00:00.000Z", reason: null }, kind }),
    );
    expect(rows.map((row) => vantaPersonDtoSchema.parse(row))).toStrictEqual(rows);
  });

  it("keeps a disabled task's reason exactly as returned", () => {
    const disabled = { date: "2026-10-03T00:00:00.000Z", reason: "contractor, no training owed" };
    const parsed = vantaPersonDtoSchema.parse(withDisabledTask({ disabled, kind: "completeTrainings" }));
    expect(parsed.tasksSummary.details.completeTrainings.disabled).toStrictEqual(disabled);
  });

  it("refuses the boolean disabled it used to read, at that task's own path", () => {
    const parsed = vantaPersonDtoSchema.safeParse(withDisabledTask({ disabled: true, kind: "acceptPolicies" }));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["tasksSummary", "details", "acceptPolicies", "disabled"]);
  });

  it("refuses an unknown key inside a disabled record, at that path", () => {
    const disabled = { by: "someone", date: "2026-10-03T00:00:00.000Z", reason: null };
    const parsed = vantaPersonDtoSchema.safeParse(withDisabledTask({ disabled, kind: "installDeviceMonitoring" }));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.code).toBe("unrecognized_keys");
    expect(parsed.error!.issues[0]!.path).toEqual(["tasksSummary", "details", "installDeviceMonitoring", "disabled"]);
  });
});

describe("vantaGroupDtoSchema against the document", () => {
  const groupJson = {
    creationDate: null,
    description: null,
    id: "shape-group-id",
    name: "Shape Group",
    personnelCount: 4,
    pointOfContact: null,
    source: "Vanta",
  } as const;

  it("reads a group with no creation date, which the document declares nullable", () => {
    expect(vantaGroupDtoSchema.parse(groupJson)).toStrictEqual(groupJson);
  });

  it("still refuses one that omits creationDate, which the document marks required", () => {
    const { creationDate: _omitted, ...withoutDate } = groupJson;
    const parsed = vantaGroupDtoSchema.safeParse(withoutDate);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues[0]!.path).toEqual(["creationDate"]);
  });
});

describe("vantaMonitoredComputerDtoSchema against the document", () => {
  const deviceJson = {
    antivirusInstallation: { outcome: "PASS" },
    diskEncryption: { outcome: "PASS" },
    id: "shape-device-id",
    integrationId: "shape-mdm",
    lastCheckDate: null,
    operatingSystem: null,
    owner: null,
    passwordManager: { outcome: "PASS" },
    screenlock: { outcome: "PASS" },
    serialNumber: null,
    udid: null,
  } as const;

  it("reads a device reporting neither a UDID nor an operating system, both declared nullable", () => {
    expect(vantaMonitoredComputerDtoSchema.parse(deviceJson)).toStrictEqual(deviceJson);
  });

  it("still refuses one that omits udid and operatingSystem, which the document marks required", () => {
    const { udid: _udid, operatingSystem: _os, ...withoutBoth } = deviceJson;
    const parsed = vantaMonitoredComputerDtoSchema.safeParse(withoutBoth);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path)).toEqual([["operatingSystem"], ["udid"]]);
  });
});

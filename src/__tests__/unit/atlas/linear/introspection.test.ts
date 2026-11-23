import { describe, expect, it } from "vitest";

import {
  type IntrospectedType,
  introspectionBatchQuery,
  missingFromBatch,
  operationRecords,
  schemaFingerprint,
  typeRecords,
} from "../../../../atlas/linear/introspection.js";

const scalar = ({ name }: { name: string }): IntrospectedType => ({
  description: null,
  enumValues: null,
  fields: null,
  inputFields: null,
  kind: "SCALAR",
  name,
});

const TYPES: readonly IntrospectedType[] = [
  {
    description: "the root",
    enumValues: null,
    fields: [
      {
        args: [{ name: "first" }, { name: "after" }],
        deprecationReason: null,
        description: "every team",
        isDeprecated: false,
        name: "teams",
        type: { kind: "OBJECT", name: "TeamConnection", ofType: null },
      },
      {
        args: [],
        deprecationReason: "use initiatives",
        description: null,
        isDeprecated: true,
        name: "roadmaps",
        type: { kind: "OBJECT", name: "Nothing", ofType: null },
      },
    ],
    inputFields: null,
    kind: "OBJECT",
    name: "Query",
  },
  {
    description: null,
    enumValues: null,
    fields: [
      {
        args: [{ name: "input" }],
        deprecationReason: null,
        description: null,
        isDeprecated: false,
        name: "teamCreate",
        type: { kind: "OBJECT", name: "Nothing", ofType: null },
      },
    ],
    inputFields: null,
    kind: "OBJECT",
    name: "Mutation",
  },
  {
    description: null,
    enumValues: null,
    fields: [
      {
        args: [],
        deprecationReason: null,
        description: null,
        isDeprecated: false,
        name: "nodes",
        type: { kind: "NON_NULL", name: null, ofType: { kind: "OBJECT", name: "Team", ofType: null } },
      },
    ],
    inputFields: null,
    kind: "OBJECT",
    name: "TeamConnection",
  },
  {
    description: null,
    enumValues: null,
    fields: [
      {
        args: [],
        deprecationReason: null,
        description: null,
        isDeprecated: false,
        name: "key",
        type: { kind: "SCALAR", name: "String", ofType: null },
      },
      {
        args: [],
        deprecationReason: null,
        description: null,
        isDeprecated: true,
        name: "oldName",
        type: { kind: "SCALAR", name: "String", ofType: null },
      },
    ],
    inputFields: null,
    kind: "OBJECT",
    name: "Team",
  },
  { description: null, enumValues: null, fields: [], inputFields: null, kind: "OBJECT", name: "Nothing" },
  {
    description: null,
    enumValues: [
      { isDeprecated: false, name: "asc" },
      { isDeprecated: false, name: "desc" },
    ],
    fields: null,
    inputFields: null,
    kind: "ENUM",
    name: "Direction",
  },
  scalar({ name: "String" }),
];

describe("operationRecords", () => {
  it("keys a root field by its root kind and name", () => {
    const records = operationRecords({ types: TYPES });
    expect(records.map((record) => record.providerId)).toEqual([
      "mutation.teamCreate",
      "query.roadmaps",
      "query.teams",
    ]);
  });

  it("stores the argument names the schema declares, sorted", () => {
    const teams = operationRecords({ types: TYPES }).find((record) => record.providerId === "query.teams")!;
    expect(teams.detail.paramNames).toEqual(["after", "first"]);
  });

  it("resolves response paths one level into the return type", () => {
    const teams = operationRecords({ types: TYPES }).find((record) => record.providerId === "query.teams")!;
    expect(teams.detail.responsePaths).toEqual(["nodes", "nodes.key", "nodes.oldName"]);
  });

  it("unwraps a NON_NULL wrapper to name the return type", () => {
    const teams = operationRecords({ types: TYPES }).find((record) => record.providerId === "query.teams")!;
    expect(teams.detail.returnType).toBe("TeamConnection");
  });

  it("carries the schema's own deprecation reason forward", () => {
    const roadmaps = operationRecords({ types: TYPES }).find((record) => record.providerId === "query.roadmaps")!;
    expect(roadmaps.detail.isDeprecated).toBe(true);
    expect(roadmaps.detail.deprecationReason).toBe("use initiatives");
  });

  it("records no field under a root the schema does not declare", () => {
    const records = operationRecords({ types: TYPES });
    expect(records.filter((record) => record.detail.rootKind === "subscription")).toEqual([]);
    expect(records.length).toBe(3);
  });

  it("records the root kind a field hangs off", () => {
    const created = operationRecords({ types: TYPES }).find((record) => record.providerId === "mutation.teamCreate")!;
    expect(created.detail.rootKind).toBe("mutation");
  });
});

describe("typeRecords", () => {
  it("stores an object's field names and the deprecated subset separately", () => {
    const team = typeRecords({ types: TYPES }).find((record) => record.providerId === "Team")!;
    expect(team.detail.fieldNames).toEqual(["key", "oldName"]);
    expect(team.detail.deprecatedFieldNames).toEqual(["oldName"]);
  });

  it("stores an enum's members", () => {
    const direction = typeRecords({ types: TYPES }).find((record) => record.providerId === "Direction")!;
    expect(direction.detail.enumValues).toEqual(["asc", "desc"]);
    expect(direction.detail.typeKind).toBe("ENUM");
  });

  it("stores every name list empty for a scalar, whose introspection answers each list with null", () => {
    const text = typeRecords({ types: TYPES }).find((record) => record.providerId === "String")!;
    expect(text.detail).toEqual({
      deprecatedFieldNames: [],
      description: "",
      enumValues: [],
      fieldNames: [],
      inputFieldNames: [],
      typeKind: "SCALAR",
    });
  });

  it("drops introspection's own meta types", () => {
    const withMeta = [...TYPES, scalar({ name: "__Type" })];
    expect(typeRecords({ types: withMeta }).map((record) => record.providerId)).not.toContain("__Type");
  });
});

describe("missingFromBatch", () => {
  it("names every requested type a batch did not return", () => {
    expect(missingFromBatch({ requested: ["A", "B", "C"], returned: ["C", "A"] })).toEqual(["B"]);
  });

  it("is empty when the batch came back whole", () => {
    expect(missingFromBatch({ requested: ["A", "B"], returned: ["B", "A"] })).toEqual([]);
  });
});

describe("schemaFingerprint", () => {
  it("changes when a root type gains a field", () => {
    const before = schemaFingerprint({ types: TYPES });
    const grown = TYPES.map((type) =>
      type.name === "Query"
        ? {
            ...type,
            fields: [
              // TYPES declares Query with a field list, so the root being grown has one.
              ...type.fields!,
              {
                args: [],
                deprecationReason: null,
                description: null,
                isDeprecated: false,
                name: "brandNew",
                type: { kind: "OBJECT", name: "Nothing", ofType: null },
              },
            ],
          }
        : type,
    );
    expect(schemaFingerprint({ types: grown })).not.toBe(before);
  });

  it("counts each kind and each root, and a root the schema does not declare as zero fields", () => {
    expect(schemaFingerprint({ types: TYPES })).toBe(
      "types=7;ENUM=1,OBJECT=5,SCALAR=1;Mutation=1,Query=2,Subscription=0",
    );
  });

  it("is stable across two readings of the same schema", () => {
    expect(schemaFingerprint({ types: TYPES })).toBe(schemaFingerprint({ types: [...TYPES] }));
  });
});

describe("introspectionBatchQuery", () => {
  it("gives every requested type its own alias", () => {
    const query = introspectionBatchQuery({ typeNames: ["Team", "Query"] });
    expect(query).toContain('t0: __type(name: "Team")');
    expect(query).toContain('t1: __type(name: "Query")');
  });

  it("JSON-encodes a name so it cannot break out of the document", () => {
    expect(introspectionBatchQuery({ typeNames: ['a"b'] })).toContain('__type(name: "a\\"b")');
  });
});

import { describe, expect, it } from "vitest";

import {
  type DiscoveryMethod,
  type DiscoveryResource,
  discoveryResourceSchema,
  walkDiscoveryResources,
} from "../../../../atlas/geminiAiStudio/discoveryTree.js";

/** One minimal method, named by its id. */
function method({ id }: { id: string }): DiscoveryMethod {
  return { httpMethod: "GET", id, path: `v1/${id}` };
}

/** Every method a walk hands back, as `<dotted path> <method name>`, in walk order. */
function walked({ resources }: { resources: Readonly<Record<string, DiscoveryResource>> | undefined }): string[] {
  const seen: string[] = [];
  walkDiscoveryResources({
    collect: ({ path, methodName }) => {
      seen.push(`${path.join(".")} ${methodName}`);
    },
    resources,
  });
  return seen;
}

describe("walkDiscoveryResources", () => {
  it("hands every method its own dotted resource path, depth first", () => {
    const resources: Record<string, DiscoveryResource> = {
      files: { methods: { list: method({ id: "files.list" }) } },
      models: {
        methods: { get: method({ id: "models.get" }) },
        resources: { operations: { methods: { list: method({ id: "models.operations.list" }) } } },
      },
    };
    expect(walked({ resources })).toEqual(["files list", "models get", "models.operations list"]);
  });

  it("walks nothing for a document that declares no resources", () => {
    expect(walked({ resources: undefined })).toEqual([]);
  });

  it("walks through a resource that declares only nested resources and no methods of its own", () => {
    const resources: Record<string, DiscoveryResource> = {
      models: { resources: { operations: { methods: { list: method({ id: "models.operations.list" }) } } } },
    };
    expect(walked({ resources })).toEqual(["models.operations list"]);
  });

  it("hands nothing for a resource that declares neither methods nor nested resources", () => {
    expect(walked({ resources: { empty: {} } })).toEqual([]);
  });
});

describe("discoveryResourceSchema", () => {
  it("accepts a nested resource tree whose methods carry only the required keys", () => {
    const parsed = discoveryResourceSchema.safeParse({
      resources: { operations: { methods: { list: { httpMethod: "GET", id: "x.list", path: "v1/x" } } } },
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a method missing its required http method", () => {
    const parsed = discoveryResourceSchema.safeParse({ methods: { list: { id: "x.list", path: "v1/x" } } });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["methods.list.httpMethod"]);
  });
});

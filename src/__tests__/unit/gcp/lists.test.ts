import { describe, expect, it } from "vitest";

import { bindingsOf, containersOf, envOf, membersOf } from "../../../gcp/lists.js";

describe("the lists Google omits when empty", () => {
  it("reads an omitted list as none", () => {
    expect(containersOf({ template: {} })).toEqual([]);
    expect(envOf({ container: { image: "img" } })).toEqual([]);
    expect(bindingsOf({ policy: {} })).toEqual([]);
    expect(membersOf({ binding: { role: "roles/viewer" } })).toEqual([]);
  });

  it("returns a present list as it stands", () => {
    const env = [{ name: "MODE", value: "prod" }];
    const container = { env, image: "img" };
    expect(containersOf({ template: { containers: [container] } })).toEqual([container]);
    expect(envOf({ container })).toEqual(env);
    const binding = { members: ["user:a@example.com"], role: "roles/viewer" };
    expect(bindingsOf({ policy: { bindings: [binding] } })).toEqual([binding]);
    expect(membersOf({ binding })).toEqual(["user:a@example.com"]);
  });
});

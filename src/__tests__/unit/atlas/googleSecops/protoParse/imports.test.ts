/**
 * The narrow proto reader's import statements: every named dependency or pinned-directory import is read in
 * order, and any other path, or one that does not end at its `;`, is refused.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleProto, parseChronicleProtoFile } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneRpc } from "./harness.js";

describe("parseChronicleProto", () => {
  it("reads every import, in order, of a named dependency or the pinned directory", () => {
    const rpc = 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }';
    const statements = [
      'import "google/api/annotations.proto";',
      'import public "google/cloud/chronicle/v1/entity.proto";',
      'import weak "google/type/date.proto";',
    ];
    const file = unwrap(
      parseChronicleProtoFile({ document: "rule.proto", text: `${statements.join("\n")}\n${oneRpc({ rpc })}` }),
    );
    expect([file.imports, file.rpcs.map((row) => row.id)]).toStrictEqual([
      ["google/api/annotations.proto", "google/cloud/chronicle/v1/entity.proto", "google/type/date.proto"],
      ["google.cloud.chronicle.v1.RuleService.GetRule"],
    ]);
  });

  it("refuses an import that is not a named dependency, even in a dependency's namespace, wherever it sits", () => {
    const rpc = 'rpc GetRule(GetRuleRequest) returns (Rule) { option (google.api.http) = { get: "/v1/a" }; }';
    const paths = [
      "google/api/scope_bridge.proto",
      "google/cloud/extended_operations.proto",
      "google/api/../cloud/x.proto",
      "evil/google/api/annotations.proto",
      "google/api/annotations.proto/../../cloud/y.proto",
      "Google/api/annotations.proto",
      " google/api/annotations.proto",
      "evil/google/cloud/chronicle/v1/rule.proto",
      "google/cloud/chronicle/v1/rule.proto/../x.proto",
      "google/cloud/chronicle/v1/../v1/rule.proto",
      "google/cloud/chronicle/v2/rule.proto",
      "Google/cloud/chronicle/v1/rule.proto",
      "google/cloud/chronicle/V1/rule.proto",
    ];
    // Each sits between two accepted imports, so a reader checking only the first or last would pass it.
    const refused = paths.map(
      (path) =>
        unwrapErr(
          parseChronicleProto({
            document: "rule.proto",
            text: `import "google/api/annotations.proto";\nimport "${path}";\nimport "google/api/client.proto";\n${oneRpc({ rpc })}`,
          }),
        ).message,
    );
    expect(refused).toStrictEqual(
      paths.map(
        (path) =>
          `rule.proto could not be parsed: imports ${path}, which is neither a known dependency nor in the pinned directory`,
      ),
    );
  });

  it("refuses an import that does not end at its ;, so a second path cannot ride along unchecked", () => {
    const text = `import "google/api/annotations.proto" "evil/x.proto";\n${oneRpc({ rpc: "" })}`;
    expect(unwrapErr(parseChronicleProto({ document: "rule.proto", text })).message).toBe(
      `rule.proto could not be parsed: import google/api/annotations.proto: expected ';', found a string "evil/x.proto"`,
    );
  });
});

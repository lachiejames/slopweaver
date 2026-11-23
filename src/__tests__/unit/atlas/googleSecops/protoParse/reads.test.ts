/**
 * What the narrow proto reader reads: a GET and a POST binding through the comment and option noise of a real
 * Chronicle file, a file of messages only, and the edition, extend, stream and stray-`;` constructs it passes over.
 */
import { describe, expect, it } from "vitest";

import { parseChronicleProto } from "../../../../../atlas/googleSecops/protoParse.js";
import { unwrap } from "../../../../../lib/result.js";

/** A service carrying a GET and a POST `:search`, with the comment and option noise a real file has. */
const TWO_RPCS = `
syntax = "proto3";

package google.cloud.chronicle.v1;

import "google/api/annotations.proto";

option java_package = "com.google.cloud.chronicle.v1";

// RuleService provides an interface for { braces } in a comment.
service RuleService {
  option (google.api.default_host) = "chronicle.googleapis.com";
  option (google.api.oauth_scopes) =
      "https://www.googleapis.com/auth/cloud-platform";

  /* Lists rules. */
  rpc ListRules(ListRulesRequest)
      returns (ListRulesResponse) {
    option (google.api.http) = {
      get: "/v1/{parent=projects/*/locations/*/instances/*}/rules"
    };
    option (google.api.method_signature) = "parent";
  }

  rpc SearchRules(SearchRulesRequest) returns (SearchRulesResponse) {
    option (google.api.http) = {
      post: "/v1/{parent=projects/*/locations/*/instances/*}/rules:search"
      body: "*"
    };
  }
}

message ListRulesRequest {
  string parent = 1 [(google.api.field_behavior) = REQUIRED];
}
`;

describe("parseChronicleProto", () => {
  it("reads a GET and a POST :search, each with its one binding, ignoring comments and other options", () => {
    const rpcs = unwrap(parseChronicleProto({ document: "rule.proto", text: TWO_RPCS }));
    expect(rpcs).toStrictEqual([
      {
        document: "rule.proto",
        httpMethod: "GET",
        id: "google.cloud.chronicle.v1.RuleService.ListRules",
        pathTemplate: "/v1/{parent=projects/*/locations/*/instances/*}/rules",
        rpc: "ListRules",
        service: "google.cloud.chronicle.v1.RuleService",
      },
      {
        document: "rule.proto",
        httpMethod: "POST",
        id: "google.cloud.chronicle.v1.RuleService.SearchRules",
        pathTemplate: "/v1/{parent=projects/*/locations/*/instances/*}/rules:search",
        rpc: "SearchRules",
        service: "google.cloud.chronicle.v1.RuleService",
      },
    ]);
  });

  it("answers an empty list for a file of messages only", () => {
    const text = "package google.cloud.chronicle.v1;\nmessage FeaturedContentMetadata { string id = 1; }\n";
    expect(unwrap(parseChronicleProto({ document: "featured_content_metadata.proto", text }))).toStrictEqual([]);
  });

  it("reads an edition, a top-level extend, a stream type and a stray ; in a service or an rpc body", () => {
    const text = `edition = "2023";
package google.cloud.chronicle.v1;
extend google.protobuf.MessageOptions { string tag = 50000; }
service RuleService {
  ;
  rpc StreamRules(stream StreamRulesRequest) returns (stream Rule) {
    ;
    option (google.api.http) = { get: "/v1/a" };
  }
}
`;
    const rpcs = unwrap(parseChronicleProto({ document: "rule.proto", text }));
    expect(rpcs.map((rpc) => [rpc.id, rpc.httpMethod, rpc.pathTemplate])).toStrictEqual([
      ["google.cloud.chronicle.v1.RuleService.StreamRules", "GET", "/v1/a"],
    ]);
  });
});

/*
 * `classifyRawCommand` on `gh api graphql`: a lone read passes, and any document that could run a mutation, or whose
 * query the shell could splice into one, is blocked or fails closed.
 */
import { describe, expect, it } from "vitest";

import { isBlocked } from "./harness.js";

describe("classifyRawCommand", () => {
  describe("gh api graphql", () => {
    it("allows a lone anonymous-shorthand read", () => {
      expect(isBlocked({ command: "gh api graphql -f query='{ viewer { login } }'" })).toBe(false);
    });

    it("allows a lone named query read", () => {
      expect(isBlocked({ command: "gh api graphql -f query='query Read { viewer { login } }'" })).toBe(false);
    });

    it("allows a query preceded by a comment line", () => {
      expect(
        isBlocked({
          command: "gh api graphql -f query='# current viewer\nquery Read { viewer { login } }'",
        }),
      ).toBe(false);
    });

    it("blocks a lone mutation", () => {
      expect(isBlocked({ command: "gh api graphql -f query='mutation Write { addReaction(input: {}) { id } }'" })).toBe(
        true,
      );
    });

    it("blocks a query-first document that also defines a mutation, selectable via operationName", () => {
      expect(
        isBlocked({
          command:
            "gh api graphql -f operationName=Write -f query='query Read { viewer { login } }\nmutation Write($id: ID!) { addReaction(input: {subjectId: $id, content: HOORAY}) { clientMutationId } }' -f id=X",
        }),
      ).toBe(true);
    });

    it("blocks a fragment-first document whose real operation is a mutation", () => {
      expect(
        isBlocked({
          command:
            "gh api graphql -f query='fragment Result on AddReactionPayload { clientMutationId }\nmutation Write($id: ID!) { addReaction(input: {subjectId: $id, content: HOORAY}) { ...Result } }' -f id=X",
        }),
      ).toBe(true);
    });

    it("is not fooled by adjacent shell quotes concatenating a mutation past a truncated capture boundary", () => {
      // The shell joins 'query { … } mu' and 'tation Write { … }' into one continuous string with no gap, so
      // a scan bounded at the first quote after `mu` would see only "mu" and miss the completed keyword.
      expect(
        isBlocked({
          command:
            "gh api graphql -f operationName=Write -f query='query Read { viewer { login } } mu''tation Write($id: ID!) { addReaction(input: {subjectId: $id, content: HOORAY}) { clientMutationId } }' -f id=X",
        }),
      ).toBe(true);
    });

    it("is not fooled by MIXED adjacent shell quotes concatenating a mutation", () => {
      // 'query...} mu' immediately followed by "tation Write { __typename }" — the shell still joins them
      // even though the quote style changes at the seam.
      expect(
        isBlocked({
          command: `gh api graphql -f operationName=Write -f query='query Read { viewer { login } } mu'"tation Write { __typename }"`,
        }),
      ).toBe(true);
    });

    it("fails closed on ANSI-C ($'…') quoting rather than trying to parse through it", () => {
      expect(
        isBlocked({
          command: `gh api graphql -f operationName=Write -f query="query Read { viewer { login } } mu"$'tation Write { __typename }'`,
        }),
      ).toBe(true);
    });

    it("fails closed on a backtick or $() command substitution appearing in the query field", () => {
      expect(isBlocked({ command: "gh api graphql -f query='query { viewer { login: `whoami` } }'" })).toBe(true);
      expect(isBlocked({ command: "gh api graphql -f query='query { viewer { login: $(whoami) } }'" })).toBe(true);
    });

    it("fails closed on a bare $VAR expansion appearing in the query field", () => {
      expect(isBlocked({ command: "gh api graphql -f query='query { viewer { login: $USER } }'" })).toBe(true);
    });

    it("is not fooled by a mutation keyword split by an UNQUOTED word between two quoted segments", () => {
      // 'query...} mu' + tation (bare, unquoted) + ' Write { __typename }' — no exotic marker anywhere, just
      // ordinary shell word continuation across a quote/unquote/quote seam.
      expect(
        isBlocked({
          command:
            "gh api graphql -f operationName=Write -f query='query Read { viewer { login } } mu'tation' Write { __typename }'",
        }),
      ).toBe(true);
    });

    it("is not fooled by a backslash-newline line continuation splicing a mutation together", () => {
      // POSIX removes a backslash immediately followed by a newline entirely — the shell sees
      // "...} mutation Write..." with nothing in between, not a literal backslash-then-newline.
      expect(
        isBlocked({
          command:
            'gh api graphql -f operationName=Write -f query="query Read { viewer { login } } mu\\\ntation Write { __typename }"',
        }),
      ).toBe(true);
    });

    it("blocks an anonymous-shorthand document that ALSO defines a mutation, not just a lone one", () => {
      // `{ … }` followed by a mutation is not valid GraphQL, but this must not rely on that — nothing here
      // confirms GitHub's parser rejects it rather than executing something.
      expect(
        isBlocked({
          command:
            "gh api graphql -f operationName=Write -f query='{ viewer { login } }\nmutation Write { addReaction(input: {subjectId: \"S\", content: HOORAY}) { clientMutationId } }'",
        }),
      ).toBe(true);
    });

    it("is not fooled by a decoy field whose name merely ENDS in query", () => {
      expect(isBlocked({ command: "gh api graphql -f myquery=query -f query='mutation Write { x }'" })).toBe(true);
    });

    it("is not fooled by a QUERY= shell-variable prefix preceding the real command", () => {
      expect(
        isBlocked({
          command: "QUERY=query gh api graphql -f query='mutation Write { addReaction(input: {}) { id } }' -f id=X",
        }),
      ).toBe(true);
    });

    it("fails closed when the query field cannot be read at all", () => {
      expect(isBlocked({ command: "gh api graphql -F query=@file.graphql" })).toBe(true);
      expect(isBlocked({ command: "gh api graphql --input body.json" })).toBe(true);
    });
  });
});

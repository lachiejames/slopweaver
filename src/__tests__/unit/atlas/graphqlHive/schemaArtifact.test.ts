/**
 * A target's composed schema written into the atlas, addressed by the SHA-256 of its own bytes, round-tripped
 * through an explicit temp home: a target with no published schema is skipped, one with SDL comes back as a
 * single artifact reference whose file holds exactly that SDL.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeHiveSchemaArtifacts } from "../../../../atlas/graphqlHive/schemaArtifact.js";
import { hiveAtlasPaths } from "../../../../atlas/graphqlHive/store.js";
import { unwrap } from "../../../../lib/result.js";

const SDL = "type Query { hello: String! }";
const DIGEST = "66e8fa12c2ffa9dac874198b962ea386c8d742f2b5b37686f0c1215c8ffbd656";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hive-schema-artifact-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("writeHiveSchemaArtifacts", () => {
  it("skips a target with no schema and writes one with SDL under its own digest", () => {
    const paths = hiveAtlasPaths({ home });

    const written = unwrap(
      writeHiveSchemaArtifacts({
        paths,
        targets: [
          {
            graphqlEndpointUrl: null,
            organizationSlug: "acme",
            projectSlug: "api",
            schemaVersionId: null,
            sdl: null,
            slug: "staging",
          },
          {
            graphqlEndpointUrl: "https://api.example.com/graphql",
            organizationSlug: "acme",
            projectSlug: "api",
            schemaVersionId: "v-9",
            sdl: SDL,
            slug: "production",
          },
        ],
      }),
    );

    expect(written).toEqual([
      {
        artifact: {
          byteLength: 29,
          kind: "page-text",
          mediaType: "application/graphql",
          relativePath: `artifacts/schemas/${DIGEST}.graphql`,
          sha256: DIGEST,
        },
        targetPath: "acme/api/production",
      },
    ]);
    expect(readFileSync(join(paths.directory, "artifacts", "schemas", `${DIGEST}.graphql`), "utf8")).toBe(SDL);
  });

  it("writes nothing and returns no artifacts when no target published a schema", () => {
    expect(
      unwrap(
        writeHiveSchemaArtifacts({
          paths: hiveAtlasPaths({ home }),
          targets: [
            {
              graphqlEndpointUrl: null,
              organizationSlug: "acme",
              projectSlug: "api",
              schemaVersionId: null,
              sdl: null,
              slug: "staging",
            },
          ],
        }),
      ),
    ).toEqual([]);
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });
});

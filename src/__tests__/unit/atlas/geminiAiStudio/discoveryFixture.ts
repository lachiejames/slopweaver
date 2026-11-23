/**
 * A hand-built Gemini discovery document, small enough to assert exactly and shaped like the real one.
 *
 * Hand-built rather than a frozen copy of Google's own 375 KB document on purpose: every property asserted
 * against it is one this repository chose to keep, so a fixture carrying the vendor's whole payload would
 * make the tests pass for reasons nobody wrote down. It also keeps the tests offline and instant.
 *
 * The one thing it deliberately reproduces from the real document is the SHAPE that caused work: nested
 * resources (`models.operations`), a `$ref` response resolved out of `schemas`, global parameters that must
 * not be reported as a method's own, and a path template carrying the version segment.
 */

/** The parameters every Google discovery document declares at the top level, which are never a method's own. */
const GLOBAL_PARAMETERS = {
  alt: { location: "query" },
  key: { location: "query" },
  prettyPrint: { location: "query" },
} as const;

/**
 * Build one discovery document.
 *
 * @param version the version the document declares itself to be
 * @param revision the eight-digit revision it carries
 * @param withNestedOperations whether to include the nested `models.operations` resource, so a test can make
 *   one version declare an operation another does not
 * @returns the document, ready to be JSON-serialised
 */
export function discoveryFixture({
  version,
  revision = "20260904",
  withNestedOperations = true,
}: {
  version: string;
  revision?: string;
  withNestedOperations?: boolean;
}): Record<string, unknown> {
  return {
    basePath: "",
    baseUrl: "https://generativelanguage.googleapis.com/",
    kind: "discovery#restDescription",
    name: "generativelanguage",
    parameters: GLOBAL_PARAMETERS,
    resources: fixtureResources({ version, withNestedOperations }),
    revision,
    rootUrl: "https://generativelanguage.googleapis.com/",
    schemas: {
      GenerateContentResponse: { properties: { candidates: {}, usageMetadata: {} } },
      ListFilesResponse: { properties: { files: {}, nextPageToken: {} } },
      ListGeneratedFilesResponse: { properties: { generatedFiles: {}, nextPageToken: {} } },
      ListModelsResponse: { properties: { models: {}, nextPageToken: {} } },
      ListOperationsResponse: { properties: { nextPageToken: {}, operations: {} } },
    },
    servicePath: "",
    version,
  };
}

/** The nested `models.operations` resource, so a test can make one version declare what another does not. */
function nestedOperations({ version }: { version: string }): Record<string, unknown> {
  return {
    operations: {
      methods: {
        list: {
          description: "Lists operations that match the specified filter.\nA second line nobody keeps.",
          httpMethod: "GET",
          id: "generativelanguage.models.operations.list",
          parameterOrder: ["name"],
          parameters: {
            filter: { location: "query" },
            name: { location: "path" },
            pageSize: { location: "query" },
          },
          path: `${version}/{+name}/operations`,
          response: { $ref: "ListOperationsResponse" },
          scopes: ["https://www.googleapis.com/auth/generative-language"],
        },
      },
    },
  };
}

/** The `models` root, which carries the fixture's only mutation and its only nested resource. */
function modelsResource({
  version,
  withNestedOperations,
}: {
  version: string;
  withNestedOperations: boolean;
}): Record<string, unknown> {
  return {
    methods: {
      generateContent: {
        description: "Generates a model response.",
        httpMethod: "POST",
        id: "generativelanguage.models.generateContent",
        parameterOrder: ["model"],
        parameters: { model: { location: "path" } },
        path: `${version}/{+model}:generateContent`,
        response: { $ref: "GenerateContentResponse" },
      },
      list: {
        description: "Lists the Models available through the Gemini API.",
        httpMethod: "GET",
        id: "generativelanguage.models.list",
        parameters: { pageSize: { location: "query" }, pageToken: { location: "query" } },
        path: `${version}/models`,
        response: { $ref: "ListModelsResponse" },
      },
    },
    resources: withNestedOperations ? nestedOperations({ version }) : {},
  };
}

/** The four resource roots the fixture declares. */
function fixtureResources({
  version,
  withNestedOperations,
}: {
  version: string;
  withNestedOperations: boolean;
}): Record<string, unknown> {
  return {
    files: {
      methods: {
        list: {
          description: "Lists the metadata for Files owned by the requesting project.",
          httpMethod: "GET",
          id: "generativelanguage.files.list",
          parameters: { pageSize: { location: "query" }, pageToken: { location: "query" } },
          path: `${version}/files`,
          response: { $ref: "ListFilesResponse" },
        },
      },
    },
    generatedFiles: {
      methods: {
        list: {
          httpMethod: "GET",
          id: "generativelanguage.generatedFiles.list",
          path: `${version}/generatedFiles`,
          response: { $ref: "ListGeneratedFilesResponse" },
        },
      },
    },
    media: {
      methods: {
        download: {
          httpMethod: "GET",
          id: "generativelanguage.media.download",
          path: `${version}/{+name}:download`,
        },
      },
    },
    models: modelsResource({ version, withNestedOperations }),
  };
}

/**
 * One discovery document as the text a reader would be handed.
 *
 * @param version the version the document declares itself to be
 * @param revision the eight-digit revision it carries
 * @param withNestedOperations whether to include the nested `models.operations` resource
 * @returns the JSON text
 */
export function discoveryFixtureText({
  version,
  revision = "20260904",
  withNestedOperations = true,
}: {
  version: string;
  revision?: string;
  withNestedOperations?: boolean;
}): string {
  return JSON.stringify(discoveryFixture({ revision, version, withNestedOperations }));
}

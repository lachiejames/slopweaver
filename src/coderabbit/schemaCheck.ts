/**
 * Checks a parsed CodeRabbit YAML config against CodeRabbit's own published JSON Schema, so a renamed or
 * invented key fails a test instead of being silently ignored by CodeRabbit at review time.
 */

export interface JsonSchemaNode {
  readonly type?: string;
  /** Absent on a node that declares none — and `null` is possible too, since the schema arrives by `JSON.parse`. */
  readonly properties?: Readonly<Record<string, JsonSchemaNode>> | null;
}

/** The keys a schema node allows: its `properties`, or none at all when it declares none. */
function allowedProperties({ schema }: { schema: JsonSchemaNode }): Readonly<Record<string, JsonSchemaNode>> {
  const { properties } = schema;
  if (properties == null) {
    return {};
  }
  return properties;
}

/**
 * Recursively walks a config object and reports every key with no matching property in the schema's
 * `properties` tree at that same nesting level.
 *
 * @param config the parsed configuration object to check
 * @param schema the schema node whose `properties` define the keys allowed at this level
 * @param pathPrefix the dotted ancestry already walked, prepended to each reported key
 * @returns the dotted paths of every config key absent from the schema
 */
export function findUnknownConfigKeys({
  config,
  schema,
  pathPrefix = "",
}: {
  config: Readonly<Record<string, unknown>>;
  schema: JsonSchemaNode;
  pathPrefix?: string;
}): readonly string[] {
  const properties = allowedProperties({ schema });
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    const path = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    const propertySchema = properties[key];
    if (propertySchema == null) {
      unknown.push(path);
      continue;
    }
    if (isPlainObject(value) && propertySchema.type === "object") {
      unknown.push(...findUnknownConfigKeys({ config: value, pathPrefix: path, schema: propertySchema }));
    }
  }
  return unknown;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

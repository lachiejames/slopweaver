/**
 * A Google API discovery document's resource tree: the shape of its resources, methods and parameters as this
 * atlas keeps them, and the depth-first walk that hands every method its own dotted resource path.
 *
 * Every key the Discovery format declares on a resource or method is optional — a resource may hold methods,
 * nested resources, or both; a method may declare no parameters, no required-parameter order, no scopes and no
 * response — so an absent one here means the document declares none, and the walk reads it that way.
 */
import { z } from "zod";

/** One parameter, of which only its location matters here — the rest is documentation this atlas drops. */
export const discoveryParameterSchema = z.looseObject({ location: z.string().optional() });

/** One method, reduced to the fields this atlas keeps. */
const discoveryMethodSchema = z.looseObject({
  description: z.string().optional(),
  httpMethod: z.string().min(1),
  id: z.string().min(1),
  parameterOrder: z.array(z.string()).optional(),
  parameters: z.record(z.string(), discoveryParameterSchema).optional(),
  path: z.string().min(1),
  response: z.looseObject({ $ref: z.string().optional() }).optional(),
  scopes: z.array(z.string()).optional(),
  supportsMediaUpload: z.boolean().optional(),
});

/** One method, as the document declares it. */
export type DiscoveryMethod = z.infer<typeof discoveryMethodSchema>;

/** One resource, which may hold methods, nested resources, or both. */
export interface DiscoveryResource {
  readonly methods?: Record<string, DiscoveryMethod> | undefined;
  readonly resources?: Record<string, DiscoveryResource> | undefined;
}

/** One resource and, recursively, every resource nested under it. */
export const discoveryResourceSchema: z.ZodType<DiscoveryResource> = z.lazy(() =>
  z.looseObject({
    methods: z.record(z.string(), discoveryMethodSchema).optional(),
    resources: z.record(z.string(), discoveryResourceSchema).optional(),
  }),
);

/** The callback {@link walkDiscoveryResources} hands every method it meets. */
type CollectMethod = (found: { path: readonly string[]; method: DiscoveryMethod; methodName: string }) => void;

/**
 * Walk the resource tree depth-first, handing every method its own dotted resource path. A document or resource
 * declaring no nested resources has nothing further to walk.
 *
 * @param resources the resources at this depth, as the document declares them
 * @param collect called once per method, with the resource path it sits under
 * @param prefix the resource path above this depth; the document root has none
 */
export function walkDiscoveryResources({
  resources,
  collect,
  prefix = [],
}: {
  resources: Readonly<Record<string, DiscoveryResource>> | undefined;
  collect: CollectMethod;
  prefix?: readonly string[];
}): void {
  if (resources === undefined) {
    return;
  }
  for (const [name, resource] of Object.entries(resources)) {
    const path = [...prefix, name];
    collectMethods({ collect, methods: resource.methods, path });
    walkDiscoveryResources({ collect, prefix: path, resources: resource.resources });
  }
}

/** Hand every method one resource declares to the walk's callback; a resource holding only nested resources has none. */
function collectMethods({
  methods,
  path,
  collect,
}: {
  methods: Readonly<Record<string, DiscoveryMethod>> | undefined;
  path: readonly string[];
  collect: CollectMethod;
}): void {
  if (methods === undefined) {
    return;
  }
  for (const [methodName, method] of Object.entries(methods)) {
    collect({ method, methodName, path });
  }
}

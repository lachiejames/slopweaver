/*
 * Reading the site's own source: the file walker and the `package.json` pin reader several theme tests scan with.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `.ts` and `.tsx` under `dir`, recursively — a class list lives in either.
 *
 * @returns the absolute path of each source file found
 */
export function sourceFiles({ dir }: { dir: string }): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => join(dir, name));
}

/**
 * Whether `value` is a plain object, so its fields can be read.
 *
 * @returns true when `value` is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The version a `package.json` pins `name` at under `field`.
 *
 * @returns the pinned version string
 */
export function packageVersion({ field, file, name }: { field: string; file: string; name: string }): string {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(parsed) || !isObject(parsed[field]) || typeof parsed[field][name] !== "string") {
    throw new Error(`${file} pins no ${name} under ${field}`);
  }
  return parsed[field][name];
}

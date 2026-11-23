/**
 * The `yarn test:unit:merge` entry point — nothing but the invocation. The shell is `unitMerge.ts`, the
 * decisions `unitShards.ts`.
 */
import { runUnitMerge } from "./unitMerge.js";

process.exit(runUnitMerge({ cwd: process.cwd() }));

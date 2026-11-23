/**
 * The two files an author hands `slopweaver github pr review-prepare`, parsed: `--images`, the pictures the body
 * shows, and `--comments`, the inline comments the same write posts. Pure, beside the argument parsing in
 * `./prDescriptionReviewCore.ts`; every problem is the domain's own typed usage error.
 */
import { parseJson } from "#lib/jsonParse.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  type DescriptionReviewError,
  DescriptionReviewErrors,
} from "../../../outbound/github/descriptionReviewErrors.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import type { DescriptionImageInput } from "./prDescriptionReviewCore.js";

/** Whether a value is a non-empty string. */
function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Parse the `--images` file: a JSON array of `{url, sha256, proves, receiptId, file}`, one per image the body shows.
 *
 * @param text the file's contents
 * @param source the file's path, named in every problem
 * @returns each image and its local file, or every problem found
 */
export function parseDescriptionImages({
  text,
  source,
}: {
  text: string;
  source: string;
}): Result<readonly DescriptionImageInput[], DescriptionReviewError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(DescriptionReviewErrors.usage({ problems: [`${source} is not JSON: ${decoded.error.message}`] }));
  }
  const parsed = decoded.value;
  if (!Array.isArray(parsed)) {
    return err(DescriptionReviewErrors.usage({ problems: [`${source} must be a JSON array of images`] }));
  }
  const problems: string[] = [];
  const images: DescriptionImageInput[] = [];
  parsed.forEach((entry: unknown, index: number) => {
    const at = `${source}[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const { url, sha256, proves, receiptId, file } = entry;
    const fields = { file, proves, receiptId, sha256, url };
    const missing = Object.entries(fields)
      .filter(([, value]) => !filled(value))
      .map(([name]) => name);
    if (missing.length > 0) {
      problems.push(`${at} is missing ${missing.join(", ")}`);
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(String(sha256))) {
      problems.push(`${at}.sha256 must be 64 lowercase hex characters`);
      return;
    }
    images.push({
      file: String(file),
      image: { proves: String(proves), receiptId: String(receiptId), sha256: String(sha256), url: String(url) },
    });
  });
  if (problems.length > 0) {
    return err(DescriptionReviewErrors.usage({ problems }));
  }
  return ok(images);
}

/**
 * Parse the `--comments` file: a JSON array of `{path, line, body}`, the exact inline comments the write posts.
 *
 * @param text the file's contents
 * @param source the file's path, named in every problem
 * @returns each comment, or every problem found
 */
export function parseDescriptionComments({
  text,
  source,
}: {
  text: string;
  source: string;
}): Result<readonly DescriptionReviewComment[], DescriptionReviewError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(DescriptionReviewErrors.usage({ problems: [`${source} is not JSON: ${decoded.error.message}`] }));
  }
  const parsed = decoded.value;
  if (!Array.isArray(parsed)) {
    return err(DescriptionReviewErrors.usage({ problems: [`${source} must be a JSON array of comments`] }));
  }
  const problems: string[] = [];
  const comments: DescriptionReviewComment[] = [];
  parsed.forEach((entry: unknown, index: number) => {
    const at = `${source}[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const extra = Object.keys(entry).filter((key) => !["path", "line", "body"].includes(key));
    const { path, line, body } = entry;
    if (extra.length > 0) {
      problems.push(`${at} carries unknown fields: ${extra.join(", ")}`);
      return;
    }
    if (!filled(path) || !filled(body) || typeof line !== "number" || !Number.isInteger(line) || line < 1) {
      problems.push(`${at} must be { path, line, body } with a positive integer line`);
      return;
    }
    comments.push({ body, line, path });
  });
  if (problems.length > 0) {
    return err(DescriptionReviewErrors.usage({ problems }));
  }
  return ok(comments);
}

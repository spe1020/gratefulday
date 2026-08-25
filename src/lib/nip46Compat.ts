import { NSchema } from '@nostrify/nostrify';

/**
 * Make NIP-46 responses parse when the signer returns an ERROR.
 *
 * NIP-46 defines the response envelope as
 * `{ "id": <request_id>, "result": <string>, "error": <optional string> }`
 * and states that the presence of `error` indicates a failed request. A signer
 * that rejects — Amber denying a permission it was never granted, or the user
 * declining the prompt — therefore replies with `{ id, error }` and NO
 * `result`.
 *
 * nostrify (through at least 0.54.0) declares `result` as mandatory, so
 * `NConnectSigner` fails to PARSE such a response and throws:
 *
 *   invalid_type, expected string, received undefined, path: ["result"]
 *
 * That happens inside `send()`, before `cmd()` reaches its own
 * `if (error) throw new Error(error)`. The signer's real message is discarded
 * and the user sees a schema dump instead of "permission denied" — every
 * rejection looks like a library crash.
 *
 * Making `result` optional restores the intended path: parsing succeeds, `cmd`
 * sees `error`, and the signer's own message reaches the UI.
 *
 * Two things worth knowing about the implementation:
 *
 * - It patches the static method rather than forking, because
 *   `NConnectSigner.send` calls `n.connectResponse()` at request time, so
 *   replacing it here takes effect for signers already constructed.
 * - The new schema is derived from the ORIGINAL (`.extend`, reusing the
 *   original's own `result` shape) so it is built by nostrify's zod instance.
 *   nostrify bundles its own zod 4 while this app uses zod 3, so a schema
 *   constructed from the app's `z` would be a foreign object to the `.pipe()`
 *   in `send()`.
 *
 * Remove this once nostrify makes `result` optional upstream.
 */
export function applyNip46ResponseCompat(): void {
  // Structural cast rather than a zod type: nostrify declares this method's
  // return as `ZodType` in some versions and `ZodObject` in others, and only
  // the latter exposes `.extend`/`.shape` to TypeScript. The runtime object is
  // a zod object in both.
  type ObjectSchema = {
    shape: { result: { optional(): unknown } };
    extend(shape: Record<string, unknown>): unknown;
  };

  const original = NSchema.connectResponse() as unknown as ObjectSchema;
  const lenient = original.extend({ result: original.shape.result.optional() });

  NSchema.connectResponse = () =>
    lenient as ReturnType<typeof NSchema.connectResponse>;
}

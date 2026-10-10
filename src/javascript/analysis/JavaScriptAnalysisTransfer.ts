import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { z } from "zod";

import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptModuleSemanticIr } from "../../domain/javascript/javascriptModuleSemanticIr.js";
import type { JavaScriptSemanticFileProjection } from "../../domain/javascript/javascriptSemanticFileProjection.js";
import { digestSchema } from "../../domain/digests.js";
import {
  javaScriptWorkerGraphRecordSchema,
  javaScriptWorkerModuleHeaderSchema,
  javaScriptWorkerModuleRecordSchema,
  javaScriptWorkerProjectionHeaderSchema,
} from "./JavaScriptAnalysisWorkerSchemas.js";

// Budgets bound transfer representation, independently of source length.
const FRAME_BYTES = 2 * 1024 * 1024;
const TRANSFER_BYTES = 512 * 1024 * 1024;
const BATCH_BYTES = 1024 * 1024;
const recordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("projection-header"),
    value: javaScriptWorkerProjectionHeaderSchema,
  }),
  z.strictObject({
    kind: z.literal("module-header"),
    value: javaScriptWorkerModuleHeaderSchema,
  }),
  ...javaScriptWorkerGraphRecordSchema.options,
  ...javaScriptWorkerModuleRecordSchema.options,
]);

/** Complete-file coordinates authenticated before adopting any worker facts. */
export const javaScriptAnalysisTransferDescriptorSchema = z.strictObject({
  bytes: z.number().int().nonnegative().max(TRANSFER_BYTES),
  sha256: digestSchema,
  records: z.number().int().nonnegative(),
});
type Descriptor = z.output<typeof javaScriptAnalysisTransferDescriptorSchema>;

/** Encode validated facts in bounded records, without serializing a whole graph or IR. */
export const writeJavaScriptAnalysisTransfer = async (
  path: string,
  module: JavaScriptModuleSemanticIr,
  projection: JavaScriptSemanticFileProjection,
): Promise<Descriptor> => {
  const output = await open(path, "wx", 0o600);
  const digest = createHash("sha256");
  let bytes = 0;
  let records = 0;
  let batch: string[] = [];
  let batchBytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const buffer = Buffer.from(batch.join(""));
    // FileHandle.write can be short; writeFile completes the buffer.
    await output.writeFile(buffer);
    digest.update(buffer);
    batch = [];
    batchBytes = 0;
  };
  const append = async (input: unknown): Promise<void> => {
    const record = recordSchema.parse(input);
    const line = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(line);
    if (size > FRAME_BYTES || bytes + size > TRANSFER_BYTES)
      throw new RangeError(
        "JavaScript analysis transfer exceeds its record or file byte budget",
      );
    bytes += size;
    records += 1;
    batch.push(line);
    batchBytes += size;
    if (batchBytes >= BATCH_BYTES) await flush();
  };
  try {
    await append({
      kind: "projection-header",
      value: { roots: projection.roots, truncated: projection.truncated },
    });
    await append({
      kind: "module-header",
      value: { coverage: module.coverage, limitations: module.limitations },
    });
    for (const value of module.scopes) await append({ kind: "scope", value });
    for (const value of module.bindings)
      await append({ kind: "binding", value });
    for (const value of module.callables)
      await append({ kind: "callable", value });
    for (const value of module.moduleLinks)
      await append({ kind: "module-link", value });
    for (const value of projection.evidenceContexts)
      await append({ kind: "evidence-context", value });
    for (const value of projection.nodes) await append({ kind: "node", value });
    for (const value of projection.relations)
      await append({ kind: "relation", value });
    for (const value of projection.unknowns)
      await append({ kind: "unknown", value });
    for (const value of projection.fingerprints)
      await append({ kind: "fingerprint", value });
    await flush();
    return { bytes, sha256: digest.digest("hex"), records };
  } finally {
    await output.close();
  }
};

/** Decode producer records into realm-local, source-bound facts; sealing follows in the consumer. */
export const readJavaScriptAnalysisTransfer = async (
  path: string,
  descriptor: Descriptor,
  source: Pick<JavaScriptArtifactFile, "path" | "sha256">,
  signal?: AbortSignal,
): Promise<{
  readonly module: JavaScriptModuleSemanticIr;
  readonly projection: JavaScriptSemanticFileProjection;
}> => {
  const expected = javaScriptAnalysisTransferDescriptorSchema.parse(descriptor);
  if ((await stat(path)).size !== expected.bytes)
    throw new TypeError(
      "JavaScript analysis transfer byte count does not match",
    );
  const scopes: JavaScriptModuleSemanticIr["scopes"][number][] = [];
  const bindings: JavaScriptModuleSemanticIr["bindings"][number][] = [];
  const callables: JavaScriptModuleSemanticIr["callables"][number][] = [];
  const moduleLinks: JavaScriptModuleSemanticIr["moduleLinks"][number][] = [];
  const evidenceContexts: JavaScriptSemanticFileProjection["evidenceContexts"][number][] =
    [];
  const nodes: JavaScriptSemanticFileProjection["nodes"][number][] = [];
  const relations: JavaScriptSemanticFileProjection["relations"][number][] = [];
  const unknowns: JavaScriptSemanticFileProjection["unknowns"][number][] = [];
  const fingerprints: JavaScriptSemanticFileProjection["fingerprints"][number][] =
    [];
  let projectionHeader:
    | z.output<typeof javaScriptWorkerProjectionHeaderSchema>
    | undefined;
  let moduleHeader:
    | z.output<typeof javaScriptWorkerModuleHeaderSchema>
    | undefined;
  const identities = new Map<string, Set<string>>();
  const retainIdentity = (kind: string, identifier: string): void => {
    let seen = identities.get(kind);
    if (seen === undefined) {
      seen = new Set();
      identities.set(kind, seen);
    }
    if (seen.has(identifier))
      throw new TypeError(
        `Duplicate JavaScript transfer ${kind} identity: ${identifier}`,
      );
    seen.add(identifier);
  };
  let records = 0;
  const digest = createHash("sha256");
  const stream = createReadStream(path, {
    highWaterMark: 64 * 1024,
    ...(signal === undefined ? {} : { signal }),
  });
  let bytes = 0;
  let pending = "";
  stream.setEncoding("utf8");
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      if (typeof chunk !== "string")
        throw new TypeError("JavaScript transfer stream is not UTF-8 text");
      bytes += Buffer.byteLength(chunk);
      if (bytes > expected.bytes)
        throw new RangeError("JavaScript transfer grew while being read");
      digest.update(chunk);
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (Buffer.byteLength(line) + 1 > FRAME_BYTES)
          throw new RangeError(
            "JavaScript transfer record exceeds its byte budget",
          );
        const input: unknown = JSON.parse(line);
        const record = recordSchema.parse(input);
        if (record.kind === "projection-header") {
          if (records !== 0 || projectionHeader !== undefined)
            throw new TypeError(
              "Duplicate or late JavaScript projection header",
            );
          projectionHeader = record.value;
        } else if (record.kind === "module-header") {
          if (records !== 1 || moduleHeader !== undefined)
            throw new TypeError("Duplicate or late JavaScript module header");
          moduleHeader = record.value;
        } else {
          if (projectionHeader === undefined || moduleHeader === undefined)
            throw new TypeError(
              "JavaScript transfer facts precede their headers",
            );
          switch (record.kind) {
            case "scope":
              retainIdentity(record.kind, record.value.scopeId);
              scopes.push(record.value);
              break;
            case "binding":
              retainIdentity(record.kind, record.value.bindingId);
              bindings.push(record.value);
              break;
            case "callable":
              retainIdentity(record.kind, record.value.callableId);
              callables.push(record.value);
              break;
            case "module-link":
              moduleLinks.push(record.value);
              break;
            case "evidence-context":
              retainIdentity(record.kind, record.value.context_id);
              evidenceContexts.push(record.value);
              break;
            case "node": {
              retainIdentity(record.kind, record.value.node_id);
              if (
                record.value.identity.artifact_sha256 !== source.sha256 ||
                record.value.identity.module_path !== source.path
              )
                throw new TypeError(
                  "JavaScript transfer node belongs to a different artifact source",
                );
              nodes.push(record.value);
              break;
            }
            case "relation":
              retainIdentity(record.kind, record.value.relation_id);
              relations.push(record.value);
              break;
            case "unknown":
              retainIdentity(record.kind, record.value.unknown_id);
              unknowns.push(record.value);
              break;
            case "fingerprint":
              retainIdentity(record.kind, record.value.fingerprint_id);
              fingerprints.push(record.value);
              break;
          }
        }
        records += 1;
      }
      if (Buffer.byteLength(pending) + 1 > FRAME_BYTES)
        throw new RangeError(
          "Unterminated JavaScript transfer record exceeds its byte budget",
        );
    }
  } finally {
    stream.destroy();
  }
  if (
    pending !== "" ||
    records !== expected.records ||
    bytes !== expected.bytes ||
    digest.digest("hex") !== expected.sha256
  )
    throw new TypeError(
      "JavaScript analysis transfer is incomplete or its digest does not match",
    );
  if (projectionHeader === undefined || moduleHeader === undefined)
    throw new TypeError("JavaScript analysis transfer is missing its headers");
  return {
    module: { ...moduleHeader, scopes, bindings, callables, moduleLinks },
    projection: {
      ...projectionHeader,
      evidenceContexts,
      nodes,
      relations,
      unknowns,
      fingerprints,
    },
  };
};

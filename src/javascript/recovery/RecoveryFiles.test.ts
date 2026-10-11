import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  snapshotRecoveryInput,
  snapshotRecoveryInputs,
} from "./RecoveryFiles.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const newWorkspace = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-recovery-files-"));
  directories.push(directory);
  return directory;
};

const writeInput = async (
  workspace: string,
  name: string,
  content: string,
): Promise<string> => {
  const path = join(workspace, name);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content, { mode: 0o600 });
  return path;
};

describe("snapshotRecoveryInputs", () => {
  it("concatenates inputs in order and records per-segment offsets", async () => {
    const workspace = await newWorkspace();
    const first = await writeInput(workspace, "entry.js", "console.log(1);\n");
    const second = await writeInput(workspace, "chunk.js", "export {};\n");
    const snapshotPath = join(workspace, "bundle.js");

    const snapshot = await snapshotRecoveryInputs(
      [first, second],
      snapshotPath,
    );

    expect(snapshot.path).toBe(first);
    expect(snapshot.bytes).toBe(
      Buffer.byteLength("console.log(1);\n") +
        Buffer.byteLength("export {};\n"),
    );
    expect(snapshot.segments).toEqual([
      {
        path: first,
        sha256: expect.any(String),
        bytes: Buffer.byteLength("console.log(1);\n"),
        offset: 0,
      },
      {
        path: second,
        sha256: expect.any(String),
        bytes: Buffer.byteLength("export {};\n"),
        offset: Buffer.byteLength("console.log(1);\n"),
      },
    ]);
    expect(await readFile(snapshotPath, { encoding: "utf8" })).toBe(
      "console.log(1);\nexport {};\n",
    );
  });

  it("matches the single-input snapshot for one path", async () => {
    const workspace = await newWorkspace();
    const only = await writeInput(
      workspace,
      "only.js",
      "export const a = 1;\n",
    );
    const singlePath = join(workspace, "single-expected.js");
    const multiPath = join(workspace, "multi-actual.js");

    const expected = await snapshotRecoveryInput(only, singlePath);
    const actual = await snapshotRecoveryInputs([only], multiPath);

    expect(actual.sha256).toBe(expected.sha256);
    expect(actual.bytes).toBe(expected.bytes);
    expect(actual.segments).toEqual([
      { path: only, sha256: expected.sha256, bytes: expected.bytes, offset: 0 },
    ]);
  });

  it("rejects a relative path", async () => {
    const workspace = await newWorkspace();
    const snapshotPath = join(workspace, "bundle.js");

    await expect(
      snapshotRecoveryInputs(["relative.js"], snapshotPath),
    ).rejects.toMatchObject({
      issues: [{ path: ["path"], reason: "invalid_value" }],
    });
  });

  it("rejects non-UTF-8 input before writing the snapshot", async () => {
    const workspace = await newWorkspace();
    const path = join(workspace, "binary.js");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, Buffer.from([0xff, 0xfe, 0x00]));
    const snapshotPath = join(workspace, "bundle.js");

    await expect(
      snapshotRecoveryInputs([path], snapshotPath),
    ).rejects.toMatchObject({
      issues: [{ path: ["path"], reason: "invalid_value" }],
    });
    await expect(readFile(snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

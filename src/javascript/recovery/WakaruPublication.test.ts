import { describe, expect, it } from "vitest";

import { originatingSegment } from "./WakaruPublication.js";

const segments = [
  { path: "/app/entry.js", sha256: "a".repeat(64), bytes: 10, offset: 0 },
  {
    path: "/app/shared.js",
    sha256: "b".repeat(64),
    bytes: 10,
    offset: 10,
  },
];

describe("originatingSegment", () => {
  it("attributes ranges inside the second segment to that file", () => {
    const origin = originatingSegment(segments, [[12, 18]]);

    expect(origin).toMatchObject({
      path: "/app/shared.js",
      sha256: "b".repeat(64),
      offset: 10,
      attributable: true,
    });
  });

  it("attributes ranges in the first segment to the primary input", () => {
    const origin = originatingSegment(segments, [
      [0, 10],
      [4, 6],
    ]);

    expect(origin).toMatchObject({
      path: "/app/entry.js",
      sha256: "a".repeat(64),
      offset: 0,
      attributable: true,
    });
  });

  it("falls back to the primary snapshot identity for ranges crossing a boundary", () => {
    const origin = originatingSegment(segments, [[8, 14]]);

    expect(origin).toMatchObject({
      path: "/app/entry.js",
      sha256: "a".repeat(64),
      offset: 0,
      attributable: false,
    });
  });

  it("reports the primary input as unattributable without ranges", () => {
    const origin = originatingSegment(segments, []);

    expect(origin).toMatchObject({
      path: "/app/entry.js",
      sha256: "a".repeat(64),
      offset: 0,
      attributable: false,
    });
  });
});

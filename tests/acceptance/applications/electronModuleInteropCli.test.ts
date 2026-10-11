import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { ROLLDOWN_MODULE_INTEROP } from "../../../src/domain/javascript/javascriptModuleInterop.fixture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains converted Electron windows and preload evidence through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-interop-");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ main: "main.cjs" }),
    );
    await writeFile(
      join(root, "preload.js"),
      'throw new Error("must stay inert");',
    );
    const source = `${ROLLDOWN_MODULE_INTEROP}
      let electron = require("electron");
      electron = __toESM(electron, 1);
      new electron.BrowserWindow({webPreferences:{preload:"./preload.js"}});
      new electron.BrowserWindow({webPreferences:{preload:runtimePath}});
      const direct = require("electron");
      new direct.BrowserWindow({});
      function decoy(electron) {new electron.BrowserWindow({});}
      throw new Error("must not execute main");
    `;
    await writeFile(join(root, "main.cjs"), source);
    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const result = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    expect(result.summary).toMatchObject({
      browser_windows: 3,
      preload_entrypoints: 1,
    });
    expect(result.statistics.parse_failures).toBe(0);
    const windows = result.graph.nodes.filter(
      ({ kind }) => kind === "browser-window",
    );
    expect(windows).toHaveLength(3);
    for (const window of windows) {
      expect(window.observations[0]?.evidence.location).toMatchObject({
        available: true,
        value: { kind: "source-range", source: "main.cjs" },
      });
    }
    expect(
      windows.flatMap((window) =>
        window.observations.map(({ properties }) => properties.web_preferences),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            name: "preload",
            value: {
              status: "dynamic",
              value: null,
              expression: "runtimePath",
            },
          }),
        ]),
      ]),
    );
  },
);

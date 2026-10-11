import { describe, expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { ROLLDOWN_MODULE_INTEROP } from "./javascriptModuleInterop.fixture.js";

const WINDOW =
  'new electron.BrowserWindow({webPreferences:{preload:"./preload.js"}});';
const IMPORT = 'let electron = require("electron");';
const WRAP = "electron = __toESM(electron, 1);";

describe("Electron module interop identity", () => {
  it("preserves named APIs through the released Rolldown namespace conversion", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      ${IMPORT} ${WRAP} ${WINDOW}
      new electron.BrowserWindow({webPreferences:{preload:runtimePath}});
      electron.ipcMain.handle("ping", () => "pong");
      electron.contextBridge.exposeInMainWorld("api", {ping:true});
    `);
    expect(analysis.electron.browser_windows).toMatchObject([
      { preload_path: "./preload.js" },
      { preload_path: null },
    ]);
    expect(analysis.electron.ipc).toMatchObject([
      { channel: "ping", side: "main" },
    ]);
    expect(analysis.electron.context_bridge_apis).toMatchObject([
      { api_key: "api" },
    ]);
  });

  it("follows lexical identities when helper and parameter names change", () => {
    const source = `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} ${WINDOW}`
      .replaceAll("__toESM", "namespaceOf")
      .replaceAll("__copyProps", "copyNamed")
      .replaceAll("mod", "inputModule")
      .replaceAll("isNodeMode", "nodeMode")
      .replaceAll("target", "namespaceTarget")
      .replaceAll("from", "sourceObject");
    expect(
      analyzeJavaScriptStaticSource(source).electron.browser_windows,
    ).toMatchObject([{ preload_path: "./preload.js" }]);
  });
});

describe("Electron module interop uncertainty", () => {
  it.each([
    [
      "intrinsic changed through an unresolved mutator target",
      `Object.defineProperty(getTarget(), "create", {value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via dynamic apply",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Object.defineProperty.apply(null, args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via spread call",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Object.defineProperty.call(null, ...args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via Reflect.apply",
      `const args = [Object, "getOwnPropertyNames", {value:() => []}]; Reflect.apply(Object.defineProperty, null, args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via spread Reflect.apply",
      `const args = [null, [Object, "create", {value:customCreate}]]; Reflect.apply(Object.defineProperty, ...args); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via call",
      `Object.defineProperty.call(null, Object, "getOwnPropertyNames", {value:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed via apply",
      `Object.defineProperty.apply(null, [Object, "getOwnPropertyNames", {value:() => []}]); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with defineProperty",
      `Object.defineProperty(Object, "getOwnPropertyNames", {value:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with Reflect.set",
      `Reflect.set(Object, "getOwnPropertyNames", () => []); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with an aliased mutator",
      `const change = Object.defineProperty; change(Object, "create", {value:customCreate}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with assign",
      `Object.assign(Object, {getOwnPropertyNames:() => []}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "intrinsic changed with defineProperties",
      `Object.defineProperties(Function.prototype, {bind:{value:customBind}}); ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten Object global",
      `Object = customObject; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic through an alias",
      `const objectAlias = Object; objectAlias.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic through globalThis",
      `globalThis.Object.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "helper called before initialization",
      `${IMPORT} ${WRAP} ${ROLLDOWN_MODULE_INTEROP}`,
    ],
    [
      "fake helper",
      `${ROLLDOWN_MODULE_INTEROP}\n__toESM = (mod) => ({BrowserWindow:Fake}); ${IMPORT} ${WRAP}`,
    ],
    [
      "changed getter",
      `${ROLLDOWN_MODULE_INTEROP.replace("from[k]", "to[k]")}\n${IMPORT} ${WRAP}`,
    ],
    [
      "replaced copy helper",
      `${ROLLDOWN_MODULE_INTEROP}\n__copyProps = () => ({}); ${IMPORT} ${WRAP}`,
    ],
    [
      "replaced intrinsic alias",
      `${ROLLDOWN_MODULE_INTEROP}\n__defProp = () => ({}); ${IMPORT} ${WRAP}`,
    ],
    [
      "shadowed Object",
      `const Object = customObject; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten intrinsic",
      `Object.create = customCreate; ${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten alias call",
      `${ROLLDOWN_MODULE_INTEROP}\n__hasOwnProp.call = customCall; ${IMPORT} ${WRAP}`,
    ],
    [
      "overwritten Function bind",
      `${ROLLDOWN_MODULE_INTEROP}\nFunction.prototype.bind = customBind; ${IMPORT} ${WRAP}`,
    ],
    [
      "conditional conversion",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} if (flag) { ${WRAP} }`,
    ],
    [
      "compound assignment",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} electron ||= __toESM(electron, 1);`,
    ],
    [
      "other input",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} electron = __toESM(other, 1);`,
    ],
    [
      "later overwrite",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} electron = unrelated;`,
    ],
    [
      "overwritten constructor",
      `${ROLLDOWN_MODULE_INTEROP}\n${IMPORT} ${WRAP} electron.BrowserWindow = Fake;`,
    ],
  ])("does not infer Electron identity after %s", (_name, setup) => {
    expect(
      analyzeJavaScriptStaticSource(`${setup}\n${WINDOW}`).electron
        .browser_windows,
    ).toEqual([]);
  });
});

describe("Electron module interop capture and scope", () => {
  it("does not reject unrelated intrinsic property definitions", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      Object.defineProperty(Object, "unrelated", {value:1});
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("keeps opaque targets in a generic helper separate from outer module identity", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      function genericAssign() { Object.assign.apply(null, arguments); }
      ${ROLLDOWN_MODULE_INTEROP} ${IMPORT} ${WRAP} ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("rejects an opaque intrinsic mutation in the namespace's own callable", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      function openWindow(args) {
        Object.defineProperty.apply(null, args);
        ${IMPORT} ${WRAP} ${WINDOW}
      }
    `);
    expect(analysis.electron.browser_windows).toEqual([]);
  });

  it("preserves captured intrinsics across later vendor polyfills and callable writes", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      Object.create = customCreate;
      ${IMPORT} ${WRAP}
      function runLoop(key) { globalThis[key] = this; }
      function polyfill() { Object.create = customCreate; }
      ${WINDOW}
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });

  it("keeps a shadowed namespace separate from the converted module", () => {
    const analysis = analyzeJavaScriptStaticSource(`${ROLLDOWN_MODULE_INTEROP}
      ${IMPORT} ${WRAP} ${WINDOW}
      function decoy(electron) { ${WINDOW} }
    `);
    expect(analysis.electron.browser_windows).toHaveLength(1);
  });
});

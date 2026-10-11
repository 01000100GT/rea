import { parseExpression } from "@babel/parser";
import * as t from "@babel/types";

import type { JavaScriptModuleOrigin } from "./javascriptSemanticIr.js";
import {
  isUnshadowedGlobal,
  resolveSemanticBindingState,
  semanticScopeId,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import { semanticRequireOrigin } from "./javascriptSemanticRequireOrigin.js";
import { childNodes } from "./javascriptSemanticTraversal.js";
import { electronMemberPath } from "./javascriptElectronMemberWrites.js";
import { SemanticPropertyPathCoverage } from "./javascriptSemanticPropertyPaths.js";

// Match the complete Rolldown runtime operations, including its live getters.
// Names and formatting are irrelevant; lexical roles, operators and keys are not.
const TO_ESM = parseExpression(`(mod, isNodeMode, target) => (
  target = mod != null ? __create(__getProtoOf(mod)) : {},
  __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default")
    ? __defProp(target, "default", {value: mod, enumerable: true}) : target, mod)
)`);
const COPY_PROPS = parseExpression(`(to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function")
    for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
      key = keys[i];
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: ((k) => from[k]).bind(null, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
    }
  return to;
}`);
const INTRINSICS: Readonly<Record<string, readonly string[]>> = {
  __create: ["Object", "create"],
  __getProtoOf: ["Object", "getPrototypeOf"],
  __defProp: ["Object", "defineProperty"],
  __getOwnPropNames: ["Object", "getOwnPropertyNames"],
  __getOwnPropDesc: ["Object", "getOwnPropertyDescriptor"],
  __hasOwnProp: ["Object", "prototype", "hasOwnProperty"],
};

interface IntrinsicDependency {
  readonly path: readonly string[];
  readonly capturedAt?: t.Node;
}

interface InteropOrigin {
  readonly origin: JavaScriptModuleOrigin;
  readonly dependencies: readonly IntrinsicDependency[];
}

interface InteropHelper {
  readonly dependencies: readonly IntrinsicDependency[];
  readonly readyAfter: number;
}

/** Prove one inert namespace conversion without relaxing general assignment semantics. */
export const createSemanticModuleInterop = (
  state: JavaScriptSemanticAnalysisState,
) => {
  const helpers = new Map<string, InteropHelper | null>();
  const origins = new Map<string, InteropOrigin>();
  const intrinsicBindings = new Map<string, readonly string[] | null>();
  const writes: {
    readonly scope: string;
    readonly offset: number;
    readonly coverage: SemanticPropertyPathCoverage;
  }[] = [];
  const invalidatedBindings = new Map<string, boolean>();
  const opaqueMutationPath = (node: t.Node): readonly string[] => {
    let current: t.Node | undefined = node;
    while (current !== undefined) {
      if (t.isFunction(current))
        return ["opaque-intrinsic", semanticScopeId("function", current)];
      current = state.parentsByNode.get(current);
    }
    return ["intrinsic"];
  };

  const intrinsicPath = (node: t.Node): readonly string[] | undefined => {
    let current = node;
    const visited = new Set<string>();
    const pending: { id: string; suffixLength: number }[] = [];
    let suffix: readonly string[] = [];
    const finish = (
      path: readonly string[] | undefined,
    ): readonly string[] | undefined => {
      for (const binding of pending)
        intrinsicBindings.set(
          binding.id,
          path === undefined
            ? null
            : path.slice(0, path.length - binding.suffixLength),
        );
      return path;
    };
    for (;;) {
      const { root, members } = electronMemberPath(current);
      if (members.some((member) => member === null)) return finish(undefined);
      suffix = [...(members as readonly string[]), ...suffix];
      for (const global of ["Object", "Function", "Reflect"])
        if (isUnshadowedGlobal(root, state, global))
          return finish(["intrinsic", global, ...suffix]);
      for (const global of ["globalThis", "global", "window", "self"])
        if (isUnshadowedGlobal(root, state, global))
          return finish(["intrinsic", ...suffix]);
      if (!t.isIdentifier(root)) return finish(undefined);
      const binding = resolveSemanticBindingState(state, root, root.name);
      const cached =
        binding === undefined
          ? undefined
          : intrinsicBindings.get(binding.bindingId);
      if (cached !== undefined)
        return finish(cached === null ? undefined : [...cached, ...suffix]);
      const initializer = stableInitializer(binding, state);
      if (
        binding === undefined ||
        initializer === undefined ||
        visited.has(binding.bindingId)
      )
        return finish(undefined);
      visited.add(binding.bindingId);
      pending.push({ id: binding.bindingId, suffixLength: suffix.length });
      current = initializer;
    }
  };

  const helperProof = (
    binding: JavaScriptSemanticBindingState,
  ): InteropHelper | undefined => {
    const cached = helpers.get(binding.bindingId);
    if (cached !== undefined) return cached ?? undefined;
    helpers.set(binding.bindingId, null);
    const wrapper = stableInitializer(binding, state);
    if (wrapper === undefined) return undefined;
    const wrapperRoles = canonicalRoles(wrapper, TO_ESM, state);
    const copyBinding = wrapperRoles?.get("__copyProps");
    const copy = stableInitializer(copyBinding, state);
    const copyRoles =
      copy === undefined ? undefined : canonicalRoles(copy, COPY_PROPS, state);
    if (
      wrapperRoles === undefined ||
      copyRoles === undefined ||
      copy === undefined
    )
      return undefined;
    const dependencies: IntrinsicDependency[] = [];
    for (const roles of [wrapperRoles, copyRoles])
      for (const [role, dependency] of roles) {
        const expected = INTRINSICS[role];
        if (expected === undefined) continue;
        const initializer = stableInitializer(dependency, state);
        const path =
          initializer === undefined ? undefined : intrinsicPath(initializer);
        if (
          initializer === undefined ||
          path === undefined ||
          JSON.stringify(path) !== JSON.stringify(["intrinsic", ...expected])
        )
          return undefined;
        dependencies.push({ path, capturedAt: initializer });
        if (role === "__hasOwnProp")
          dependencies.push({ path: [...path, "call"] });
      }
    dependencies.push(
      { path: ["intrinsic", "Function", "prototype", "bind"] },
      { path: ["intrinsic", "Function", "prototype", "call"] },
    );
    const proof = {
      dependencies,
      readyAfter: Math.max(
        wrapper.end ?? Infinity,
        copy.end ?? Infinity,
        ...dependencies.map(({ capturedAt }) => capturedAt?.end ?? -1),
      ),
    };
    helpers.set(binding.bindingId, proof);
    return proof;
  };

  const origin = (
    binding: JavaScriptSemanticBindingState,
  ): InteropOrigin | undefined => {
    const [initial, converted] = binding.initializers;
    if (
      binding.definitions.length !== 2 ||
      binding.definitions[0]?.kind !== "variable" ||
      binding.definitions[1]?.kind !== "assignment" ||
      binding.initializers.length !== 2 ||
      initial === undefined ||
      converted === undefined ||
      initial.projection.length !== 0 ||
      converted.projection.length !== 0 ||
      state.conditionalInitializers.has(initial.node)
    )
      return undefined;
    const call = converted.node;
    const assignment = state.parentsByNode.get(call);
    const statement =
      assignment === undefined
        ? undefined
        : state.parentsByNode.get(assignment);
    const declaration = state.parentsByNode.get(initial.node);
    const declarationStatement =
      declaration === undefined
        ? undefined
        : state.parentsByNode.get(declaration);
    if (
      !t.isCallExpression(call) ||
      !t.isIdentifier(call.callee) ||
      !t.isAssignmentExpression(assignment, { operator: "=" }) ||
      assignment.right !== call ||
      !t.isIdentifier(assignment.left, { name: binding.name }) ||
      !t.isExpressionStatement(statement) ||
      !t.isVariableDeclarator(declaration) ||
      !t.isVariableDeclaration(declarationStatement) ||
      state.parentsByNode.get(statement) !==
        state.parentsByNode.get(declarationStatement) ||
      (initial.node.start ?? Infinity) >= (call.start ?? -1) ||
      call.arguments.length !== 2 ||
      !t.isNumericLiteral(call.arguments[1], { value: 1 })
    )
      return undefined;
    const input = call.arguments[0];
    if (
      !t.isIdentifier(input) ||
      resolveSemanticBindingState(state, input, input.name) !== binding
    )
      return undefined;
    const required = semanticRequireOrigin(initial.node, state)?.origin;
    if (required === undefined || required.importedPath.length !== 0)
      return undefined;
    const helper = resolveSemanticBindingState(
      state,
      call.callee,
      call.callee.name,
    );
    const proof = helper === undefined ? undefined : helperProof(helper);
    if (proof === undefined || proof.readyAfter >= (call.start ?? -1))
      return undefined;
    const result = {
      origin: required,
      dependencies: proof.dependencies.map((dependency) => ({
        ...dependency,
        capturedAt: dependency.capturedAt ?? call,
      })),
    };
    origins.set(binding.bindingId, result);
    return result;
  };
  return {
    origin,
    intrinsicPath,
    opaqueMutationPath,
    retainWrite: (node: t.Node, path: readonly (string | null)[]) => {
      const coverage = new SemanticPropertyPathCoverage();
      coverage.retain(path[0] === "opaque-intrinsic" ? ["intrinsic"] : path);
      writes.push({
        scope: opaqueMutationPath(node).join("."),
        offset: node.start ?? Infinity,
        coverage,
      });
    },
    invalidated: (binding: JavaScriptSemanticBindingState): boolean => {
      const cached = invalidatedBindings.get(binding.bindingId);
      if (cached !== undefined) return cached;
      const result =
        origins
          .get(binding.bindingId)
          ?.dependencies.some(({ path, capturedAt }) => {
            if (capturedAt === undefined) return true;
            const scope = opaqueMutationPath(capturedAt).join(".");
            // Captured function values survive later replacement of global
            // properties. Other callable bodies are not execution evidence.
            return writes.some(
              (write) =>
                (write.scope === scope || write.scope === "intrinsic") &&
                write.offset < (capturedAt.start ?? -1) &&
                write.coverage.covers(path),
            );
          }) ?? false;
      invalidatedBindings.set(binding.bindingId, result);
      return result;
    },
  };
};

const stableInitializer = (
  binding: JavaScriptSemanticBindingState | undefined,
  state: JavaScriptSemanticAnalysisState,
): t.Node | undefined => {
  const [initializer] = binding?.initializers ?? [];
  return binding !== undefined &&
    binding.definitions.length === 1 &&
    binding.initializers.length === 1 &&
    initializer !== undefined &&
    initializer.projection.length === 0 &&
    !state.conditionalInitializers.has(initializer.node)
    ? initializer.node
    : undefined;
};

/** Exact AST shape with a bijection of lexical roles, not identifier spelling. */
const canonicalRoles = (
  actual: t.Node,
  pattern: t.Node,
  state: JavaScriptSemanticAnalysisState,
): ReadonlyMap<string, JavaScriptSemanticBindingState> | undefined => {
  const roles = new Map<string, JavaScriptSemanticBindingState>();
  const used = new Map<string, string>();
  const pending: { actual: t.Node; pattern: t.Node; parent: t.Node | null }[] =
    [{ actual, pattern, parent: null }];
  while (pending.length !== 0) {
    const pair = pending.pop();
    if (pair === undefined || pair.actual.type !== pair.pattern.type)
      return undefined;
    const { actual: node, pattern: expected, parent } = pair;
    const literalKey =
      parent !== null &&
      ((t.isMemberExpression(parent) &&
        !parent.computed &&
        parent.property === expected) ||
        (t.isObjectProperty(parent) &&
          !parent.computed &&
          parent.key === expected));
    if (t.isIdentifier(expected) && t.isIdentifier(node) && !literalKey) {
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (
        binding === undefined ||
        (roles.has(expected.name) && roles.get(expected.name) !== binding) ||
        (used.has(binding.bindingId) &&
          used.get(binding.bindingId) !== expected.name)
      )
        return undefined;
      roles.set(expected.name, binding);
      used.set(binding.bindingId, expected.name);
    }
    const visitorKeys = t.VISITOR_KEYS[expected.type] ?? [];
    for (const [key, field] of Object.entries(
      t.NODE_FIELDS[expected.type] ?? {},
    )) {
      if (
        visitorKeys.includes(key) ||
        (t.isIdentifier(expected) && key === "name" && !literalKey)
      )
        continue;
      const fallback: unknown = Reflect.get(field, "default");
      if (
        JSON.stringify(Reflect.get(node, key) ?? fallback) !==
        JSON.stringify(Reflect.get(expected, key) ?? fallback)
      )
        return undefined;
    }
    const children = childNodes(node),
      expectedChildren = childNodes(expected);
    if (children.length !== expectedChildren.length) return undefined;
    for (const [index, child] of children.entries()) {
      const expectedChild = expectedChildren[index];
      if (expectedChild !== undefined)
        pending.push({
          actual: child,
          pattern: expectedChild,
          parent: expected,
        });
    }
  }
  return roles;
};

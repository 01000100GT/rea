import * as t from "@babel/types";

import type { JavaScriptIntrinsicInvocation } from "./javascriptElectronMemberWrites.js";
import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";

const arrayArguments = (array: t.Node | undefined) =>
  t.isArrayExpression(array) &&
  array.elements.every((element) => t.isExpression(element))
    ? array.elements.filter((element): element is t.Expression =>
        t.isExpression(element),
      )
    : undefined;

const invocationArguments = (
  method: "call" | "apply",
  arguments_: JavaScriptIntrinsicInvocation["arguments"],
) =>
  t.isSpreadElement(arguments_?.[0])
    ? undefined
    : method === "apply"
      ? arrayArguments(arguments_?.[1])
      : arguments_?.slice(1);

/**
 * Normalize known invocation syntax once, retaining bound argument prefixes.
 * Binding a function alone is not a write; only its eventual call is examined.
 */
export const resolveJavaScriptIntrinsicInvocation = (
  node: t.CallExpression | t.OptionalCallExpression,
  state: JavaScriptSemanticAnalysisState,
  intrinsicPath: (node: t.Node) => readonly string[] | undefined,
  boundIntrinsic: (node: t.Node) => JavaScriptIntrinsicInvocation | undefined,
): JavaScriptIntrinsicInvocation | undefined => {
  const visited = new Set<string>();
  let callee: t.Node = node.callee;
  let arguments_: JavaScriptIntrinsicInvocation["arguments"] = node.arguments;
  for (;;) {
    callee = unwrapJavaScriptExpression(callee).node;
    let path = intrinsicPath(callee);
    // Static projections can capture call/apply themselves as aliases.
    while (path !== undefined && path.length > 3) {
      const method = path.at(-1);
      if (method !== "call" && method !== "apply") break;
      arguments_ = invocationArguments(method, arguments_);
      path = path.slice(0, -1);
    }
    if (path?.join(".") === "intrinsic.Reflect.apply") {
      const callable = arguments_?.[0];
      if (!t.isExpression(callable)) return undefined;
      callee = callable;
      arguments_ = arrayArguments(arguments_?.[2]);
      continue;
    }
    if (path !== undefined) return { path, arguments: arguments_ };
    if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
      const method = semanticStaticPropertyKey(
        callee.property,
        callee.computed,
      );
      if (method === "call" || method === "apply") {
        callee = callee.object;
        arguments_ = invocationArguments(method, arguments_);
        continue;
      }
    }
    const bound = boundIntrinsic(callee);
    if (bound !== undefined)
      return {
        path: bound.path,
        arguments:
          bound.arguments === undefined
            ? undefined
            : [...bound.arguments, ...(arguments_ ?? [])],
      };
    if (!t.isIdentifier(callee)) return undefined;
    const binding = resolveSemanticBindingState(state, callee, callee.name);
    const initializer = semanticStableInitializer(binding, state);
    if (
      binding === undefined ||
      initializer === undefined ||
      initializer.projection.length !== 0 ||
      visited.has(binding.bindingId)
    )
      return undefined;
    visited.add(binding.bindingId);
    callee = initializer.node;
  }
};

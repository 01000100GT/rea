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
): JavaScriptIntrinsicInvocation | undefined => {
  const visited = new Set<string>();
  let callee: t.Node = node.callee;
  let arguments_: JavaScriptIntrinsicInvocation["arguments"] = node.arguments;
  let thisArgument: t.Node | undefined;
  let explicitReceiver = false;
  for (;;) {
    callee = unwrapJavaScriptExpression(callee).node;
    const path = intrinsicPath(callee);
    const method =
      path !== undefined && path.length > 3 ? path.at(-1) : undefined;
    if (method === "call" || method === "apply") {
      // These properties hold generic function values. Their receiver selects
      // the callable; property-chain depth does not consume more arguments.
      const callable: t.Node | undefined = explicitReceiver
        ? thisArgument
        : t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
          ? callee.object
          : undefined;
      if (!t.isExpression(callable)) return undefined;
      callee = callable;
      thisArgument = arguments_?.[0];
      explicitReceiver = true;
      arguments_ = invocationArguments(method, arguments_);
      continue;
    }
    if (path?.join(".") === "intrinsic.Reflect.apply") {
      const callable = arguments_?.[0];
      if (!t.isExpression(callable)) return undefined;
      callee = callable;
      thisArgument = arguments_?.[1];
      explicitReceiver = true;
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
        thisArgument = arguments_?.[0];
        explicitReceiver = true;
        arguments_ = invocationArguments(method, arguments_);
        continue;
      }
    }
    if (t.isCallExpression(callee) || t.isOptionalCallExpression(callee)) {
      const binder: t.Node = unwrapJavaScriptExpression(callee.callee).node;
      if (
        (!t.isMemberExpression(binder) &&
          !t.isOptionalMemberExpression(binder)) ||
        semanticStaticPropertyKey(binder.property, binder.computed) !== "bind"
      )
        return undefined;
      const prefix = callee.arguments.slice(1);
      // An inner bind owns the receiver even when the result is rebound.
      thisArgument = callee.arguments[0];
      explicitReceiver = true;
      arguments_ = t.isSpreadElement(callee.arguments[0])
        ? undefined
        : prefix.length === 0
          ? arguments_
          : [...prefix, ...(arguments_ ?? [])];
      callee = binder.object;
      continue;
    }
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

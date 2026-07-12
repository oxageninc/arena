import type { AgentSpec } from "../types.js";
import { Adapter } from "./base.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { GeminiAdapter } from "./gemini.js";
import { MockAdapter } from "./mock.js";
import { OxagenAdapter } from "./oxagen.js";
import { StellaAdapter } from "./stella.js";

export { Adapter } from "./base.js";

const registry: Record<string, new (spec?: Pick<AgentSpec, "bin">) => Adapter> = {
  "claude-code": ClaudeCodeAdapter,
  gemini: GeminiAdapter,
  oxagen: OxagenAdapter,
  stella: StellaAdapter,
  mock: MockAdapter,
};

export function adapterNames(): string[] {
  return Object.keys(registry);
}

export function createAdapter(spec: AgentSpec): Adapter {
  const Ctor = registry[spec.adapter];
  if (!Ctor) {
    throw new Error(
      `Unknown adapter "${spec.adapter}". Available: ${adapterNames().join(", ")}`,
    );
  }
  return new Ctor(spec);
}

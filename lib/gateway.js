import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { resolveConfig } from "./config.js";
const RATE_LIMITER_SETTINGS_NAMESPACE = settingsNamespace("rate-limiter");
function buildMutateOps(patch) {
  const ops = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      ops.push({ op: "unset", path: [key] });
    } else if (key === "providers" && typeof value === "object") {
      for (const [provider, providerValue] of Object.entries(
        value
      )) {
        if (providerValue === null) {
          ops.push({ op: "unset", path: ["providers", provider] });
        } else {
          ops.push({ op: "set", path: ["providers", provider], value: providerValue });
        }
      }
    } else {
      ops.push({ op: "set", path: [key], value });
    }
  }
  return ops;
}
function mergePatch(patch, current) {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else if (key === "providers" && typeof value === "object") {
      const mergedProviders = {
        ...result.providers ?? {}
      };
      for (const [provider, providerValue] of Object.entries(
        value
      )) {
        if (providerValue === null) {
          delete mergedProviders[provider];
        } else {
          mergedProviders[provider] = providerValue;
        }
      }
      result.providers = mergedProviders;
    } else {
      result[key] = value;
    }
  }
  return result;
}
class RateLimiterConfigGateway extends TypertRemoteService {
  bridge;
  /** 可选注入子激活后的实时 settings 服务。 */
  settings;
  /**
   * @param ctx - 拥有上下文（`apply` 内插件 fiber 的 ctx）。
   * @param bridge - 与运行时读取的同一 `RateLimiterSettingsBridge`，使 get/set
   *   始终作用于实时合成配置。
   */
  constructor(ctx, bridge) {
    super(ctx, "rate-limiter");
    this.bridge = bridge;
    ctx.inject(["settings"], (sctx) => {
      this.settings = sctx.settings;
      return () => {
        this.settings = void 0;
      };
    });
  }
  /**
   * 读取当前合成配置（schema 默认值 → entry base → settings user layer），经
   * `resolveConfig` 解析。
   *
   * Read the current composed config (schema defaults → entry base → settings
   * user layer) through `resolveConfig`.
   */
  get() {
    return { config: resolveConfig(this.bridge.source()) };
  }
  /**
   * 校验配置 patch 并写入 settings USER layer（实时——运行时经 bridge `onChange`
   * 重新应用；无需重启）。
   *
   * @param patch - 配置键的任意子集；未知顶层键、rate/burst 越界在写入前被拒绝。
   * @returns 写入后的新合成配置。
   * @throws patch 校验失败，或未合成 settings 服务（KD-G5：写通道不可用）。
   */
  async set(patch) {
    for (const key of Object.keys(patch)) {
      if (key !== "enabled" && key !== "providers") {
        throw new Error(`rate-limiter: unknown config key "${key}"`);
      }
    }
    const current = resolveConfig(this.bridge.source());
    const view = mergePatch(patch, current);
    resolveConfig(view);
    if (Object.keys(patch).length === 0) return { config: current };
    if (!Object.values(patch).some((value) => value !== null)) {
      return { config: current };
    }
    const settings = this.settings;
    if (settings === void 0) {
      throw new Error(
        "rate-limiter: settings service is unavailable \u2014 configuration cannot be written"
      );
    }
    await settings.mutate(RATE_LIMITER_SETTINGS_NAMESPACE, buildMutateOps(patch));
    return { config: resolveConfig(this.bridge.source()) };
  }
}
function rateLimiterTypertContribution() {
  return {
    package: "dsh-rate-limiter",
    face: "host",
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      {
        id: "dsh-rate-limiter#rate-limiter/get",
        service: "rate-limiter",
        namespace: "rate-limiter",
        method: "get",
        invocation: { kind: "direct" },
        parameters: [],
        result: { mode: "src-json" }
      },
      {
        id: "dsh-rate-limiter#rate-limiter/set",
        service: "rate-limiter",
        namespace: "rate-limiter",
        method: "set",
        invocation: { kind: "direct" },
        parameters: [
          { name: "patch", wire: "patch", source: "json", codec: { mode: "src-json" } }
        ],
        result: { mode: "src-json" }
      }
    ]
  };
}
export {
  RATE_LIMITER_SETTINGS_NAMESPACE,
  RateLimiterConfigGateway,
  buildMutateOps,
  mergePatch,
  rateLimiterTypertContribution
};

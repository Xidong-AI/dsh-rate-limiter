import type { Context } from "@deepseek-ai/cordis";
import type { LlmCallConfig } from "@deepseek-ai/dsh-llm";
// 加载 dsh-agent 对 Cordis Events 的模块扩展（编译期类型），
// 使 "agent/request" 挂载点获得精确的 payload/next 签名。
//
// Load dsh-agent's module augmentation of Cordis Events (compile-time types)
// so the "agent/request" mount point gets precise payload/next signatures.
import type {} from "@deepseek-ai/dsh-agent";
import { Config } from "./config.js";
import { RateLimiter } from "./limiter.js";
import type { BucketOptions } from "./limiter.js";

export { Config };
export const name = "rate-limiter";

/**
 * 解析并校验插件配置（Cordis 已按 Config schema 校验，此处补齐默认值）。
 *
 * Parse and validate plugin config (Cordis already validates against the
 * Config schema; here we just fill in the defaults).
 */
export function resolveConfig(
  config: unknown = {},
): { enabled: boolean; providers: Record<string, BucketOptions> } {
  const raw = (config ?? {}) as Record<string, unknown>;
  const providers: Record<string, BucketOptions> = {};
  const providersRaw = raw.providers;
  if (providersRaw !== undefined && providersRaw !== null) {
    if (typeof providersRaw !== "object") {
      throw new Error("rate-limiter: providers 必须为对象");
    }
    for (const [provider, value] of Object.entries(providersRaw as Record<string, unknown>)) {
      const options = (value ?? {}) as Record<string, unknown>;
      const rate = options.rate;
      const burst = options.burst;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`rate-limiter: provider "${provider}" 的 rate 必须为正数`);
      }
      if (typeof burst !== "number" || !Number.isInteger(burst) || burst < 1) {
        throw new Error(`rate-limiter: provider "${provider}" 的 burst 必须为正整数`);
      }
      providers[provider] = { rate, burst };
    }
  }
  return { enabled: raw.enabled !== false, providers };
}

/**
 * 主动限速插件：在 agent/request waterfall 中，先委托 next() 拿到含
 * provider 的调用配置，再按 provider 限速（不足则延迟排队而非失败），
 * 然后原样返回配置——不修改请求内容、不改路由、不吞错误。
 *
 * Proactive rate-limiter plugin: on the agent/request waterfall, delegate to
 * next() first to obtain the call config (which carries the provider), then
 * rate-limit per provider (queue with a delay instead of failing when tokens
 * run short), then return the config unchanged — never modify request content,
 * never change routing, never swallow errors.
 */
export function apply(ctx: Context, config: unknown = {}): void {
  const { enabled, providers } = resolveConfig(config);
  if (!enabled) return;
  const limiter = new RateLimiter(providers);
  const dispose = ctx.on(
    "agent/request",
    async ({ signal }, next): Promise<LlmCallConfig> => {
      const callConfig = await next();
      await limiter.wait(callConfig.provider, signal);
      return callConfig;
    },
  );
  ctx.effect(
    () => async () => {
      dispose();
    },
    "rate-limiter: dispose agent/request listener",
  );
}
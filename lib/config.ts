import z from "@deepseek-ai/schemastery";
import type { BucketOptions } from "./limiter.js";

/** 单个供应商的令牌桶参数 */
export interface BucketConfig {
  /** 补充速率（词元每秒），即长期平均 QPS */
  rate: number
  /** 桶容量，允许的突发请求数 */
  burst: number
}

/** 单个供应商的令牌桶 schema */
export const BucketSchema = z.object({
  rate: z.number()
    .min(0.001)
    .description(
      "补充速率（词元每秒），即长期平均 QPS。"
      + " Refill rate (tokens/second), i.e. the long-term average QPS.",
    ),
  burst: z.natural()
    .min(1)
    .description(
      "桶容量，允许的突发请求数。"
      + " Bucket capacity, the number of burst requests allowed.",
    ),
}).i18n({
  "zh-CN": {
    rate: "速率（词元每秒）",
    burst: "突发容量",
  },
});

/** 插件配置接口 */
export interface Config {
  /** 是否启用限速 */
  enabled: boolean
  /** 按供应商配置的令牌桶参数 */
  providers: Record<string, BucketConfig>
}

/** 插件配置 schema（Schemastery 校验，自动生成设置 UI） */
export const Config = z.object({
  enabled: z.boolean()
    .default(true)
    .description("启用/禁用限速插件。Enable or disable the rate limiter."),
  providers: z.dict(BucketSchema)
    .default({})
    .description(
      "按供应商名称配置限速参数，键名为供应商标识。"
      + " Rate-limit parameters per provider, keyed by provider name.",
    ),
}).i18n({
  "zh-CN": {
    enabled: "启用限速",
    providers: "供应商限速配置",
  },
});

/**
 * 解析并校验插件配置（Cordis 已按 Config schema 校验，此处补齐默认值）。
 * 供网关与限速器读取实时合成配置。
 *
 * Parse and validate plugin config (Cordis already validates against the
 * Config schema; here we just fill in the defaults). Consumed by the gateway
 * and the limiter to read the live composed config.
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
        throw new Error(`rate-limiter: 供应商 "${provider}" 的 rate 必须为正数`);
      }
      if (typeof burst !== "number" || !Number.isInteger(burst) || burst < 1) {
        throw new Error(`rate-limiter: 供应商 "${provider}" 的 burst 必须为正整数`);
      }
      providers[provider] = { rate, burst };
    }
  }
  return { enabled: raw.enabled !== false, providers };
}
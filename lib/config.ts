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

/**
 * 把顶层 schema 字段标记为 volatile（dsh 0.1.7+/0.2 的实时引用字段）。
 *
 * 三级降级以兼容旧 schemastery：新版本提供 `.volatile()`；更早的版本只有
 * `.extra(key, value)`；两者都没有时原样返回（旧宿主不认识 volatile，普通值
 * 语义不受影响）。
 *
 * Mark a top-level schema field as volatile (the live-reference fields of dsh
 * 0.1.7+/0.2). Three-level fallback for older schemastery: new versions expose
 * `.volatile()`; older ones only `.extra(key, value)`; if neither exists the
 * schema is returned unchanged (older hosts do not know volatile, and the plain
 * value semantics are unaffected).
 */
function live<S>(schema: S): S {
  const candidate = schema as S & {
    volatile?: () => S
    extra?: (key: string, value: unknown) => S
  };
  if (typeof candidate.volatile === "function") return candidate.volatile();
  if (typeof candidate.extra === "function") return candidate.extra("volatile", true);
  return schema;
}

/** 插件配置 schema（Schemastery 校验，自动生成设置 UI） */
// 显式标注类型，避免 tsc 因依赖树中的同名类型副本（cosmokit Dict）推断出
// 不可移植的匿名类型（TS2742）；同时把输入固定为 Partial<Config>（默认值
// 允许省略字段），输出为完整 Config。
//
// Explicit annotation avoids tsc inferring a non-portable anonymous type
// (TS2742) through a duplicate copy of a dependency type (cosmokit Dict);
// input is Partial<Config> (defaults allow omitted fields), output is Config.
export const Config: Schemastery<Partial<Config>, Config> = z.object({
  enabled: live(
    z.boolean()
      .default(true)
      .description("启用/禁用限速插件。Enable or disable the rate limiter."),
  ),
  providers: live(
    z.dict(BucketSchema)
      .default({})
      .description(
        "按供应商名称配置限速参数，键名为供应商标识。"
        + " Rate-limit parameters per provider, keyed by provider name.",
      ),
  ),
}).i18n({
  "zh-CN": {
    enabled: "启用限速",
    providers: "供应商限速配置",
  },
});

/**
 * 解包 Volatile 引用：有 `get` 函数的对象取实时值，其余原样返回。
 *
 * 新宿主（0.1.7+/0.2）把 volatile 字段作为 `{ get() }` 引用传入 `apply`；
 * 旧宿主与普通配置直接是值。统一在这里解包，消费方无需关心宿主代际。
 *
 * Unwrap a Volatile reference: an object with a `get` function yields its live
 * value; anything else is returned as-is. New hosts (0.1.7+/0.2) pass volatile
 * fields into `apply` as `{ get() }` references, while older hosts and plain
 * config pass values directly. Unwrapping here keeps consumers host-agnostic.
 */
function unwrap(value: unknown): unknown {
  if (
    value !== null
    && typeof value === "object"
    && typeof (value as { get?: unknown }).get === "function"
  ) {
    return (value as { get: () => unknown }).get();
  }
  return value;
}

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
  const raw = unwrap(config ?? {}) as Record<string, unknown>;
  const providers: Record<string, BucketOptions> = {};
  const providersRaw = unwrap(raw.providers);
  if (providersRaw !== undefined && providersRaw !== null) {
    if (typeof providersRaw !== "object") {
      throw new Error("rate-limiter: providers 必须为对象");
    }
    for (const [provider, value] of Object.entries(providersRaw as Record<string, unknown>)) {
      const options = unwrap(value ?? {}) as Record<string, unknown>;
      const rate = unwrap(options.rate);
      const burst = unwrap(options.burst);
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`rate-limiter: 供应商 "${provider}" 的 rate 必须为正数`);
      }
      if (typeof burst !== "number" || !Number.isInteger(burst) || burst < 1) {
        throw new Error(`rate-limiter: 供应商 "${provider}" 的 burst 必须为正整数`);
      }
      providers[provider] = { rate, burst };
    }
  }
  return { enabled: unwrap(raw.enabled) !== false, providers };
}
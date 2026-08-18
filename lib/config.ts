import z from "@deepseek-ai/schemastery";

/** 单个 provider 的令牌桶参数 */
export interface BucketConfig {
  /** 补充速率（token/秒），即长期平均 QPS */
  rate: number
  /** 桶容量，允许的突发请求数 */
  burst: number
}

/** 单个 provider 的令牌桶 schema */
export const BucketSchema = z.object({
  rate: z.number()
    .min(0.001)
    .description(
      "补充速率（token/秒），即长期平均 QPS。"
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
    rate: "速率（token/秒）",
    burst: "突发容量",
  },
});

/** 插件配置接口 */
export interface Config {
  /** 是否启用限速 */
  enabled: boolean
  /** 按 provider 配置的令牌桶参数 */
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
      "按 provider 名称配置限速参数，键名为 provider 标识。"
      + " Rate-limit parameters per provider, keyed by provider name.",
    ),
}).i18n({
  "zh-CN": {
    enabled: "启用限速",
    providers: "Provider 限速配置",
  },
});
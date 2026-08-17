import z from "@deepseek-ai/schemastery";

/** 单个 provider 的令牌桶参数 */
export const BucketSchema = z.object({
  /** 补充速率（token/秒），即长期平均 QPS */
  rate: z.number().min(0.001),
  /** 桶容量，允许的突发请求数 */
  burst: z.natural().min(1),
});

/** 插件配置 schema（Schemastery 校验） */
export const Config = z.object({
  enabled: z.boolean().default(true),
  providers: z.dict(BucketSchema).default({}),
});
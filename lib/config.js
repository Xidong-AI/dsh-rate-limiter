import z from "@deepseek-ai/schemastery";
const BucketSchema = z.object({
  /** 补充速率（token/秒），即长期平均 QPS */
  rate: z.number().min(1e-3),
  /** 桶容量，允许的突发请求数 */
  burst: z.natural().min(1)
});
const Config = z.object({
  enabled: z.boolean().default(true),
  providers: z.dict(BucketSchema).default({})
});
export {
  BucketSchema,
  Config
};

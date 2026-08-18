import z from "@deepseek-ai/schemastery";
const BucketSchema = z.object({
  rate: z.number().min(1e-3).description(
    "\u8865\u5145\u901F\u7387\uFF08token/\u79D2\uFF09\uFF0C\u5373\u957F\u671F\u5E73\u5747 QPS\u3002 Refill rate (tokens/second), i.e. the long-term average QPS."
  ),
  burst: z.natural().min(1).description(
    "\u6876\u5BB9\u91CF\uFF0C\u5141\u8BB8\u7684\u7A81\u53D1\u8BF7\u6C42\u6570\u3002 Bucket capacity, the number of burst requests allowed."
  )
}).i18n({
  "zh-CN": {
    rate: "\u901F\u7387\uFF08token/\u79D2\uFF09",
    burst: "\u7A81\u53D1\u5BB9\u91CF"
  }
});
const Config = z.object({
  enabled: z.boolean().default(true).description("\u542F\u7528/\u7981\u7528\u9650\u901F\u63D2\u4EF6\u3002Enable or disable the rate limiter."),
  providers: z.dict(BucketSchema).default({}).description(
    "\u6309 provider \u540D\u79F0\u914D\u7F6E\u9650\u901F\u53C2\u6570\uFF0C\u952E\u540D\u4E3A provider \u6807\u8BC6\u3002 Rate-limit parameters per provider, keyed by provider name."
  )
}).i18n({
  "zh-CN": {
    enabled: "\u542F\u7528\u9650\u901F",
    providers: "Provider \u9650\u901F\u914D\u7F6E"
  }
});
export {
  BucketSchema,
  Config
};

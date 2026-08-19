import z from "@deepseek-ai/schemastery";
const BucketSchema = z.object({
  rate: z.number().min(1e-3).description(
    "\u8865\u5145\u901F\u7387\uFF08\u8BCD\u5143\u6BCF\u79D2\uFF09\uFF0C\u5373\u957F\u671F\u5E73\u5747 QPS\u3002 Refill rate (tokens/second), i.e. the long-term average QPS."
  ),
  burst: z.natural().min(1).description(
    "\u6876\u5BB9\u91CF\uFF0C\u5141\u8BB8\u7684\u7A81\u53D1\u8BF7\u6C42\u6570\u3002 Bucket capacity, the number of burst requests allowed."
  )
}).i18n({
  "zh-CN": {
    rate: "\u901F\u7387\uFF08\u8BCD\u5143\u6BCF\u79D2\uFF09",
    burst: "\u7A81\u53D1\u5BB9\u91CF"
  }
});
const Config = z.object({
  enabled: z.boolean().default(true).description("\u542F\u7528/\u7981\u7528\u9650\u901F\u63D2\u4EF6\u3002Enable or disable the rate limiter."),
  providers: z.dict(BucketSchema).default({}).description(
    "\u6309\u4F9B\u5E94\u5546\u540D\u79F0\u914D\u7F6E\u9650\u901F\u53C2\u6570\uFF0C\u952E\u540D\u4E3A\u4F9B\u5E94\u5546\u6807\u8BC6\u3002 Rate-limit parameters per provider, keyed by provider name."
  )
}).i18n({
  "zh-CN": {
    enabled: "\u542F\u7528\u9650\u901F",
    providers: "\u4F9B\u5E94\u5546\u9650\u901F\u914D\u7F6E"
  }
});
function resolveConfig(config = {}) {
  const raw = config ?? {};
  const providers = {};
  const providersRaw = raw.providers;
  if (providersRaw !== void 0 && providersRaw !== null) {
    if (typeof providersRaw !== "object") {
      throw new Error("rate-limiter: providers \u5FC5\u987B\u4E3A\u5BF9\u8C61");
    }
    for (const [provider, value] of Object.entries(providersRaw)) {
      const options = value ?? {};
      const rate = options.rate;
      const burst = options.burst;
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`rate-limiter: \u4F9B\u5E94\u5546 "${provider}" \u7684 rate \u5FC5\u987B\u4E3A\u6B63\u6570`);
      }
      if (typeof burst !== "number" || !Number.isInteger(burst) || burst < 1) {
        throw new Error(`rate-limiter: \u4F9B\u5E94\u5546 "${provider}" \u7684 burst \u5FC5\u987B\u4E3A\u6B63\u6574\u6570`);
      }
      providers[provider] = { rate, burst };
    }
  }
  return { enabled: raw.enabled !== false, providers };
}
export {
  BucketSchema,
  Config,
  resolveConfig
};

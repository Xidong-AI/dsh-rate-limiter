import { Config } from "./config.js";
import { RateLimiter } from "./limiter.js";
const name = "rate-limiter";
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
        throw new Error(`rate-limiter: provider "${provider}" \u7684 rate \u5FC5\u987B\u4E3A\u6B63\u6570`);
      }
      if (typeof burst !== "number" || !Number.isInteger(burst) || burst < 1) {
        throw new Error(`rate-limiter: provider "${provider}" \u7684 burst \u5FC5\u987B\u4E3A\u6B63\u6574\u6570`);
      }
      providers[provider] = { rate, burst };
    }
  }
  return { enabled: raw.enabled !== false, providers };
}
function apply(ctx, config = {}) {
  const { enabled, providers } = resolveConfig(config);
  if (!enabled) return;
  const limiter = new RateLimiter(providers);
  const dispose = ctx.on(
    "agent/request",
    async ({ signal }, next) => {
      const callConfig = await next();
      await limiter.wait(callConfig.provider, signal);
      return callConfig;
    }
  );
  ctx.effect(
    () => async () => {
      dispose();
    },
    "rate-limiter: dispose agent/request listener"
  );
}
export {
  Config,
  apply,
  name,
  resolveConfig
};

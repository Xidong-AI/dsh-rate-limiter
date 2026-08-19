import { Config, resolveConfig } from "./config.js";
import { RateLimiter } from "./limiter.js";
import { installRateLimiterSettings } from "./settings.js";
import { RateLimiterConfigGateway, rateLimiterTypertContribution } from "./gateway.js";
const name = "rate-limiter";
function apply(ctx, config = {}) {
  const bridge = installRateLimiterSettings(ctx, config);
  try {
    new RateLimiterConfigGateway(ctx, bridge);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("has been registered")) {
      throw error;
    }
    ctx.logger("rate-limiter").debug(
      "rate-limiter gateway already registered \u2014 no gateway on this fiber (multi-fiber dedupe)"
    );
  }
  ctx.inject(["typert"], (tctx) => {
    try {
      const typert = tctx.typert;
      return typert.register(rateLimiterTypertContribution());
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already registered")) {
        throw error;
      }
      tctx.logger("rate-limiter").debug(
        "rate-limiter typert endpoints already registered \u2014 no endpoints on this fiber (multi-fiber dedupe)"
      );
      return () => {
      };
    }
  });
  let limiter = null;
  let disposeListener = null;
  function rebuild() {
    disposeListener?.();
    disposeListener = null;
    const { enabled, providers } = resolveConfig(bridge.source());
    if (!enabled) {
      limiter = null;
      return;
    }
    limiter = new RateLimiter(providers);
    disposeListener = ctx.on(
      "agent/request",
      async ({ signal }, next) => {
        const callConfig = await next();
        await limiter?.wait(callConfig.provider, signal);
        return callConfig;
      }
    );
  }
  rebuild();
  ctx.effect(
    () => bridge.onChange(rebuild),
    "rate-limiter: rebuild limiter on settings change"
  );
}
export {
  Config,
  apply,
  name,
  resolveConfig
};

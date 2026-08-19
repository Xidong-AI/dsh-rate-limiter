import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { Config } from "./config.js";
const RATE_LIMITER_SETTINGS_NAMESPACE = settingsNamespace("rate-limiter");
function isUnloading(ctx) {
  const state = ctx.fiber?.state;
  return state === 4 || state === 5;
}
function installRateLimiterSettings(ctx, entry) {
  const listeners = /* @__PURE__ */ new Set();
  let source = () => entry;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  ctx.inject(["settings"], (sctx) => {
    let scope;
    try {
      scope = sctx.settings.register(RATE_LIMITER_SETTINGS_NAMESPACE, Config, {
        // entry 已由 cordis Loader 按 Config schema 校验，此处作为合成 base
        // 传入（`base` 期望 Partial<schema 输出>，raw entry 经边界强转）。
        //
        // `entry` has already been validated by the cordis Loader against the
        // Config schema; it is passed here as the composition base (`base`
        // expects `Partial<schema output>`, so the raw entry is cast at the
        // boundary).
        base: entry
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already registered")) {
        throw error;
      }
      ctx.logger("rate-limiter").debug(
        "settings namespace already registered \u2014 entry-source fallback (multi-fiber dedupe)"
      );
      return;
    }
    source = () => scope.get();
    sctx.effect(() => () => {
      if (isUnloading(ctx)) return;
      source = () => entry;
      notify();
    });
    notify();
    scope.watch(() => {
      if (isUnloading(ctx)) return;
      notify();
    });
  });
  return {
    source: () => source(),
    onChange: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }
  };
}
export {
  RATE_LIMITER_SETTINGS_NAMESPACE,
  installRateLimiterSettings
};

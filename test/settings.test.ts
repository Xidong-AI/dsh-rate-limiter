import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { RATE_LIMITER_SETTINGS_NAMESPACE, installRateLimiterSettings } from "../lib/settings.js";

/**
 * `installRateLimiterSettings` 是纯运行时桥接：不 import 真实 dsh 0.2 包，
 * 用最小 plain mock 模拟两代宿主 settings 服务的形状差异。
 *
 * - 旧 API（0.1.6 及以前）：`settings.register` 存在。
 * - 新 API（0.1.7+/0.2）：无 `register`，有 `describe`；配置热更新由
 *   `loader/volatile-update` 与 `settings/document-updated` 事件通知。
 */

type Listener = (...args: unknown[]) => void;

interface MockOptions {
  settings?: Record<string, unknown>;
  /** fiber 状态：4 = DISPOSED，5 = UNLOADING；默认 2（运行中）。 */
  fiberState?: number;
}

function createCtx(options: MockOptions = {}) {
  const events = new Map<string, Set<Listener>>();
  const debug = vi.fn();
  const ctxEffects: Array<() => unknown> = [];
  const sctxEffects: Array<() => unknown> = [];

  const on = (name: string, listener: Listener) => {
    const set = events.get(name) ?? new Set<Listener>();
    set.add(listener);
    events.set(name, set);
    return () => {
      set.delete(listener);
    };
  };

  const ctx = {
    fiber: { state: options.fiberState ?? 2 },
    logger: () => ({ debug }),
    effect(fn: () => unknown) {
      const disposer = fn();
      ctxEffects.push(disposer as () => unknown);
      return disposer;
    },
    on,
    inject(_deps: string[], callback: (sctx: unknown) => unknown) {
      if (options.settings === undefined) return () => undefined;
      const sctx = {
        settings: options.settings,
        effect(fn: () => unknown) {
          const disposer = fn();
          sctxEffects.push(disposer as () => unknown);
          return disposer;
        },
      };
      const disposer = callback(sctx);
      return typeof disposer === "function" ? disposer : () => undefined;
    },
  };

  const emit = (name: string, ...args: unknown[]) => {
    for (const listener of events.get(name) ?? []) listener(...args);
  };

  return { ctx: ctx as unknown as Context, debug, ctxEffects, sctxEffects, emit, events };
}

const entry = { enabled: true, providers: { alpha: { rate: 2, burst: 3 } } };

describe("installRateLimiterSettings 旧 API（register 存在）", () => {
  it("注册 namespace、source 读取 scope 实时值并 watch 变更", () => {
    const scopeValue = { enabled: false, providers: {} };
    const watch = vi.fn(() => () => undefined);
    const register = vi.fn(() => ({ get: () => scopeValue, watch }));
    const { ctx, emit: _emit } = createCtx({ settings: { register } });

    const bridge = installRateLimiterSettings(ctx, entry);

    expect(register).toHaveBeenCalledWith(RATE_LIMITER_SETTINGS_NAMESPACE, expect.anything(), {
      base: entry,
    });
    expect(bridge.source()).toBe(scopeValue);
    expect(watch).toHaveBeenCalledTimes(1);

    let notified = 0;
    bridge.onChange(() => {
      notified += 1;
    });
    void _emit;
    expect(notified).toBe(0);
  });

  it("detach 经 sctx.effect cleanup 回退 entry 并通知", () => {
    const scopeValue = { enabled: false, providers: {} };
    const { ctx, sctxEffects } = createCtx({
      settings: { register: () => ({ get: () => scopeValue, watch: () => () => undefined }) },
    });
    const bridge = installRateLimiterSettings(ctx, entry);
    let notified = 0;
    bridge.onChange(() => {
      notified += 1;
    });

    expect(bridge.source()).toBe(scopeValue);
    sctxEffects[0]();
    expect(bridge.source()).toBe(entry);
    expect(notified).toBe(1);
  });

  it("多 fiber 去重：already registered 不抛出且保持 entry 回退", () => {
    const register = vi.fn(() => {
      throw new Error('settings namespace "rate-limiter" is already registered');
    });
    const { ctx, debug } = createCtx({ settings: { register } });

    let bridge: ReturnType<typeof installRateLimiterSettings> | undefined;
    expect(() => {
      bridge = installRateLimiterSettings(ctx, entry);
    }).not.toThrow();
    expect(bridge?.source()).toBe(entry);
    expect(debug).toHaveBeenCalled();
  });
});

describe("installRateLimiterSettings 新 API（无 register、有 describe）", () => {
  it("source 保持 entry，并监听两个热更新事件", () => {
    const { ctx, events, ctxEffects } = createCtx({ settings: { describe: () => [] } });

    const bridge = installRateLimiterSettings(ctx, entry);

    expect(bridge.source()).toBe(entry);
    expect([...events.keys()]).toContain("loader/volatile-update");
    expect([...events.keys()]).toContain("settings/document-updated");
    expect(ctxEffects).toHaveLength(1);
  });

  it("事件触发 onChange 回调", () => {
    const { ctx, emit } = createCtx({ settings: { describe: () => [] } });
    const bridge = installRateLimiterSettings(ctx, entry);
    let notified = 0;
    bridge.onChange(() => {
      notified += 1;
    });

    emit("loader/volatile-update", { enabled: true }, ["enabled"]);
    expect(notified).toBe(1);
    emit("settings/document-updated", RATE_LIMITER_SETTINGS_NAMESPACE, 2);
    expect(notified).toBe(2);
  });

  it("event cleanup 在 ctx.effect disposer 上解绑两个监听", () => {
    const { ctx, ctxEffects, emit } = createCtx({ settings: { describe: () => [] } });
    const bridge = installRateLimiterSettings(ctx, entry);
    let notified = 0;
    bridge.onChange(() => {
      notified += 1;
    });

    ctxEffects[0]();
    emit("loader/volatile-update", {}, ["enabled"]);
    emit("settings/document-updated", RATE_LIMITER_SETTINGS_NAMESPACE, 2);
    expect(notified).toBe(0);
  });
});

describe("installRateLimiterSettings 降级", () => {
  it("无 settings 服务时 source 保持 entry", () => {
    const { ctx, events, ctxEffects } = createCtx();
    const bridge = installRateLimiterSettings(ctx, entry);

    expect(bridge.source()).toBe(entry);
    expect(events.size).toBe(0);
    expect(ctxEffects).toHaveLength(0);
  });

  it("settings 既无 register 也无 describe 时回退 entry 并记 debug", () => {
    const { ctx, debug } = createCtx({ settings: {} });
    const bridge = installRateLimiterSettings(ctx, entry);

    expect(bridge.source()).toBe(entry);
    expect(debug).toHaveBeenCalled();
  });
});

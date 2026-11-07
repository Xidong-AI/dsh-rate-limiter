import { describe, expect, it } from "vitest";
import { Config, resolveConfig } from "../lib/config.js";

/**
 * `lib/config.js` 是 esbuild 产物，测试直接消费它（与 gateway.test.ts 相同）。
 * 这里覆盖 0.1.7+/0.2 引入的 Volatile 引用：schema 顶层字段标注 volatile 后，
 * 宿主传入的 `config` 字段是 `{ get() }` 包装的实时引用，`resolveConfig` 必须
 * 解包；同时保证普通值路径完全不变。
 */
describe("Config schema 的 volatile 标注", () => {
  it("enabled / providers 两个顶层字段声明了 volatile", () => {
    const dict = (Config as unknown as {
      dict?: Record<string, { meta?: { volatile?: boolean } }>;
    }).dict;
    expect(dict?.enabled?.meta?.volatile).toBe(true);
    expect(dict?.providers?.meta?.volatile).toBe(true);
  });

  it("BucketSchema 内部字段不标 volatile（避免 dict 内部字段被拒）", () => {
    const dict = (Config as unknown as {
      dict?: Record<string, { inner?: { dict?: Record<string, { meta?: { volatile?: boolean } }> } }>;
    }).dict;
    const inner = dict?.providers?.inner?.dict;
    expect(inner?.rate?.meta?.volatile).not.toBe(true);
    expect(inner?.burst?.meta?.volatile).not.toBe(true);
  });
});

describe("resolveConfig 解包 Volatile 引用", () => {
  it("顶层 raw、enabled、providers 与桶内 rate/burst 均解包", () => {
    const wrapped = {
      get: () => ({
        enabled: { get: () => false },
        providers: {
          get: () => ({
            alpha: {
              get: () => ({
                rate: { get: () => 2 },
                burst: { get: () => 3 },
              }),
            },
          }),
        },
      }),
    };
    expect(resolveConfig(wrapped)).toEqual({
      enabled: false,
      providers: { alpha: { rate: 2, burst: 3 } },
    });
  });

  it("Volatile 与普通值混用：各字段独立解包", () => {
    const mixed = {
      enabled: { get: () => true },
      providers: {
        alpha: { rate: 1.5, burst: 4 },
        beta: { get: () => ({ rate: { get: () => 0.5 }, burst: 2 }) },
      },
    };
    expect(resolveConfig(mixed)).toEqual({
      enabled: true,
      providers: {
        alpha: { rate: 1.5, burst: 4 },
        beta: { rate: 0.5, burst: 2 },
      },
    });
  });
});

describe("resolveConfig 普通值路径回归", () => {
  it("未传配置时使用默认值", () => {
    expect(resolveConfig()).toEqual({ enabled: true, providers: {} });
  });

  it("enabled=false 与 providers 原样解析", () => {
    expect(
      resolveConfig({ enabled: false, providers: { a: { rate: 2, burst: 3 } } }),
    ).toEqual({ enabled: false, providers: { a: { rate: 2, burst: 3 } } });
  });

  it("非法桶值仍抛出原有错误", () => {
    expect(() =>
      resolveConfig({ providers: { a: { rate: 0, burst: 1 } } }),
    ).toThrow('供应商 "a" 的 rate 必须为正数');
    expect(() =>
      resolveConfig({ providers: { a: { rate: 1, burst: 1.5 } } }),
    ).toThrow('供应商 "a" 的 burst 必须为正整数');
  });
});

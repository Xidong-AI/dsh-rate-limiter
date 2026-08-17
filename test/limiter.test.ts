import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, TokenBucket, cancellableDelay } from "../lib/limiter.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("burst 内请求立即放行", () => {
    const bucket = new TokenBucket(2, 5);
    for (let i = 0; i < 5; i++) {
      expect(bucket.reserve()).toBe(0);
    }
  });

  it("超出 burst 后按 rate 排队等待", () => {
    const bucket = new TokenBucket(2, 1); // rate=2/s，burst=1
    expect(bucket.reserve()).toBe(0);
    expect(bucket.reserve()).toBe(500); // 1/2 秒 = 500ms
  });

  it("并发预约各自排队，不超发", () => {
    const bucket = new TokenBucket(1, 3);
    const waits = [0, 1, 2, 3, 4].map(() => bucket.reserve());
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBe(0);
    expect(waits[2]).toBe(0);
    expect(waits[3]).toBe(1000);
    expect(waits[4]).toBe(2000);
  });

  it("空闲后桶按 rate 补充", () => {
    const bucket = new TokenBucket(1, 1);
    bucket.reserve();
    vi.advanceTimersByTime(2000); // 空闲 2 秒
    expect(bucket.reserve()).toBe(0); // 桶已补充，立即放行
  });

  it("空闲很久后突发不超过 burst", () => {
    const bucket = new TokenBucket(1, 3);
    bucket.reserve();
    bucket.reserve();
    bucket.reserve();
    expect(bucket.reserve()).toBe(1000); // 桶耗尽
    vi.advanceTimersByTime(10000); // 空闲 10 秒，桶补满
    const waits = [0, 1, 2, 3].map(() => bucket.reserve());
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBe(0);
    expect(waits[2]).toBe(0);
    expect(waits[3]).toBe(1000); // 第 4 个仍需按 rate 等待
  });

  it("非法参数抛错", () => {
    expect(() => new TokenBucket(0, 1)).toThrow();
    expect(() => new TokenBucket(-1, 1)).toThrow();
    expect(() => new TokenBucket(1, 0)).toThrow();
    expect(() => new TokenBucket(1, 1.5)).toThrow();
  });
});

describe("cancellableDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常等待后返回 true", async () => {
    const promise = cancellableDelay(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBe(true);
  });

  it("signal 中止时立即返回 false", async () => {
    const controller = new AbortController();
    const promise = cancellableDelay(10000, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBe(false);
  });

  it("已中止的 signal 直接返回 false", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(cancellableDelay(1000, controller.signal)).resolves.toBe(false);
  });
});

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("未配置的 provider 立即放行", async () => {
    const limiter = new RateLimiter({});
    await expect(limiter.wait("unknown")).resolves.toBe(false);
  });

  it("配置的 provider 首次立即放行，超限后等待", async () => {
    const limiter = new RateLimiter({ p: { rate: 1, burst: 1 } });
    await expect(limiter.wait("p")).resolves.toBe(false);
    const waiting = limiter.wait("p");
    vi.advanceTimersByTime(1000);
    await expect(waiting).resolves.toBe(true);
  });

  it("等待期间取消信号中断等待", async () => {
    const limiter = new RateLimiter({ p: { rate: 1, burst: 1 } });
    await limiter.wait("p");
    const controller = new AbortController();
    const waiting = limiter.wait("p", controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBe(true);
  });
});
class TokenBucket {
  nextAvailableAt;
  intervalMs;
  burst;
  constructor(rate, burst) {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`rate \u5FC5\u987B\u4E3A\u6B63\u6570\uFF0C\u6536\u5230 ${rate}`);
    }
    if (!Number.isInteger(burst) || burst < 1) {
      throw new Error(`burst \u5FC5\u987B\u4E3A\u6B63\u6574\u6570\uFF0C\u6536\u5230 ${burst}`);
    }
    this.intervalMs = 1e3 / rate;
    this.burst = burst;
    this.nextAvailableAt = Date.now() - (burst - 1) * this.intervalMs;
  }
  /** 预约一个 token，返回需等待的毫秒数（0 表示立即放行） */
  reserve() {
    const now = Date.now();
    this.nextAvailableAt = Math.max(
      this.nextAvailableAt,
      now - (this.burst - 1) * this.intervalMs
    );
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt += this.intervalMs;
    return waitMs;
  }
}
function cancellableDelay(delayMs, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
class RateLimiter {
  constructor(providers) {
    this.providers = providers;
  }
  providers;
  buckets = /* @__PURE__ */ new Map();
  /**
   * 等待到有 token 再放行。
   *
   * @returns 是否发生了等待（被限速）。
   */
  async wait(provider, signal) {
    const options = this.providers[provider];
    if (!options) return false;
    let bucket = this.buckets.get(provider);
    if (!bucket) {
      bucket = new TokenBucket(options.rate, options.burst);
      this.buckets.set(provider, bucket);
    }
    const waitMs = bucket.reserve();
    if (waitMs > 0) await cancellableDelay(waitMs, signal);
    return waitMs > 0;
  }
}
export {
  RateLimiter,
  TokenBucket,
  cancellableDelay
};

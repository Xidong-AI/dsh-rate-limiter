/**
 * 主动限速核心逻辑：按 provider 的令牌桶（token bucket）。
 * 纯函数模块，不依赖 Cordis/ctx，可独立单元测试。
 *
 * Core rate-limiting logic: a token bucket per provider.
 * Pure function module with no Cordis/ctx dependency, independently unit-testable.
 */

export interface BucketOptions {
  /**
   * 补充速率（token/秒），即长期平均 QPS。
   *
   * Refill rate (tokens/second), i.e. the long-term average QPS.
   */
  rate: number;
  /**
   * 桶容量，允许的突发请求数。
   *
   * Bucket capacity, the number of burst requests allowed.
   */
  burst: number;
}

/**
 * 令牌桶：预约式实现。
 *
 * 每个请求同步调用 {@link reserve} 预约一个 token，返回需等待的毫秒数。
 * 预约在 await 之前完成，因此并发请求各自排队、不会超发。
 *
 * simp: 取消等待的请求不会归还已预约的 slot，后续请求会多等（保守行为，
 * 更安全）。若需精确归还，可改为在取消时回退 nextAvailableAt。
 *
 * Token bucket: reservation-based implementation.
 *
 * Each request synchronously calls {@link reserve} to reserve a token and
 * receives the number of milliseconds to wait. Reservations complete before
 * any await, so concurrent requests queue independently and never over-issue.
 *
 * simp: a cancelled wait does not refund its reserved slot, so later requests
 * wait a bit longer (conservative and safer). For exact refunds, roll back
 * nextAvailableAt on cancellation instead.
 */
export class TokenBucket {
  private nextAvailableAt: number;
  private readonly intervalMs: number;
  private readonly burst: number;

  constructor(rate: number, burst: number) {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`rate 必须为正数，收到 ${rate}`);
    }
    if (!Number.isInteger(burst) || burst < 1) {
      throw new Error(`burst 必须为正整数，收到 ${burst}`);
    }
    this.intervalMs = 1000 / rate;
    this.burst = burst;
    // 初始允许 burst 个请求立即放行
    // Initially allow `burst` requests to pass immediately.
    this.nextAvailableAt = Date.now() - (burst - 1) * this.intervalMs;
  }

  /**
   * 预约一个 token，返回需等待的毫秒数（0 表示立即放行）。
   *
   * Reserve a token and return the milliseconds to wait (0 = pass now).
   */
  reserve(): number {
    const now = Date.now();
    // 空闲恢复：桶最多恢复满（burst），即下次可用时刻最多提前到下限；
    // 不通过 Math.max(now, ...) 丢弃 burst 的追赶余量
    //
    // Idle recovery: the bucket refills at most up to (burst), i.e. the next
    // available time can advance at most down to the floor; the burst
    // catch-up allowance is kept instead of being dropped by Math.max(now, ...)
    this.nextAvailableAt = Math.max(
      this.nextAvailableAt,
      now - (this.burst - 1) * this.intervalMs,
    );
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt += this.intervalMs;
    return waitMs;
  }
}

/**
 * 可取消的延迟等待。
 *
 * @returns 正常等待结束返回 true；signal 中止返回 false。
 *
 * Cancellable delayed wait.
 *
 * @returns true when the wait finishes normally; false when aborted by signal.
 */
export function cancellableDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
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

/**
 * 按 provider 管理令牌桶的限速器。
 * 未配置的 provider 原样放行（零侵入）。
 *
 * A rate limiter managing one token bucket per provider.
 * Unconfigured providers pass through untouched (zero intrusion).
 */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly providers: Record<string, BucketOptions>) {}

  /**
   * 等待到有 token 再放行。
   *
   * @returns 是否发生了等待（被限速）。
   *
   * Wait until a token is available, then let the request through.
   *
   * @returns whether a wait occurred (i.e. the request was rate-limited).
   */
  async wait(provider: string, signal?: AbortSignal): Promise<boolean> {
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
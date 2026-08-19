import type { Context } from "@deepseek-ai/cordis";
import type { LlmCallConfig } from "@deepseek-ai/dsh-llm";
// 加载 dsh-agent 对 Cordis Events 的模块扩展（编译期类型），
// 使 "agent/request" 挂载点获得精确的 payload/next 签名。
//
// Load dsh-agent's module augmentation of Cordis Events (compile-time types)
// so the "agent/request" mount point gets precise payload/next signatures.
import type {} from "@deepseek-ai/dsh-agent";
import { Config, resolveConfig } from "./config.js";
import { RateLimiter } from "./limiter.js";
import type { BucketOptions } from "./limiter.js";
import { installRateLimiterSettings } from "./settings.js";
import { RateLimiterConfigGateway, rateLimiterTypertContribution } from "./gateway.js";

export { Config, resolveConfig };
export const name = "rate-limiter";

/**
 * 主动限速插件：在 agent/request waterfall 中，先委托 next() 拿到含
 * provider 的调用配置，再按 provider 限速（不足则延迟排队而非失败），
 * 然后原样返回配置——不修改请求内容、不改路由、不吞错误。
 *
 * Proactive rate-limiter plugin: on the agent/request waterfall, delegate to
 * next() first to obtain the call config (which carries the provider), then
 * rate-limit per provider (queue with a delay instead of failing when tokens
 * run short), then return the config unchanged — never modify request content,
 * never change routing, never swallow errors.
 */
export function apply(ctx: Context, config: unknown = {}): void {
  // 注册 settings namespace + 实时 source 桥。DSH rc.7+ 网页"设置 → 插件"对
  // 第三方插件不通过 settings.describe 白名单（上游 exposedNamespaces 只含
  // model-provider + 产品 namespace），必须由插件自建 typert RPC 端点（数据
  // 通道）+ 前端卡片（UI）。本任务只做 host 侧：桥提供实时合成配置 source，
  // 网关（/api/rate-limiter/get + /set）读写它，运行时经 bridge.onChange 在
  // 配置变更时重建限速器。
  //
  // Register the settings namespace + live source bridge. DSH rc.7+ web
  // "Settings → Plugins" does not route third-party plugins through the
  // settings.describe allowlist (upstream exposedNamespaces unions only
  // model-provider + product namespaces), so the plugin must build its own
  // typert RPC endpoints (data channel) + front-end card (UI). This task only
  // does the host side: the bridge exposes the live composed config source, the
  // gateway (/api/rate-limiter/get + /set) reads/writes it, and the runtime
  // rebuilds the limiter via bridge.onChange on config changes.
  const bridge = installRateLimiterSettings(ctx, config);

  // host 侧 `rate-limiter` 配置网关——`/api/rate-limiter/get` + `/set` 端点。
  // 端点经 `ctx.typert.register(...)` 显式注册（非 `@Remote` SRC 标记）：host
  // typertGateway 优先检查 `ctx.typert.local` 做 claim + dispatch，而 SRC 发现
  // 读取模块私有标记表，本地链接插件无法与 host 安装共享（零端点 → 404）。
  // 多 fiber 去重镜像 settings 注册：cordis Service 注册对重复键响亮失败，catch
  // 让第一个 fiber 拥有 `rate-limiter` 服务键，后续 fiber 回退（无网关）。
  //
  // The host-side `rate-limiter` config gateway — the `/api/rate-limiter/get` +
  // `/set` endpoints. Endpoints are registered EXPLICITLY through
  // `ctx.typert.register(...)` (NOT the @Remote SRC markers): the host
  // typertGateway checks `ctx.typert.local` FIRST for claim + dispatch, while
  // SRC discovery reads a module-private marker table a locally-linked plugin
  // can never share with the host installation (zero claimed endpoints → 404).
  // Multi-fiber dedupe mirrors the settings registration: the cordis Service
  // registration fails loud on a duplicate key, so the catch lets the FIRST
  // fiber own the `rate-limiter` service key while later fibers fall back.
  try {
    new RateLimiterConfigGateway(ctx, bridge);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("has been registered")) {
      throw error;
    }
    ctx.logger("rate-limiter").debug(
      "rate-limiter gateway already registered — no gateway on this fiber (multi-fiber dedupe)",
    );
  }

  // typert 端点注册是可选的，像 settings 服务一样：经条件注入子激活，因此没有
  // typert registry 的合成（headless/standalone/integration harness）保持限速
  // 运行时工作、仅省略 /api 端点。子 disposer 即注册自身的 effect disposer，
  // 端点在本 fiber（或 typert 服务）消失时撤回。
  //
  // The typert endpoint registration is OPTIONAL, like the settings service: it
  // activates through a conditional inject child, so compositions without a
  // typert registry (headless/standalone/integration harnesses) keep the
  // rate-limiter runtime working and simply omit the /api endpoints. The child
  // disposer is the registration's own effect disposer, so the endpoints
  // withdraw when this fiber (or the typert service) goes away.
  ctx.inject(["typert"], (tctx) => {
    try {
      // host 的 `ctx.typert` 在本地类型（TypertRegistryContract）中未声明
      // `register`，故经最小结构访问（运行时 host 提供 register）。
      //
      // The host's `ctx.typert` does not declare `register` on the local type
      // (TypertRegistryContract), so it is reached through a minimal structural
      // cast (the host provides `register` at runtime).
      const typert = tctx.typert as unknown as {
        register(contribution: unknown): () => void;
      };
      return typert.register(rateLimiterTypertContribution());
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already registered")) {
        throw error;
      }
      tctx.logger("rate-limiter").debug(
        "rate-limiter typert endpoints already registered — no endpoints on this fiber (multi-fiber dedupe)",
      );
      return () => {};
    }
  });

  // 限速器可重建：配置变更（settings user layer 提交）时经 bridge.onChange
  // 重建。enabled=false 不注册 listener（零侵入）；未配置的 provider 原样放行。
  //
  // The limiter is rebuildable: on config changes (settings user layer commits)
  // it is rebuilt via bridge.onChange. enabled=false registers no listener (zero
  // intrusion); unconfigured providers pass through untouched.
  let limiter: RateLimiter | null = null;
  let disposeListener: (() => void) | null = null;

  function rebuild(): void {
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
      async ({ signal }, next): Promise<LlmCallConfig> => {
        const callConfig = await next();
        await limiter?.wait(callConfig.provider, signal);
        return callConfig;
      },
    );
  }

  rebuild();
  // onChange 返回取消订阅函数，挂在 ctx.effect 上（fiber 销毁时自动退订）。
  // onChange returns a disposer, mounted on ctx.effect (auto-unsubscribed when
  // the fiber is disposed).
  ctx.effect(
    () => bridge.onChange(rebuild),
    "rate-limiter: rebuild limiter on settings change",
  );
}
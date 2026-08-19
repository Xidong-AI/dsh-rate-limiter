/**
 * host 侧 `rate-limiter` 配置网关：`/api/rate-limiter/get` +
 * `/api/rate-limiter/set` Remote 端点。
 *
 * 传输：typertGateway `/api` 拦截器是 host 全局唯一的 RPC 槽（插件不得再次
 * `connection.rpc.intercept('/api')`——会抛错）。本服务通过 `TypertRemoteService`
 * 基类声明 typertGateway 绑定，并显式经 `ctx.typert.register(...)` 注册端点
 * （而非 `@Remote` SRC 标记：SRC 发现读取 `remoteMethods()`——一个模块私有
 * WeakMap——本地链接插件与 host 安装不共享该表，会导致零端点、`/api/rate-limiter/*`
 * 404）。显式注册把 invocation 描述符写入 `ctx.typert.local`，`claimsEndpoint`
 * 优先检查它，故 claim + dispatch 与模块身份无关。
 *
 * 数据：`get` 读取 `RateLimiterSettingsBridge` source——与运行时读取的同一份
 * 实时合成配置（schema 默认值 → 插件行 base → settings user layer），经
 * `resolveConfig` 解析。`set` 先校验 patch（未知顶层键、rate/burst 边界），再
 * 经 `ctx.settings.mutate` 进程内写入 USER layer（进程内写入无 exposed-namespace
 * 门——wire 级 `exposedNamespaces()` 检查只守卫 apiproxy 路径），返回新的合成值。
 *
 * settings 服务是可选的（无 settings 服务 → bridge source 保持 entry，`get`
 * 仍可用；`set` 以清晰错误失败——KD-G5 回退）。网关经条件
 * `ctx.inject(['settings'], ...)` 子注入捕获服务（与 `installRateLimiterSettings`
 * 相同的激活模式），因为 `ctx.settings` 只能从声明它的 fiber 解析。
 *
 * Host-side `rate-limiter` config gateway: the `/api/rate-limiter/get` +
 * `/api/rate-limiter/set` Remote endpoints.
 *
 * Transport: the typertGateway `/api` interceptor is the single host-wide RPC
 * slot (a plugin must NOT `connection.rpc.intercept('/api')` again — it would
 * throw). This service declares a typertGateway binding (via the
 * `TypertRemoteService` base) and registers endpoints EXPLICITLY through
 * `ctx.typert.register(...)` (NOT the `@Remote` SRC markers: SRC discovery
 * reads `remoteMethods()` — a module-private WeakMap — which a locally-linked
 * plugin can never share with the host installation, so the explicit
 * `TypertRegistry.register` path writes the invocation descriptors into
 * `ctx.typert.local`, which `claimsEndpoint` checks FIRST, so claim + dispatch
 * work regardless of module identity).
 *
 * Data: `get` reads the `RateLimiterSettingsBridge` source — the same live
 * composed config the runtime reads (schema defaults → plugin-row base →
 * settings user layer), resolved through `resolveConfig`. `set` validates the
 * patch first (unknown top-level keys, rate/burst bounds), then writes the
 * USER layer in-process via `ctx.settings.mutate` (no exposed-namespace gate on
 * the in-process write — the wire-level `exposedNamespaces()` check only guards
 * the apiproxy path), and returns the new composed value.
 *
 * The settings service is OPTIONAL (no settings service → the bridge source
 * stays the entry, `get` still works; `set` fails with a clear error — KD-G5
 * fallback). The gateway captures the service through a conditional
 * `ctx.inject(['settings'], ...)` child (the same activation pattern as
 * `installRateLimiterSettings`), because `ctx.settings` is only resolvable from
 * a fiber that declares it.
 *
 * @module dsh-rate-limiter/gateway
 */
import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import type { SettingsPathOp, SettingsProvider } from "@deepseek-ai/dsh-settings";
import { resolveConfig } from "./config.js";
import type { RateLimiterSettingsBridge } from "./settings.js";

/** `rate-limiter` settings namespace（写入目标）。 */
export const RATE_LIMITER_SETTINGS_NAMESPACE = settingsNamespace("rate-limiter");

/**
 * 把顶层 patch 转成 settings `mutate` 的路径操作序列（纯函数，可单测）。
 *
 * - 顶层键值为 null → `{ op: "unset", path: [key] }`
 * - 顶层键为 "providers" 且值为对象 → 遍历内部：值为 null →
 *   `{ op: "unset", path: ["providers", k] }`；否则 `{ op: "set", path: ["providers", k], value }`
 * - 其它 → `{ op: "set", path: [key], value }`
 *
 * Translate a top-level patch into a sequence of settings `mutate` path ops
 * (pure function, unit-testable).
 *
 * - top-level key with null value → `{ op: "unset", path: [key] }`
 * - top-level key "providers" with an object value → iterate inside: null value
 *   → `{ op: "unset", path: ["providers", k] }`; otherwise
 *   `{ op: "set", path: ["providers", k], value }`
 * - anything else → `{ op: "set", path: [key], value }`
 */
export function buildMutateOps(patch: Record<string, unknown>): SettingsPathOp[] {
  const ops: SettingsPathOp[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      ops.push({ op: "unset", path: [key] });
    } else if (key === "providers" && typeof value === "object") {
      for (const [provider, providerValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (providerValue === null) {
          ops.push({ op: "unset", path: ["providers", provider] });
        } else {
          ops.push({ op: "set", path: ["providers", provider], value: providerValue });
        }
      }
    } else {
      ops.push({ op: "set", path: [key], value });
    }
  }
  return ops;
}

/**
 * 把 patch 合并到 current 上，构造校验视图（纯函数，可单测）。
 *
 * null 键从 current 中删除；非 null 值覆盖；providers 递归合并（内部 null 键
 * 删除、非 null 覆盖）。current 是 `resolveConfig(source())` 的结果。
 *
 * Merge a patch onto `current` to build a validation view (pure function,
 * unit-testable). Null keys are deleted from `current`; non-null values
 * override; `providers` merges recursively (inner null keys deleted, non-null
 * overridden). `current` is the result of `resolveConfig(source())`.
 */
export function mergePatch(
  patch: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else if (key === "providers" && typeof value === "object") {
      const mergedProviders: Record<string, unknown> = {
        ...((result.providers as Record<string, unknown> | undefined) ?? {}),
      };
      for (const [provider, providerValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (providerValue === null) {
          delete mergedProviders[provider];
        } else {
          mergedProviders[provider] = providerValue;
        }
      }
      result.providers = mergedProviders;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** `resolveConfig` 的返回类型（enabled + providers）。 */
type ResolvedConfig = ReturnType<typeof resolveConfig>;

/**
 * host 侧 `rate-limiter` 配置网关（`/api/rate-limiter/get` +
 * `/api/rate-limiter/set`）。以 cordis 服务键 `'rate-limiter'` 注册（namespace
 * 默认取服务键）。`TypertRemoteService` 基类仅用于其 `typertRemote` 绑定——
 * typertGateway 的 dispatch `validateBinding` 要求活服务上可见该绑定（纯实例
 * 属性，无模块私有状态）。端点经 `ctx.typert.register(...)` 显式注册（见
 * `apply`），而非 `@Remote` SRC 标记。
 *
 * The host-side `rate-limiter` config gateway (`/api/rate-limiter/get` +
 * `/api/rate-limiter/set`). Registered as the cordis service key
 * `'rate-limiter'` (namespace defaults to the service key). The
 * `TypertRemoteService` base is kept ONLY for its `typertRemote` binding — the
 * typertGateway's dispatch `validateBinding` requires the visible binding on
 * the live service (a pure instance property, no module-private state).
 * Endpoints are registered EXPLICITLY through `ctx.typert.register(...)` (see
 * `apply`) instead of the `@Remote` SRC markers.
 */
export class RateLimiterConfigGateway extends TypertRemoteService {
  private readonly bridge: RateLimiterSettingsBridge;
  /** 可选注入子激活后的实时 settings 服务。 */
  private settings: SettingsProvider | undefined;

  /**
   * @param ctx - 拥有上下文（`apply` 内插件 fiber 的 ctx）。
   * @param bridge - 与运行时读取的同一 `RateLimiterSettingsBridge`，使 get/set
   *   始终作用于实时合成配置。
   */
  constructor(ctx: Context, bridge: RateLimiterSettingsBridge) {
    super(ctx, "rate-limiter");
    this.bridge = bridge;
    // settings 服务可选（无 settings → entry 回退）。注入子仅在合成 settings
    // 服务时激活，镜像 installRateLimiterSettings 的条件子；返回的 disposer 镜像
    // 其 detach 路径——settings 服务消失时写通道随之消失，`set` 必须干净失败
    // （KD-G5）而非持有过期服务引用。
    //
    // The settings service is optional (no settings → entry fallback). The
    // inject child activates only when a settings service is composed, mirroring
    // installRateLimiterSettings' conditional child; the returned disposer mirrors
    // its detach path — when the settings service goes away, the write channel
    // is gone with it, and `set` must fail cleanly (KD-G5) instead of holding a
    // stale service reference.
    ctx.inject(["settings"], (sctx) => {
      this.settings = sctx.settings;
      return () => {
        this.settings = undefined;
      };
    });
  }

  /**
   * 读取当前合成配置（schema 默认值 → entry base → settings user layer），经
   * `resolveConfig` 解析。
   *
   * Read the current composed config (schema defaults → entry base → settings
   * user layer) through `resolveConfig`.
   */
  get(): { config: ResolvedConfig } {
    return { config: resolveConfig(this.bridge.source()) };
  }

  /**
   * 校验配置 patch 并写入 settings USER layer（实时——运行时经 bridge `onChange`
   * 重新应用；无需重启）。
   *
   * @param patch - 配置键的任意子集；未知顶层键、rate/burst 越界在写入前被拒绝。
   * @returns 写入后的新合成配置。
   * @throws patch 校验失败，或未合成 settings 服务（KD-G5：写通道不可用）。
   */
  async set(patch: Record<string, unknown>): Promise<{ config: ResolvedConfig }> {
    // 未知顶层键显式拒绝（resolveConfig 会忽略未知键，故在此先拦）。
    // Reject unknown top-level keys explicitly (resolveConfig ignores them).
    for (const key of Object.keys(patch)) {
      if (key !== "enabled" && key !== "providers") {
        throw new Error(`rate-limiter: unknown config key "${key}"`);
      }
    }
    // 用 mergePatch 构造校验视图后 resolveConfig（非法值抛错：rate≤0、burst 非
    // 正整数、providers 非对象）。
    //
    // Build a validation view with mergePatch, then resolveConfig it (invalid
    // values throw: rate≤0, non-positive-integer burst, non-object providers).
    const current = resolveConfig(this.bridge.source());
    const view = mergePatch(patch, current);
    resolveConfig(view);
    // 空 patch 或全 null patch → 直接返回当前配置，不做写入。
    // An empty patch or an all-null patch is a no-op — return the current
    // composed value without a pointless settings round-trip.
    if (Object.keys(patch).length === 0) return { config: current };
    if (!Object.values(patch).some((value) => value !== null)) {
      return { config: current };
    }
    const settings = this.settings;
    if (settings === undefined) {
      throw new Error(
        "rate-limiter: settings service is unavailable — configuration cannot be written",
      );
    }
    await settings.mutate(RATE_LIMITER_SETTINGS_NAMESPACE, buildMutateOps(patch));
    return { config: resolveConfig(this.bridge.source()) };
  }
}

/**
 * `rate-limiter` 网关端点的显式 typert 贡献——经 `ctx.typert.register(...)`
 * 注册（见 `apply`）。描述符精确镜像原 `@Remote` SRC 发现所推导的形状
 * （`src:rate-limiter#<endpoint>` 身份、direct 接收者、`src-json` codec 的 JSON
 * wire 参数），使 host typertGateway 的 claim + dispatch 行为一致——唯一区别是
 * 注册不依赖模块私有的 `remoteMethods` 标记表（本地链接插件无法与 host 安装共享）。
 *
 * The explicit typert contribution for the `rate-limiter` gateway endpoints —
 * registered via `ctx.typert.register(...)` (see `apply`). The descriptors
 * mirror exactly what the former SRC discovery derived from the `@Remote`
 * markers (`src:rate-limiter#<endpoint>` identity shape, direct receiver, JSON
 * wire params with `src-json` codec), so the host typertGateway claim + dispatch
 * behavior is byte-for-byte the same — the only difference is the registration
 * does not depend on the module-private `remoteMethods` marker table, which a
 * locally-linked plugin can never share with the host installation.
 */
export interface RateLimiterTypertContribution {
  package: string;
  face: "host";
  schemas: unknown[];
  model: { services: unknown[]; events: unknown[]; objects: unknown[] };
  invocations: InvocationDescriptor[];
}

export function rateLimiterTypertContribution(): RateLimiterTypertContribution {
  return {
    package: "dsh-rate-limiter",
    face: "host",
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: [
      {
        id: "dsh-rate-limiter#rate-limiter/get",
        service: "rate-limiter",
        namespace: "rate-limiter",
        method: "get",
        invocation: { kind: "direct" },
        parameters: [],
        result: { mode: "src-json" },
      },
      {
        id: "dsh-rate-limiter#rate-limiter/set",
        service: "rate-limiter",
        namespace: "rate-limiter",
        method: "set",
        invocation: { kind: "direct" },
        parameters: [
          { name: "patch", wire: "patch", source: "json", codec: { mode: "src-json" } },
        ],
        result: { mode: "src-json" },
      },
    ],
  };
}
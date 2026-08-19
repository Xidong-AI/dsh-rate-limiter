/**
 * host 侧 `rate-limiter` settings namespace + 实时 source 桥接。
 *
 * 插件行的配置（传给插件 `apply` 的 `entry`）是 `rate-limiter` settings
 * namespace 的合成 BASE：当 dsh settings 服务挂载时，其 user layer 叠加其上
 * （schema 默认值 → base → user layer），运行时通过桥的 `source` thunk 读取
 * 实时合成值——与 dsh 的 `agent-default-model` 相同的 source-thunk 模式。
 * 没有 settings 服务时，条件 `ctx.inject(['settings'], ...)` 子注入不激活，
 * source 恰好就是 entry：行为与今天完全一致。
 *
 * 该 namespace 不加入当前上游 dsh 构建的 apiproxy 配置客户端边界
 * （`exposedNamespaces()` 只并集 model-provider 与产品 namespace，上游没有
 * 注册级 opt-in），因此网页卡片改经 TypertRemoteService 通道读写
 * （`/api/rate-limiter/get` + `/api/rate-limiter/set`，见 gateway.ts）；
 * `set` 背后的进程内 `ctx.settings.mutate` 不携带 exposed-namespace 检查——
 * allowlist 门只存在于 apiproxy wire 层。
 *
 * Host-side `rate-limiter` settings namespace + live source wiring.
 *
 * The plugin-row config (the `entry` passed to the plugin's `apply`) is the
 * composition BASE of the `rate-limiter` settings namespace: when a dsh
 * settings service is mounted, its user layer is layered on top (schema
 * defaults → base → user layer) and the runtime reads the live resolved value
 * through the bridge's `source` thunk — the same source-thunk pattern as dsh's
 * `agent-default-model`. Without a settings service the conditional
 * `ctx.inject(['settings'], ...)` child never activates and the source is
 * exactly the entry: behavior identical to today.
 *
 * The namespace does NOT join the apiproxy configuration-client boundary on
 * current upstream dsh builds (the host's `exposedNamespaces()` unions only
 * model-provider namespaces plus its own product namespaces — there is no
 * registration-level opt-in upstream), so the web card reaches the config
 * through the TypertRemoteService channel instead (`/api/rate-limiter/get` +
 * `/api/rate-limiter/set`, see gateway.ts); the in-process `ctx.settings.mutate`
 * behind `set` carries no exposed-namespace check — the allowlist gate exists
 * only in the apiproxy wire layer.
 *
 * @module dsh-rate-limiter/settings
 */
import type { Context } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { Config } from "./config.js";

/** `rate-limiter` settings namespace（存在 settings 服务时注册）。 */
export const RATE_LIMITER_SETTINGS_NAMESPACE = settingsNamespace("rate-limiter");

/**
 * @deepseek-ai/dsh-settings 的 `isUnloading` 守卫镜像（其
 * `installSettingsSection` 在插件 fiber 卸载/销毁时跳过 source/listener 工作）。
 * 库比较 `ctx.fiber.state` 与 `FiberState.DISPOSED` / `FiberState.UNLOADING`；
 * const enum 在运行时被擦除，故在此镜像数值（4 / 5）。`ctx.fiber` 未在
 * Context 公开类型中声明，故经最小结构访问。
 *
 * Mirror of @deepseek-ai/dsh-settings' `isUnloading` guard (its
 * `installSettingsSection` skips source/listener work while the plugin fiber
 * is unloading or disposed). The library compares `ctx.fiber.state` against
 * `FiberState.DISPOSED` / `FiberState.UNLOADING`; the const enum is erased at
 * runtime, so the vendored numeric values (4 / 5) are mirrored here.
 * `ctx.fiber` is not declared on the public Context type, so it is read
 * through a minimal structural cast.
 */
function isUnloading(ctx: Context): boolean {
  const state = (ctx as { fiber?: { state?: number } }).fiber?.state;
  return state === 4 || state === 5;
}

/**
 * 运行时读取的实时配置源。
 *
 * `source()` 返回 RAW 合成配置（schema 默认值 → 插件行 base → settings user
 * layer）；消费方再经 `resolveConfig` 解析。`onChange` 注册一个回调，在合成值
 * 变化时（attach、提交变更、detach 回 entry）重新应用派生状态，并返回取消订阅
 * 函数（挂在调用方的 `ctx.effect` 上）。
 *
 * The live configuration source for the runtime.
 *
 * `source()` returns the RAW composed config (schema defaults → plugin-row
 * base → settings user layer); consumers pass it through `resolveConfig`.
 * `onChange` registers a callback that re-applies derived state whenever the
 * composed value changes (attach, committed change, or detach back to the
 * entry), and returns a disposer (owned by the caller's `ctx.effect`).
 */
export interface RateLimiterSettingsBridge {
  source(): unknown;
  onChange(callback: () => void): () => void;
}

/**
 * 安装 `rate-limiter` settings namespace 并接线实时 source。
 *
 * 完全镜像 dsh `agent-default-model` 模式（dsh-settings `installSettingsSection`
 * 契约）：注册挂在条件 `ctx.inject(['settings'], ...)` 子注入上，因此没有
 * settings 服务时 source 保持 entry 配置。`source` 在挂载时切换为 settings
 * scope 的实时解析值；`onChange` 在 attach、提交变更、detach 时触发。
 *
 * 多 fiber 去重（qc1 W-5）：host 会合成多个本插件 fiber，每个实例都会执行本
 * 函数——但 `Settings.register` 对重复 namespace 会响亮失败
 * （`settings namespace "rate-limiter" is already registered`）。register 调用
 * 位于条件注入子体内，重复错误在那里异步浮现（外层 try/catch 看不到），故在
 * 子体内包裹 register。被去重的实例记录（debug）并保留 entry-source 回退：其
 * `source` thunk 只会被成功注册的 setSource 钩子替换，因此已注册实例拥有实时
 * namespace。
 *
 * Install the `rate-limiter` settings namespace and wire the live source.
 *
 * Mirrors the dsh `agent-default-model` pattern exactly (the dsh-settings
 * `installSettingsSection` contract): the registration rides a conditional
 * `ctx.inject(['settings'], ...)` child, so with no settings service the
 * source stays the entry config. `source` swaps to the settings scope's
 * resolved value while attached; `onChange` fires at attach, on committed
 * changes, and at detach.
 *
 * Multi-fiber dedupe (qc1 W-5): the host composes several rate-limiter fibers,
 * and this runs on EVERY instance — but `Settings.register` fails loud on a
 * duplicate namespace. The register call runs inside the conditional inject
 * child, so the duplicate error surfaces ASYNCHRONOUSLY there (an outer
 * try/catch cannot see it) — this child body wraps the register instead. A
 * deduped instance logs (debug) and keeps the entry-source fallback: its
 * `source` thunk is only ever swapped by a SUCCESSFUL registration's setSource
 * hook, so the ALREADY-REGISTERED instance owns the live namespace.
 */
export function installRateLimiterSettings(
  ctx: Context,
  entry: unknown,
): RateLimiterSettingsBridge {
  const listeners = new Set<() => void>();
  let source = () => entry;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  ctx.inject(["settings"], (sctx) => {
    let scope: ReturnType<typeof sctx.settings.register> | undefined;
    try {
      scope = sctx.settings.register(RATE_LIMITER_SETTINGS_NAMESPACE, Config, {
        // entry 已由 cordis Loader 按 Config schema 校验，此处作为合成 base
        // 传入（`base` 期望 Partial<schema 输出>，raw entry 经边界强转）。
        //
        // `entry` has already been validated by the cordis Loader against the
        // Config schema; it is passed here as the composition base (`base`
        // expects `Partial<schema output>`, so the raw entry is cast at the
        // boundary).
        base: entry as never,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already registered")) {
        throw error;
      }
      ctx.logger("rate-limiter").debug(
        "settings namespace already registered — entry-source fallback (multi-fiber dedupe)",
      );
      return;
    }
    // 镜像 installSettingsSection：挂载时 source thunk 读取 scope 的实时解析值，
    // detach disposer 在 settings 服务消失时回退到 entry（卸载期间跳过）。
    //
    // Mirrors installSettingsSection: the source thunk reads the scope's live
    // resolved value while attached, and the detach disposer falls back to the
    // entry when the settings service goes away (skipped during unload).
    source = () => scope!.get();
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
    },
  };
}
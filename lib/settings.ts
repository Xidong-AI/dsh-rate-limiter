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
import type { SettingsNamespace } from "@deepseek-ai/dsh-settings";
import { Config } from "./config.js";

/**
 * `rate-limiter` settings namespace（存在 settings 服务时注册）。
 *
 * `0.1.0-rc.8` 及之前版本曾提供顶层 `settingsNamespace(str)` 工厂函数。
 * 自上游 `f4e49ccf8f`（2026-08-29，dsh-settings `0.1.2-rc.1` 起）该工厂被
 * 移除：namespace 改由字符串字面量承载，TS 模板字面量类型
 * `SettingsNamespaceInput<Namespace>` 在 `register` / `get` / `update` 等
 * 编译期校验 kebab-case 命名空间（首字符 `[a-z]`，后续 `[a-z0-9-]*`）。
 * 这里用 `as SettingsNamespace` 标注常量（值仍是 `"rate-limiter"` 字面量），
 * 调用 `register` 时类型上仍命中 branded `SettingsNamespace` 接口；运行时
 * 无开销，编译期如有非法命名空间（如 `"Rate Limiter"`）会直接 `never`。
 *
 * Up to `0.1.0-rc.8`, a top-level `settingsNamespace(str)` factory was
 * provided. Since upstream commit `f4e49ccf8f` (2026-08-29, dsh-settings
 * `0.1.2-rc.1`) the factory has been removed — namespaces are now carried
 * as bare string literals and TS's `SettingsNamespaceInput<Namespace>`
 * template-literal type validates kebab-case namespaces at compile time
 * (first char `[a-z]`, rest `[a-z0-9-]*`) on `register` / `get` / `update`
 * etc. We annotate the constant with `as SettingsNamespace` (value is still
 * the literal `"rate-limiter"`); `register` calls still typecheck against
 * the branded `SettingsNamespace` interface. No runtime overhead; an
 * invalid namespace (e.g. `"Rate Limiter"`) becomes `never` at compile time.
 */
export const RATE_LIMITER_SETTINGS_NAMESPACE: SettingsNamespace =
  "rate-limiter" as SettingsNamespace;

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
// TODO(cordis-upgrade): 升级 `@deepseek-ai/cordis` 时核对 `FiberState` 枚举
// 数值（当前 DISPOSED = 4、UNLOADING = 5 来自 cordis 4.0.1；若上游加新成员
// 或重排顺序，本镜像将静默失效；届时应改用上游导出的命名常量或抽到独立模块）。
//
// TODO(cordis-upgrade): when upgrading `@deepseek-ai/cordis`, re-verify the
// `FiberState` enum values (DISPOSED = 4, UNLOADING = 5 as of cordis 4.0.1;
// if upstream reorders or inserts members, this mirror silently breaks —
// then prefer a named constant exported by cordis or extract to a module).
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
 * 安装 `rate-limiter` settings 并接线实时 source。
 *
 * 该桥对宿主的 settings 服务做**运行时探测**（feature-detect），同时兼容新旧
 * 两代 API，不依赖任何版本字符串：
 *
 *  - **旧 API（<= 0.1.x，`Settings.register` 时代）**：settings 服务提供
 *    `register(ns, Config, { base })` → scope，scope 有 `get()` / `watch()`。
 *    沿用原有 `agent-default-model` source-thunk 模式：注册 namespace，
 *    `source` 读 scope 实时解析值，`watch` 触发 onChange（多 fiber 去重逻辑
 *    保留：register 对重复 namespace 响亮失败，被去重实例回退 entry-source）。
 *
 *  - **新 API（0.2.0-rc.2，`SettingsForms` 时代）**：`register` / `scope.get` /
 *    `scope.watch` 全部移除。namespace 改由 cordis Loader 的 config row 承载
 *    （`entry.options.id === "rate-limiter"`），实时合成值通过
 *    `settings.describe()` 读取（找 `ns === "rate-limiter"` 行的 `.value`），
 *    变更经 `settings/document-updated`（过滤本 namespace）与
 *    `app-boot/config-reload` 事件通知。写路径不变（gateway.ts 的
 *    `settings.mutate` 两代都在）。
 *
 * 两代都无 settings 服务时，条件 `ctx.inject(['settings'], ...)` 子注入不激活，
 * `source` 恰好是 entry：与未装 settings 时行为一致。
 *
 * Install the `rate-limiter` settings and wire the live source.
 *
 * The bridge **feature-detects** the host's settings service to support both
 * API generations without consulting any version string:
 *
 *  - **Old API (<= 0.1.x, the `Settings.register` era)**: the settings service
 *    provides `register(ns, Config, { base })` → scope, and the scope has
 *    `get()` / `watch()`. Reuses the original `agent-default-model`
 *    source-thunk pattern: register the namespace, read the scope's resolved
 *    value from `source`, fire `onChange` from `watch` (multi-fiber dedupe is
 *    preserved: register fails loud on a duplicate namespace and a deduped
 *    instance falls back to the entry-source).
 *
 *  - **New API (0.2.0-rc.2, the `SettingsForms` era)**: `register` /
 *    `scope.get` / `scope.watch` are all gone. The namespace is now carried by
 *    the cordis Loader config row (`entry.options.id === "rate-limiter"`), the
 *    live composed value is read via `settings.describe()` (find the row with
 *    `ns === "rate-limiter"` and take its `.value`), and changes arrive over
 *    the `settings/document-updated` event (filtered to this namespace) plus
 *    `app-boot/config-reload`. The write path is unchanged (`settings.mutate`
 *    in gateway.ts exists on both generations).
 *
 * With no settings service on either generation, the conditional
 * `ctx.inject(['settings'], ...)` child never activates and `source` is exactly
 * the entry: behavior identical to running without settings.
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

  // 最小结构类型：只描述两代 settings 服务真正用到的成员；宿主按自身版本提供
  // 其中一代，`register` 的有无即判别式。
  //
  // Minimal structural types for just the members actually used from either
  // generation of the settings service; the host provides one of the two and
  // the presence of `register` is the discriminator.
  type SettingsDescriptor = {
    ns: string;
    value: unknown;
  };
  type SettingsService = {
    register?: (
      ns: string,
      schema: unknown,
      options?: { base?: unknown },
    ) => { get(): unknown; watch(cb: () => void): unknown };
    describe?: (options?: unknown) => SettingsDescriptor[];
    on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
    effect?: (cb: () => unknown, label?: string) => unknown;
  };

  ctx.inject(["settings"], (sctx) => {
    const settings = (sctx as unknown as { settings?: SettingsService }).settings;
    if (settings === undefined) return;

    // ── 新 API（0.2.0-rc.2）：describe() + 事件驱动 ─────────────────────────
    if (typeof settings.register !== "function") {
      if (typeof settings.describe !== "function") {
        // 既无 register 也无 describe：无法桥接，退回 entry。
        ctx.logger("rate-limiter").debug(
          "settings service exposes neither register nor describe — entry-source fallback",
        );
        return;
      }
      // source 读实时合成值：describe() 找本 namespace 行的 .value；找不到
      // （namespace 尚未由 Loader 建立）时回退 entry。
      source = () => {
        try {
          const rows = settings.describe!() ?? [];
          const row = rows.find((r) => r?.ns === RATE_LIMITER_SETTINGS_NAMESPACE);
          return row === undefined ? entry : row.value;
        } catch {
          return entry;
        }
      };
      const refresh = () => {
        if (isUnloading(ctx)) return;
        notify();
      };
      // 变更事件：settings/document-updated(ns, revision) 过滤本 namespace；
      // app-boot/config-reload 表示配置文档整体重载。两者都重读合成值并通知。
      settings.on?.("settings/document-updated", (...args: unknown[]) => {
        const ns = args[0];
        if (ns !== RATE_LIMITER_SETTINGS_NAMESPACE) return;
        refresh();
      });
      settings.on?.("app-boot/config-reload", refresh);
      // 挂载时先通知一次，让消费方取到实时值。
      notify();
      return;
    }

    // ── 旧 API（<= 0.1.x）：register() + scope.get()/watch() ────────────────
    let scope: { get(): unknown; watch(cb: () => void): unknown } | undefined;
    try {
      scope = settings.register(RATE_LIMITER_SETTINGS_NAMESPACE, Config, {
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
    settings.effect?.(() => () => {
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
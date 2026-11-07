/**
 * host 侧 `rate-limiter` settings namespace + 实时 source 桥接。
 *
 * 插件行的配置（传给插件 `apply` 的 `entry`）是 `rate-limiter` settings
 * namespace 的合成 BASE：settings user layer 叠加其上（schema 默认值 → base →
 * user layer）。读取方式按宿主动态选择：旧 API（有 `register`）经 scope 的
 * `get()` 实时读值；新 API（0.1.7+/0.2）直接读 `entry` 上的 Volatile 引用
 * （由 `resolveConfig` 解包），并监听配置热更新事件。没有 settings 服务时，
 * 条件 `ctx.inject(['settings'], ...)` 子注入不激活，source 恰好就是 entry：
 * 行为与今天完全一致。
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
 * composition BASE of the `rate-limiter` settings namespace: the settings user
 * layer is layered on top (schema defaults → base → user layer). The read path
 * is chosen at runtime: the legacy API (has `register`) reads live values via
 * the scope's `get()`; the new API (0.1.7+/0.2) reads the Volatile references
 * on `entry` directly (unwrapped by `resolveConfig`) and listens for hot-update
 * events. Without a settings service the conditional
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
 * 最小结构化的宿主 settings 服务视图。
 *
 * 两代宿主的服务形状不同：旧 API（0.1.6 及以前）有 `register`；新 API
 * （0.1.7+/0.2）没有 `register`，但保留 `describe`。这里只声明运行时实际
 * 触碰到的成员，避免依赖当前 devDependency（0.1.x）的类型定义。
 *
 * Minimal structural view of the host settings service. The two host
 * generations differ: the legacy API (0.1.6 and earlier) has `register`; the
 * new API (0.1.7+/0.2) has no `register` but keeps `describe`. Only the
 * members actually touched at runtime are declared, so this does not depend on
 * the current devDependency (0.1.x) type definitions.
 */
interface SettingsServiceLike {
  register?: (
    ns: SettingsNamespace,
    schema: unknown,
    options?: { base?: unknown },
  ) => SettingsScopeLike;
  describe?: (options?: unknown) => unknown[];
}

interface SettingsScopeLike {
  get(): unknown;
  watch(callback: () => void): () => void;
}

/** 只需要 `on` 的事件总线视图（事件名不在旧 Context 类型声明里）。 */
interface EventBusLike {
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}

/**
 * 安装 `rate-limiter` settings namespace 并接线实时 source。
 *
 * 运行时特性探测区分两代宿主：
 *
 * - **旧 API**（`settings.register` 是函数）：保持原有注册 + `scope.get()`
 *   实时读值 + `scope.watch` 变更通知；多 fiber 去重逻辑不变。
 * - **新 API**（无 `register`、有 `describe`）：**不**用 `describe()` 找 row
 *   （无 volatile 字段的 schema 会被 `volatileForm()` 静默跳过，读不到该
 *   entry），也**不**依赖 `settings.on` / `settings.effect`。新宿主会把
 *   volatile 字段以引用形式直接传给 `apply` 的 `config`，故 `source` 保持
 *   `entry`（由 `resolveConfig` 逐字段解包 `{ get() }`）；配置热更新改由
 *   Loader 的 `loader/volatile-update` 与 settings 的
 *   `settings/document-updated` 事件通知，二者都挂在插件 fiber 的
 *   `ctx.effect` 上，fiber 卸载时自动解绑。
 *
 * 没有 settings 服务时，条件 `ctx.inject(['settings'], ...)` 子注入不激活，
 * source 恰好就是 entry：行为与今天完全一致。
 *
 * Install the `rate-limiter` settings namespace and wire the live source.
 *
 * Runtime feature detection distinguishes the two host generations:
 *
 * - **Legacy API** (`settings.register` is a function): keep the existing
 *   registration + live `scope.get()` read + `scope.watch` notifications, with
 *   the same multi-fiber dedupe.
 * - **New API** (no `register`, has `describe`): do NOT locate the row through
 *   `describe()` (schemas without volatile fields are silently skipped by
 *   `volatileForm()`, so the entry is unreadable there), and do NOT rely on
 *   `settings.on` / `settings.effect`. The new host passes volatile fields as
 *   references directly on the `config` handed to `apply`, so `source` stays
 *   `entry` (resolved field-by-field by `resolveConfig`); hot updates arrive
 *   through the Loader's `loader/volatile-update` and settings'
 *   `settings/document-updated` events, both bound to the plugin fiber's
 *   `ctx.effect` so they unbind on unload.
 *
 * Without a settings service the conditional `ctx.inject(['settings'], ...)`
 * child never activates and the source is exactly the entry: behavior
 * identical to today.
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
    const settings = sctx.settings as unknown as SettingsServiceLike;
    if (typeof settings.register === "function") {
      let scope: SettingsScopeLike | undefined;
      try {
        scope = settings.register(RATE_LIMITER_SETTINGS_NAMESPACE, Config, {
          // entry 已由 cordis Loader 按 Config schema 校验，此处作为合成 base
          // 传入（`base` 期望 Partial<schema 输出>，raw entry 经边界强转）。
          //
          // `entry` has already been validated by the cordis Loader against the
          // Config schema; it is passed here as the composition base (`base`
          // expects `Partial<schema output>`, so the raw entry is cast at the
          // boundary).
          base: entry,
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
      return;
    }

    if (typeof settings.describe === "function") {
      // 新 API：配置热更新的权威通知是 loader/volatile-update（Loader 在
      // _commitVolatile 时 emit 到 owning fiber）与 settings/document-updated
      // （write() 末尾 describe() 后 emit）。source 保持 entry：其字段是
      // volatile 引用，由 resolveConfig 解包读取实时值。
      //
      // New API: the authoritative hot-update notifications are
      // loader/volatile-update (emitted by the Loader's _commitVolatile to the
      // owning fiber) and settings/document-updated (emitted after write()'s
      // trailing describe()). The source stays the entry: its fields are
      // volatile references, unpacked to live values by resolveConfig.
      const events = ctx as unknown as EventBusLike;
      ctx.effect(() => {
        const offVolatile = events.on("loader/volatile-update", () => {
          if (!isUnloading(ctx)) notify();
        });
        const offDocument = events.on("settings/document-updated", () => {
          if (!isUnloading(ctx)) notify();
        });
        return () => {
          offVolatile();
          offDocument();
        };
      });
      notify();
      return;
    }

    // 服务既无 register 也无 describe：未知宿主形状，保持 entry 回退。
    // Neither register nor describe: unknown host shape, keep the entry fallback.
    ctx.logger("rate-limiter").debug(
      "settings service exposes neither register nor describe — entry-source fallback",
    );
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
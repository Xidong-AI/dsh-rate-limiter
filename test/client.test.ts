import { readFileSync } from "node:fs";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import { describe, expect, it, vi } from "vitest";

/**
 * lib/client.js 是手写的浏览器 bundle（无构建步骤）：顶层向
 * `window.__ModuleLoader__` 注册 CJS 工厂，工厂内的 require 由宿主客户端
 * 模块表回答。这些测试在 Node 里重建该契约：stub 注册口与 require，按宿主
 * 世代提供不同的模块表与数据通道，验证 createSnapshotStore 的解析路径、
 * 插件入口与两代目录/视图通道（connection.api vs remote.*）。
 */
const clientSource = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

interface ClientPluginExports {
  apply: (ctx: unknown) => void;
  inject: string[];
}

interface Registration {
  id: string;
  factory: (require: (spec: string) => unknown) => ClientPluginExports;
}

interface TestController {
  remote: unknown;
  load: () => Promise<void>;
  store: {
    getSnapshot: () => {
      status: string;
      error: string | null;
      writable: boolean;
      configPresent: boolean;
      providers: Array<{ provider: string }>;
    };
  };
}

/** 执行 client bundle，捕获它向 `window.__ModuleLoader__` 注册的工厂。 */
function loadRegistration(): Registration {
  let registration: Registration | undefined;
  const windowStub = {
    __ModuleLoader__: {
      load: (value: Registration) => {
        registration = value;
      },
    },
  };
  // 用 Function 构造注入 window，避免污染测试进程的全局对象。
  const run = new Function("window", clientSource) as (window: unknown) => void;
  run(windowStub);
  if (registration === undefined) throw new Error("client bundle did not register");
  return registration;
}

const reactStub = {
  useSyncExternalStore: () => undefined,
  useState: () => [undefined, () => undefined],
};

function createStoreStub() {
  return {
    update: () => undefined,
    getSnapshot: () => ({}),
    subscribe: () => () => undefined,
  };
}

/** 宿主 require 的最小复刻：按模块表回答，miss 抛与 dsh-client-modules 同形的错误。 */
function createRequire(table: Record<string, unknown>) {
  const calls: string[] = [];
  const require = (spec: string) => {
    calls.push(spec);
    if (Object.hasOwn(table, spec)) return table[spec];
    throw new Error(`client-modules: require("${spec}") missed the module table`);
  };
  return { require, calls };
}

interface CtxStubOptions {
  /** 旧宿主 connection.api（新版为 undefined）。 */
  api?: unknown;
  /** connection.rpc（配置读写通道，两代共用）。 */
  rpc?: unknown;
  /** 新版 remote 服务；提供时条件注入立即激活。 */
  remote?: unknown;
}

/** apply 所需的 ctx stub：只覆盖 client.js 实际触碰的接口。 */
function createCtxStub(options: CtxStubOptions = {}) {
  const registered: unknown[] = [];
  const rpc = options.rpc ?? { call: async () => ({ ok: false, error: { message: "unexpected rpc" } }) };
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => undefined, bind: () => () => "" },
    get: (name: string) => {
      if (name === "connection") return { api: options.api, rpc };
      if (name === "remote") return options.remote;
      return undefined;
    },
    on: () => () => undefined,
    inject: (_deps: string[], cb: (rctx: { remote: unknown }) => unknown) => {
      if (options.remote === undefined) return () => undefined;
      const disposer = cb({ remote: options.remote });
      return typeof disposer === "function" ? disposer : () => undefined;
    },
    slots: {
      inject: (_name: string, fn: () => Generator<unknown, void, unknown>) => {
        const iterator = fn();
        let step = iterator.next();
        while (!step.done) step = iterator.next();
      },
      register: (definition: unknown) => {
        registered.push(definition);
        return () => undefined;
      },
    },
  };
  return { ctx, registered };
}

/** 执行 apply 并从卡片注册定义里取回 controller（定义 inject 返回 { controller, ... }）。 */
function captureController(
  exports: ClientPluginExports,
  stub: { ctx: unknown; registered: unknown[] },
): TestController {
  exports.apply(stub.ctx);
  const definition = stub.registered[0] as { inject: () => { controller: TestController } };
  return definition.inject().controller;
}

const providerRow = {
  provider: "alpha",
  displayName: "Alpha",
  settingsNs: "llm-alpha",
  settingsPath: [] as string[],
};
const namespaceView = { ns: "llm-alpha", value: { apiKeyEnv: "ALPHA_API_KEY" } };
const configRpc = {
  call: async () => ({ ok: true, value: { config: { enabled: true, providers: {} } } }),
};

describe("client bundle 的 createSnapshotStore 解析", () => {
  it("新版宿主：从 dsh-client-store（平台 seed）解析", () => {
    const createSnapshotStoreMock = vi.fn(() => createStoreStub());
    const { require, calls } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-store": { createSnapshotStore: createSnapshotStoreMock },
    });
    const exports = loadRegistration().factory(require);
    expect(exports.inject).toEqual(["slots", "locale", "connection"]);

    const { ctx, registered } = createCtxStub();
    exports.apply(ctx);
    expect(createSnapshotStoreMock).toHaveBeenCalledTimes(1);
    expect(registered).toHaveLength(1);
    expect(calls).toContain("@deepseek-ai/dsh-client-store");
    expect(calls).not.toContain("@deepseek-ai/dsh-client-runtime/client");
  });

  it("旧版宿主：回退到 dsh-client-runtime/client", () => {
    const createSnapshotStoreMock = vi.fn(() => createStoreStub());
    const { require, calls } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-runtime/client": { createSnapshotStore: createSnapshotStoreMock },
    });
    const exports = loadRegistration().factory(require);
    const { ctx, registered } = createCtxStub();
    exports.apply(ctx);
    expect(createSnapshotStoreMock).toHaveBeenCalledTimes(1);
    expect(registered).toHaveLength(1);
    // 先尝试新路径，miss 后回退旧路径。
    const storeIndex = calls.indexOf("@deepseek-ai/dsh-client-store");
    const fallbackIndex = calls.indexOf("@deepseek-ai/dsh-client-runtime/client");
    expect(storeIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThan(storeIndex);
  });

  it("两条路径都缺失：抛出指向新路径的模块表错误", () => {
    const { require } = createRequire({ react: reactStub });
    expect(() => loadRegistration().factory(require)).toThrow(
      /@deepseek-ai\/dsh-client-store/,
    );
  });
});

describe("client bundle 的目录/视图数据通道", () => {
  it("旧版宿主：load 经 connection.api 拉目录与视图", async () => {
    const api = {
      llm: {
        providers: async () => ({
          result: { ok: true, value: { providers: [providerRow] } },
        }),
      },
      settings: {
        describe: async () => ({
          result: { ok: true, value: { writable: true, namespaces: [namespaceView] } },
        }),
      },
    };
    const { require } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-store": { createSnapshotStore },
    });
    const exports = loadRegistration().factory(require);
    const controller = captureController(exports, createCtxStub({ api, rpc: configRpc }));
    await controller.load();
    const state = controller.store.getSnapshot();
    expect(state.status).toBe("ready");
    expect(state.writable).toBe(true);
    expect(state.configPresent).toBe(true);
    expect(state.providers.map((option) => option.provider)).toEqual(["alpha"]);
  });

  it("新版宿主：load 经 remote.llm / remote.settings 拉目录与视图", async () => {
    const remote = {
      $on: () => () => undefined,
      llm: {
        listConfigurableProviders: async () => ({ ok: true, value: [providerRow] }),
      },
      settings: {
        describe: async () => ({
          ok: true,
          value: { writable: true, namespaces: [namespaceView] },
        }),
      },
    };
    const { require } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-store": { createSnapshotStore },
    });
    const exports = loadRegistration().factory(require);
    const controller = captureController(exports, createCtxStub({ rpc: configRpc, remote }));
    await controller.load();
    const state = controller.store.getSnapshot();
    expect(state.status).toBe("ready");
    expect(state.writable).toBe(true);
    expect(state.configPresent).toBe(true);
    expect(state.providers.map((option) => option.provider)).toEqual(["alpha"]);
  });

  it("remote 命名空间晚于首次 load 就绪：重试后成功", async () => {
    const remote = {
      $on: () => () => undefined,
      llm: {
        listConfigurableProviders: async () => ({ ok: true, value: [providerRow] }),
      },
      settings: {
        describe: async () => ({
          ok: true,
          value: { writable: true, namespaces: [namespaceView] },
        }),
      },
    };
    const { require } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-store": { createSnapshotStore },
    });
    const exports = loadRegistration().factory(require);
    // 注入尚未激活：首次 load 记为通道不可用。
    const controller = captureController(exports, createCtxStub({ rpc: configRpc }));
    await controller.load();
    expect(controller.store.getSnapshot().status).toBe("error");
    // 条件注入就绪后（等价于 refreshIfLoaded 的重试路径）恢复。
    controller.remote = remote;
    await controller.load();
    expect(controller.store.getSnapshot().status).toBe("ready");
  });

  it("两代通道都缺失：load 记为通道不可用错误", async () => {
    const { require } = createRequire({
      react: reactStub,
      "@deepseek-ai/dsh-client-store": { createSnapshotStore },
    });
    const exports = loadRegistration().factory(require);
    const controller = captureController(exports, createCtxStub({ rpc: configRpc }));
    await controller.load();
    const state = controller.store.getSnapshot();
    expect(state.status).toBe("error");
    expect(state.error).toContain("channel is unavailable");
  });
});

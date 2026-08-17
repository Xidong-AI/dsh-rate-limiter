# dsh-rate-limiter

DeepSeek Harness（`dsh`）的**主动限速**插件：在模型请求发出**之前**按 provider 控制请求速率（令牌桶），超限时**延迟排队**而不是失败，从而避免触发上游 429。

与官方 `dsh-llm-retry`（失败后指数退避）互补：限速在前（预防），退避在后（兜底），互不干扰。

## 安装

```shell
dsh plugin --profile web add .
```

安装后 `dsh --profile web --dump-config` 应能看到插件行：

```yaml
- id: rate-limiter
  name: dsh-rate-limiter
  config:
    enabled: true
    providers: {}
```

## 配置

在 profile 的 `cordis.patch.yml`（或本插件 `cordis.patch.yml`）中按 provider 配置令牌桶：

```yaml
- id: rate-limiter
  config:
    enabled: true
    providers:
      nvidia:
        rate: 2          # token/秒（长期平均 QPS）
        burst: 5         # 桶容量（允许的突发请求数）
      oc-zen:
        rate: 1
        burst: 3
```

- `rate`：补充速率（token/秒），即长期平均请求速率。
- `burst`：桶容量，允许的突发请求数。
- **未列出的 provider 不限速**，请求原样放行（零侵入）。
- `enabled: false` 可整体关闭插件。

## 工作原理

插件挂在 `agent/request` waterfall 上：先 `await next()` 拿到含 provider 的调用配置，再按 provider 做令牌桶检查，不足则延迟排队（等待期间响应取消信号，用户停止时立即中断），然后原样返回配置——不修改请求内容、不改路由、不吞错误，只控制"何时发出"。

限速算法为手写令牌桶（预约式，并发安全），零第三方限速库依赖。

## 与 dsh-llm-retry 的关系

| 插件 | 时机 | 行为 |
| --- | --- | --- |
| `dsh-rate-limiter` | 请求发出前 | 超限延迟排队（预防 429） |
| `dsh-llm-retry` | 请求失败后 | 指数退避重试（兜底） |

两者挂载点不同（`agent/request` vs `agent/request-error`），天然共存。

## 卸载

```shell
dsh plugin --profile web remove dsh-rate-limiter
```

## 开发

```shell
npm install
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # esbuild 转译 lib/*.ts → lib/*.js
```
// dsh-rate-limiter browser half: the 设置 > 插件 > 插件配置 card that edits
// the `rate-limiter` settings section owned by the host half. Self-contained
// by hand (no bundler in this repo): the client module system wraps it in a
// CJS factory and the kernel adopts { apply, inject } as a client plugin.
//
// 机制：在 rc.7 的 keyed slot `settings.plugin.item` 上注册本卡（key 等于
// settings namespace `rate-limiter`），卡片通过 `ctx.locale` 双语字典渲染，
// store 语义仿 dsh-advisor（load 并行拉 provider 目录与 settings namespace，
// 再从 connection 的 /api RPC 通道读写 host 侧配置，patch diff 只发变化键）。
// 运行时 value-import 仅限 react / dsh-client-schema-form(getPath) /
// dsh-client-runtime/client(createSnapshotStore)；其它 @deepseek-ai/* 均为
// 注释提及（客户端运行时 externals 表限制）。
window.__ModuleLoader__.load({
  id: '@xidong-ai/dsh-rate-limiter',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const { useSyncExternalStore, useState } = React
    // getPath 用于判断某个 provider 是否已配置（settings namespace 命中）。
    const { getPath } = require('@deepseek-ai/dsh-client-schema-form')
    // snapshot store（immer draft 语义）；仅这一个运行时依赖可选项。
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-runtime/client')

    // ── locale dictionaries (follow the app's language setting) ─────────────
    // 文案风格参照 config.ts 的 i18n 注释（"速率（token/秒）" / "突发容量"）。
    const NS = 'settings.rate-limiter'
    const zh = {
      title: '限速器',
      intro: '按 provider 配置令牌桶限速：补充速率（token/秒）与突发容量，请求不足令牌时延迟排队而非失败。',
      collapse: '收起设置',
      expand: '展开设置',
      unsaved: '未保存',
      saved: '限速器设置已保存。',
      readOnly: '当前设置提供方只读。',
      loadFailed: '加载限速器设置失败',
      retry: '重试',
      enabled: '启用限速',
      provider: '添加 provider',
      providerPlaceholder: '选择 provider',
      addProvider: '添加',
      noProviders: '没有已配置的 provider。请先在 Models 页面配置。',
      remove: '移除',
      rate: '速率（token/秒）',
      burst: '突发容量',
      rateHint: '补充速率，即长期平均 QPS；需为 >0 的有限数值。',
      burstHint: '桶容量，允许的突发请求数；需为 ≥1 的整数。',
      addHint: '从已配置的 provider 中选择一个尚未限速的键加入下方列表；初始速率 1、突发容量 5，可自行修改。',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      saveFailed: '保存失败：',
      invalidRate: '速率必须为 >0 的有限数值。',
      invalidBurst: '突发容量必须为 ≥1 的整数。',
      namespaceUnavailable:
        '限速配置通道暂不可用——本宿主上的设置网关尚未就绪。请通过插件配置行配置限速器' +
        '——在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 中写 `- id: rate-limiter`，其 `config:` 映射设置 ' +
        '`enabled`/`providers`（例如 `config: { enabled: true, providers: { … } }`）。网关可用后，web 设置表单将在下次加载时重新显示。',
    }
    const en = {
      title: 'Rate Limiter',
      intro: 'Configure per-provider token-bucket limiting: a refill rate (tokens/second) and burst capacity. Requests lacking tokens queue with a delay instead of failing.',
      collapse: 'Hide settings',
      expand: 'Show settings',
      unsaved: 'Unsaved',
      saved: 'Rate limiter settings saved.',
      readOnly: 'The active settings provider is read-only.',
      loadFailed: 'Loading rate limiter settings failed',
      retry: 'Retry',
      enabled: 'Enable rate limiting',
      provider: 'Add provider',
      providerPlaceholder: 'Select a provider',
      addProvider: 'Add',
      noProviders: 'No configured providers. Configure one on the Models page first.',
      remove: 'Remove',
      rate: 'Rate (token/s)',
      burst: 'Burst capacity',
      rateHint: 'Refill rate, i.e. the long-term average QPS; must be a finite number > 0.',
      burstHint: 'Bucket capacity, the number of burst requests allowed; must be an integer ≥ 1.',
      addHint: 'Pick one configured provider that is not rate-limited yet to add it to the list below. New rows start at rate 1 / burst 5 and can be edited.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      saveFailed: 'Save failed: ',
      invalidRate: 'Rate must be a finite number > 0.',
      invalidBurst: 'Burst must be an integer ≥ 1.',
      namespaceUnavailable:
        'The rate-limiter configuration channel is not available yet — the settings gateway is not ready on this host. ' +
        'Configure the rate limiter via the plugin config row — write `- id: rate-limiter` in ' +
        '`$DSH_HOME/profiles/<name>/cordis.patch.yml` and set `enabled`/`providers` in its `config:` map ' +
        '(e.g. `config: { enabled: true, providers: { … } }`). The web settings form becomes available again on the next load once the gateway is reachable.',
    }

    // ── store helpers ───────────────────────────────────────────────────────
    /** 一个 provider 的默认限速参数（添加时友好默认，可再改）。 */
    function defaultBucket() {
      return { rate: 1, burst: 5 }
    }
    /** 空态 draft。 */
    function defaultDraft() {
      return { enabled: true, providers: {} }
    }
    /** 把 host 侧 get 返回的 config 归一化为 draft 形状（数值字段缺省为合法默认）。 */
    function draftOfConfig(config) {
      const providers = {}
      const raw = config && typeof config === 'object' ? config.providers : undefined
      if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw)) {
          if (!value || typeof value !== 'object') continue
          const rate = value.rate
          const burst = value.burst
          providers[key] = {
            rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : 1,
            burst: typeof burst === 'number' && Number.isInteger(burst) && burst >= 1 ? burst : 5,
          }
        }
      }
      return { enabled: config && typeof config === 'object' ? config.enabled === true : true, providers }
    }
    /** provider 桶值是否合法（rate>0 有限数，burst≥1 整数）。 */
    function isValidBucket(bucket) {
      if (!bucket || typeof bucket !== 'object') return false
      return (
        typeof bucket.rate === 'number' &&
        Number.isFinite(bucket.rate) &&
        bucket.rate > 0 &&
        typeof bucket.burst === 'number' &&
        Number.isInteger(bucket.burst) &&
        bucket.burst >= 1
      )
    }
    /** 返回第一条校验失败文案对应的 i18n key（无则 undefined）。 */
    function validationErrorKey(draft) {
      for (const [key, bucket] of Object.entries(draft.providers)) {
        void key
        if (!bucket || typeof bucket !== 'object') return 'invalidRate'
        if (typeof bucket.rate !== 'number' || !Number.isFinite(bucket.rate) || bucket.rate <= 0) return 'invalidRate'
        if (typeof bucket.burst !== 'number' || !Number.isInteger(bucket.burst) || bucket.burst < 1) return 'invalidBurst'
      }
      return undefined
    }
    /** provider 键的 diff 对比（按契约用 JSON.stringify 比较 {rate,burst}）。 */
    function bucketEqual(left, right) {
      if (!left || !right) return left === right
      return JSON.stringify({ rate: left.rate, burst: left.burst }) === JSON.stringify({ rate: right.rate, burst: right.burst })
    }
    function settingsSaveErrorMessage(error) {
      return error && error.message ? error.message : String(error)
    }

    /**
     * 简化版 dsh-advisor store：从 connection 的 /api RPC 通道读写 host 侧
     * `rate-limiter` namespace。load() 并行拉 provider 目录与 settings
     * namespace（用于判定已配置 provider），再读配置；get 失败不硬错误，
     * 而是 configPresent=false（卡片降级显示通道不可用提示）。
     */
    class RateLimiterSettingsStore {
      constructor(api, rpc) {
        this.api = api
        this.rpc = rpc
        this.store = createSnapshotStore({
          status: 'idle',
          error: null,
          writable: false,
          providers: [],
          configPresent: false,
          pendingProvider: '',
          seed: defaultDraft(),
          draft: defaultDraft(),
          dirty: false,
          applyState: { kind: 'idle' },
        })
        /** 最新 load 胜出；旧响应不回写更新的。 */
        this.generation = 0
        /** draft 只在首次 load 成功时 seed；刷新不覆盖编辑中内容。 */
        this.draftSeeded = false
        /** 最近一次 get/apply 后的 host 配置（patch diff 基线）。 */
        this.seed = defaultDraft()
      }

      async load() {
        const generation = ++this.generation
        this.store.update((s) => {
          s.status = 'loading'
          s.error = null
        })
        let providers
        let writable
        let views
        try {
          const [providersResponse, settingsResponse] = await Promise.all([
            this.api.llm.providers({}),
            this.api.settings.describe({}),
          ])
          if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
          if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message)
          providers = providersResponse.result.value.providers
          writable = settingsResponse.result.value.writable
          views = settingsResponse.result.value.namespaces
        } catch (error) {
          if (generation !== this.generation) return
          this.store.update((s) => {
            s.status = 'error'
            s.error = error instanceof Error ? error.message : String(error)
          })
          return
        }
        if (generation !== this.generation) return
        // get 失败不是页面错误：卡片显示配置通道不可用提示（降级），目录仍可用。
        let config
        try {
          const getResult = await this.rpc.call('/api', 'rate-limiter/get', { args: {} })
          if (getResult.ok) config = getResult.value.config
        } catch {
          // degraded：config 保持 undefined
        }
        if (generation !== this.generation) return
        const namespaces = Object.fromEntries((views || []).map((view) => [view.ns, view]))
        const options = []
        for (const entry of Array.isArray(providers) ? providers : []) {
          const namespace = namespaces[entry.settingsNs]
          const configured =
            namespace !== undefined &&
            (entry.settingsPath === undefined ||
              entry.settingsPath.length === 0 ||
              getPath(namespace.value, entry.settingsPath) !== undefined)
          if (!configured) continue
          options.push({
            provider: entry.provider,
            displayName: entry.displayName,
            settingsNs: entry.settingsNs,
            settingsPath: entry.settingsPath,
          })
        }
        this.seed = draftOfConfig(config)
        if (!this.draftSeeded && config !== undefined) {
          this.store.update((s) => {
            s.draft = this.seed
            s.draftSeeded = true
          })
          this.draftSeeded = true
        }
        this.store.update((s) => {
          s.status = 'ready'
          s.error = null
          s.writable = writable === true
          s.providers = options
          s.configPresent = config !== undefined
          if (config !== undefined) s.dirty = this.recomputeDirty(s.draft)
        })
      }

      setEnabled(enabled) {
        this.store.update((s) => {
          s.draft = { ...s.draft, enabled: enabled === true }
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      setProvider(provider) {
        this.store.update((s) => {
          s.pendingProvider = provider
        })
      }

      addProvider(provider) {
        const state = this.store.getSnapshot()
        const key = (provider ?? state.pendingProvider ?? '').trim()
        if (!key) return
        if (Object.prototype.hasOwnProperty.call(state.draft.providers, key)) return
        if (!state.providers.some((option) => option.provider === key)) return
        this.store.update((s) => {
          s.pendingProvider = ''
          s.draft = {
            ...s.draft,
            providers: { ...s.draft.providers, [key]: defaultBucket() },
          }
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      removeProvider(provider) {
        this.store.update((s) => {
          if (!Object.prototype.hasOwnProperty.call(s.draft.providers, provider)) return
          const providers = { ...s.draft.providers }
          delete providers[provider]
          s.draft = { ...s.draft, providers }
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      setRate(provider, rate) {
        this.store.update((s) => {
          if (!Object.prototype.hasOwnProperty.call(s.draft.providers, provider)) return
          const bucket = s.draft.providers[provider]
          s.draft.providers[provider] = { ...bucket, rate: rate === undefined ? undefined : Number(rate) }
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      setBurst(provider, burst) {
        this.store.update((s) => {
          if (!Object.prototype.hasOwnProperty.call(s.draft.providers, provider)) return
          const bucket = s.draft.providers[provider]
          s.draft.providers[provider] = { ...bucket, burst: burst === undefined ? undefined : Number(burst) }
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      discard() {
        this.store.update((s) => {
          s.draft = this.seed
          s.applyState = { kind: 'idle' }
          s.dirty = this.recomputeDirty(s.draft)
        })
      }

      /**
       * 最小 patch：仅发送与 seed 不同的顶层键。enabled 变则发；providers
       * 逐键 diff：新增/修改发 {rate,burst}，被删除的键发 null。空 patch 直接
       * 报 saved 不发调用。
       */
      patchFor(draft) {
        const patch = {}
        if (JSON.stringify(this.seed.enabled) !== JSON.stringify(draft.enabled)) {
          patch.enabled = draft.enabled === true
        }
        const keys = new Set([
          ...Object.keys(this.seed.providers),
          ...Object.keys(draft.providers),
        ])
        const providersPatch = {}
        for (const key of keys) {
          const seedBucket = this.seed.providers[key]
          const draftBucket = draft.providers[key]
          if (draftBucket === undefined) {
            // 被删除的键 → 显式 null 删除。
            if (seedBucket !== undefined) providersPatch[key] = null
            continue
          }
          if (seedBucket !== undefined && bucketEqual(seedBucket, draftBucket)) continue
          // 新增或修改：仅当校验合法才写入（非法留给客户端校验提示）。
          if (isValidBucket(draftBucket)) {
            providersPatch[key] = { rate: draftBucket.rate, burst: draftBucket.burst }
          }
        }
        if (Object.keys(providersPatch).length > 0) patch.providers = providersPatch
        return patch
      }

      recomputeDirty(draft) {
        return Object.keys(this.patchFor(draft)).length > 0
      }

      async apply() {
        const state = this.store.getSnapshot()
        if (!state.writable) {
          this.store.update((s) => {
            s.applyState = { kind: 'error', message: 'rate-limiter: settings service is read-only — configuration cannot be written' }
          })
          return
        }
        const invalidKey = validationErrorKey(state.draft)
        if (invalidKey !== undefined) {
          this.store.update((s) => {
            s.applyState = { kind: 'error', validation: invalidKey }
          })
          return
        }
        const patch = this.patchFor(state.draft)
        if (Object.keys(patch).length === 0) {
          this.store.update((s) => {
            s.applyState = { kind: 'saved' }
            s.dirty = this.recomputeDirty(s.draft)
          })
          return
        }
        this.store.update((s) => {
          s.applyState = { kind: 'saving' }
        })
        try {
          const result = await this.rpc.call('/api', 'rate-limiter/set', { args: { patch } })
          if (!result.ok) {
            this.store.update((s) => {
              s.applyState = { kind: 'error', message: result.error ? result.error.message : 'rate-limiter/set failed' }
            })
            return
          }
          this.seed = draftOfConfig(result.value && result.value.config)
          this.store.update((s) => {
            s.applyState = { kind: 'saved' }
            s.dirty = this.recomputeDirty(s.draft)
          })
          await this.load()
        } catch (error) {
          this.store.update((s) => {
            s.applyState = { kind: 'error', message: settingsSaveErrorMessage(error) }
          })
        }
      }
    }

    function refreshIfLoaded(controller) {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }

    // ── card styles (inline + CSS variables, 仿 advisor 卡片的简洁风格) ──────
    const S = {
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-3)',
        borderRadius: 12,
        listStyle: 'none',
        transition: 'border-color .16s, background .16s',
      },
      cardOpen: {
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderColor: 'var(--dsw-alias-label-dimmed)',
        borderRadius: 12,
        listStyle: 'none',
        transition: 'border-color .16s, background .16s',
      },
      header: {
        appearance: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left',
        cursor: 'pointer', background: 'transparent', border: 0, borderRadius: 12,
        alignItems: 'center', gap: 12, padding: '14px 16px', display: 'flex',
      },
      headText: { flexDirection: 'column', flex: 1, gap: 4, minWidth: 0, display: 'flex' },
      name: { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
      description: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 },
      chevron: { color: 'var(--dsw-alias-label-tertiary)', flex: 'none', transition: 'transform .16s' },
      body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 },
      readOnly: { color: 'var(--dsw-alias-label-tertiary)', margin: '12px 0 0', fontSize: 12, lineHeight: 1.5 },
      pending: {
        whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-secondary)', borderRadius: 999, flex: 'none',
        padding: '1px 8px', fontSize: 11, fontWeight: 500, lineHeight: 17,
      },
      footer: {
        borderTop: '1px solid var(--dsw-alias-border-l2)', justifyContent: 'flex-end',
        alignItems: 'center', gap: 8, padding: '12px 0 4px', display: 'flex',
      },
      failed: { minWidth: 0, color: 'var(--dsw-alias-label-error)', flex: 1, margin: 0, fontSize: 12, lineHeight: 1.5 },
      error: { color: 'var(--dsw-alias-label-error)', margin: '12px 0 0', fontSize: 12, lineHeight: 1.5 },
      notice: { color: 'var(--dsw-alias-label-secondary)', margin: '12px 0 0', fontSize: 12, lineHeight: 1.5 },
      savedNotice: { color: 'var(--dsw-alias-label-secondary)', margin: '12px 0 0', fontSize: 12, lineHeight: 1.5 },
      discard: {
        appearance: 'none', font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)', background: 'transparent', borderRadius: 8,
        padding: '5px 14px', fontSize: 13, lineHeight: 1.5,
      },
      save: {
        appearance: 'none', font: 'inherit', cursor: 'pointer', border: '1px solid transparent',
        color: 'var(--dsw-alias-label-inverse, #fff)', background: 'var(--dsw-alias-brand-primary)',
        borderRadius: 8, padding: '5px 14px', fontSize: 13, lineHeight: 1.5,
      },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 4px' },
      checkLabel: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: 1.5 },
      checkbox: { accentColor: 'var(--dsw-alias-brand-primary)' },
      fieldset: { border: 0, margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
      field: { display: 'flex', flexDirection: 'column', gap: 4 },
      fieldLabel: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: 1.5 },
      hint: { color: 'var(--dsw-alias-label-tertiary)', margin: 0, fontSize: 12, lineHeight: 1.5 },
      warnHint: { color: 'var(--dsw-alias-label-warning, #b7791f)', margin: 0, fontSize: 12, lineHeight: 1.5 },
      input: {
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '5px 10px',
        fontSize: 13, lineHeight: 1.5, minWidth: 0,
      },
      addRow: { display: 'flex', alignItems: 'flex-end', gap: 8 },
      addButton: {
        appearance: 'none', font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)', background: 'transparent', borderRadius: 8,
        padding: '5px 14px', fontSize: 13, lineHeight: 1.5, flex: 'none',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
      rowName: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, flex: '1 1 30%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowInput: {
        color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '4px 8px',
        fontSize: 12, lineHeight: 1.4, flex: '1 1 0', minWidth: 0,
      },
      removeButton: {
        appearance: 'none', font: 'inherit', cursor: 'pointer', border: 0,
        color: 'var(--dsw-alias-label-error)', background: 'transparent', borderRadius: 6,
        padding: '4px 8px', fontSize: 12, flex: 'none',
      },
      list: { display: 'flex', flexDirection: 'column', gap: 2, margin: '8px 0' },
    }

    // ── card component (React.createElement, 无 JSX) ─────────────────────────
    function RateLimiterCard(props) {
      const { controller, useSnapshot, t } = props
      const state = useSnapshot((snapshot) => snapshot)
      const [userOpen, setUserOpen] = useState(false)
      if (state.status === 'idle') void controller.load()
      const degraded = state.status === 'ready' && !state.configPresent
      const open = userOpen || state.status === 'error' || degraded
      const title = t('title')
      const header = React.createElement(
        'button',
        {
          type: 'button',
          style: S.header,
          'aria-expanded': open,
          'aria-label': `${t(open ? 'collapse' : 'expand')}: ${title}`,
          onClick: () => {
            if (!degraded && state.status !== 'error') setUserOpen(!userOpen)
          },
        },
        React.createElement(
          'span',
          { style: S.headText },
          React.createElement('span', { style: S.name }, title),
          React.createElement('span', { style: S.description }, t('intro')),
        ),
        state.dirty
          ? React.createElement('span', { style: S.pending }, t('unsaved'))
          : null,
        React.createElement('span', { style: S.chevron }, open ? '▴' : '▾'),
      )

      let body
      if (state.status === 'error') {
        body = React.createElement(
          'div',
          { style: S.body },
          state.applyState.kind === 'saved'
            ? React.createElement('p', { style: S.savedNotice, role: 'status' }, t('saved'))
            : null,
          React.createElement('p', { style: S.error }, `${t('loadFailed')}: ${state.error ?? ''}`),
          React.createElement(
            'div',
            { style: S.footer },
            React.createElement(
              'button',
              { type: 'button', style: S.discard, onClick: () => { void controller.load() } },
              t('retry'),
            ),
          ),
        )
      } else if (degraded) {
        body = React.createElement(
          'div',
          { style: S.body },
          state.applyState.kind === 'saved'
            ? React.createElement('p', { style: S.savedNotice, role: 'status' }, t('saved'))
            : null,
          React.createElement('p', { style: S.notice, role: 'status' }, t('namespaceUnavailable')),
          React.createElement(
            'div',
            { style: S.footer },
            React.createElement(
              'button',
              { type: 'button', style: S.discard, onClick: () => { void controller.load() } },
              t('retry'),
            ),
          ),
        )
      } else if (state.status === 'ready') {
        const { draft, providers, writable, applyState } = state
        const saving = applyState.kind === 'saving'
        const busy = !writable || saving
        // 本地校验错误（apply 前拦截）用 validation key 表示，独立显示；
        // 后端写错误用 message 文本，显示在 footer。
        const invalidKey = validationErrorKey(draft)
        const invalidMessage = invalidKey !== undefined ? t(invalidKey) : undefined
        const writeError =
          applyState.kind === 'error' && applyState.validation === undefined
            ? applyState.message
            : undefined
        const saveDisabled = !state.dirty || saving || !writable || invalidKey !== undefined
        const discardDisabled = !state.dirty || saving
        const availableProviders = providers.filter(
          (option) => !Object.prototype.hasOwnProperty.call(draft.providers, option.provider),
        )
        const canAdd = state.pendingProvider && availableProviders.some((o) => o.provider === state.pendingProvider)

        body = React.createElement(
          'div',
          { style: S.body },
          !writable
            ? React.createElement('p', { style: S.readOnly, role: 'status' }, t('readOnly'))
            : null,
          applyState.kind === 'saved'
            ? React.createElement('p', { style: S.savedNotice, role: 'status' }, t('saved'))
            : null,
          React.createElement(
            'div',
            { style: S.checkboxRow },
            React.createElement('label', { htmlFor: 'rate-limiter-enabled', style: S.checkLabel }, t('enabled')),
            React.createElement('input', {
              id: 'rate-limiter-enabled',
              type: 'checkbox',
              style: S.checkbox,
              checked: draft.enabled,
              disabled: busy,
              onChange: (event) => controller.setEnabled(event.target.checked),
            }),
          ),
          React.createElement(
            'fieldset',
            { style: S.fieldset, disabled: !writable },
            React.createElement('div', { style: S.addRow },
              React.createElement('select', {
                style: { ...S.input, flex: '1 1 auto', minWidth: 0 },
                value: state.pendingProvider || '',
                disabled: busy,
                'aria-label': t('provider'),
                onChange: (event) => controller.setProvider(event.target.value),
              },
                React.createElement('option', { value: '' }, t('providerPlaceholder')),
                availableProviders.map((option) =>
                  React.createElement('option', { value: option.provider, key: option.provider }, option.displayName),
                ),
              ),
              React.createElement(
                'button',
                { type: 'button', style: S.addButton, disabled: busy || !canAdd, onClick: () => controller.addProvider() },
                t('addProvider'),
              ),
            ),
            providers.length === 0
              ? React.createElement('p', { style: S.hint }, t('noProviders'))
              : React.createElement('p', { style: S.hint }, t('addHint')),
            React.createElement(
              'div',
              { style: S.list },
              Object.entries(draft.providers).map(([key, bucket]) =>
                React.createElement(
                  'div',
                  { style: S.row, key },
                  React.createElement('span', { style: S.rowName, title: key }, key),
                  React.createElement('input', {
                    type: 'number',
                    style: S.rowInput,
                    min: 0.001,
                    step: 'any',
                    'aria-label': t('rate'),
                    title: t('rateHint'),
                    placeholder: t('rate'),
                    value: bucket.rate === undefined ? '' : String(bucket.rate),
                    disabled: busy,
                    onChange: (event) => controller.setRate(key, event.target.value === '' ? undefined : Number(event.target.value)),
                  }),
                  React.createElement('input', {
                    type: 'number',
                    style: S.rowInput,
                    min: 1,
                    step: 1,
                    'aria-label': t('burst'),
                    title: t('burstHint'),
                    placeholder: t('burst'),
                    value: bucket.burst === undefined ? '' : String(bucket.burst),
                    disabled: busy,
                    onChange: (event) => controller.setBurst(key, event.target.value === '' ? undefined : Number(event.target.value)),
                  }),
                  React.createElement(
                    'button',
                    { type: 'button', style: S.removeButton, disabled: busy, onClick: () => controller.removeProvider(key) },
                    t('remove'),
                  ),
                ),
              ),
            ),
            invalidMessage
              ? React.createElement('p', { style: S.warnHint, role: 'status' }, invalidMessage)
              : null,
          ),
          React.createElement(
            'div',
            { style: S.footer },
            writeError === undefined
              ? null
              : React.createElement('p', { style: S.failed, role: 'status' }, `${t('saveFailed')}${writeError}`),
            React.createElement(
              'button',
              { type: 'button', style: S.discard, disabled: discardDisabled, onClick: () => controller.discard() },
              t('discard'),
            ),
            React.createElement(
              'button',
              { type: 'button', style: S.save, disabled: saveDisabled, onClick: () => { void controller.apply() } },
              t(saving ? 'saving' : 'save'),
            ),
          ),
        )
      } else {
        body = React.createElement('div', { style: S.body })
      }

      return React.createElement(
        'li',
        { style: open ? S.cardOpen : S.card },
        header,
        open ? body : null,
      )
    }

    // ── plugin entry ─────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rate-limiter: card locale')
      const t = ctx.locale.bind(NS)
      const connection = ctx.get('connection')
      const controller = new RateLimiterSettingsStore(connection.api, connection.rpc)
      // 订阅 connection 复位与远端设置更新，加载后刷新目录/配置。
      const useSnapshot = (selector) =>
        useSyncExternalStore(
          (callback) => controller.store.subscribe(callback),
          () => selector(controller.store.getSnapshot()),
        )
      ctx.effect(() => {
        let pending = false
        const refresh = () => {
          if (pending) return
          pending = true
          queueMicrotask(() => {
            pending = false
            refreshIfLoaded(controller)
          })
        }
        const disposers = [ctx.on('connection/reset', refresh)]
        const remote = ctx.get('remote')
        if (remote) {
          disposers.push(remote.$on('settings/document-updated', refresh))
          disposers.push(remote.$on('llm/adapters-updated', refresh))
        }
        return () => {
          for (const dispose of disposers) dispose()
        }
      }, 'rate-limiter: pushed invalidations')

      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({
          name: 'settings.plugin.item',
          // rc.7 keyed slot: key = settings namespace（本卡编辑的 namespace）。
          key: 'rate-limiter',
          locale: NS,
          inject: () => ({ controller, useSnapshot, t }),
        }, RateLimiterCard)
      })
    }

    module.exports = { apply, inject: ['slots', 'locale', 'connection'] }
    return module.exports
  },
})

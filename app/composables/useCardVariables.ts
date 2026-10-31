/**
 * useCardVariables — 卡券变量配置共享状态:
 * 变量配置弹窗 (VariableConfigModal) 与可用变量列表 (VarHints) 共用同一份缓存,
 * 弹窗内任何 CRUD/启停变更后调用 reload() 同步全部挂载点。
 */
export interface CardVariable {
  id: number
  var_key: string
  label: string
  category: string
  description: string | null
  sample_value: string | null
  builtin: number
  enabled: number
  sort: number
}

export const VAR_CATEGORY_META: Record<string, { label: string; desc: string }> = {
  item: { label: '商品数据', desc: '发货订单对应商品的实时数据 (带商品ID)' },
  account: { label: '闲鱼账号数据', desc: '发货账号与买卖双方数据' },
  code: { label: '卡密数据', desc: '本次发货的卡密/卡券/订单数据' },
  api: { label: 'API 数据', desc: 'API 型卡券的鉴权密钥与提取结果' },
  custom: { label: '自定义数据', desc: '自定义固定值变量, 发货时按配置值替换' },
}

export function useCardVariables() {
  const vars = useState<CardVariable[]>('card-variables', () => [])
  const loaded = useState('card-variables-loaded', () => false)

  async function reload(): Promise<void> {
    try {
      const data = await useApi().get<CardVariable[]>('/api/card-variables')
      vars.value = Array.isArray(data) ? data : []
      loaded.value = true
    } catch {}
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await reload()
  }

  /** 启用变量 → VarHints 可用变量列表条目 (保存后启用的变量才会出现) */
  const enabledList = computed(() =>
    vars.value
      .filter((v) => Number(v.enabled) === 1)
      .map((v) => ({ token: `{${v.var_key}}`, label: `${v.label}${v.description ? ' · ' + v.description : ''}` })),
  )

  return { vars, loaded, reload, ensureLoaded, enabledList }
}

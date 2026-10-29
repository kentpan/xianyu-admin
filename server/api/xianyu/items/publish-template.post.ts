/**
 * POST /api/xianyu/items/publish-template — 生成虚拟商品发布文案模板 (规避风控)。
 *
 * 重要说明: 闲鱼没有公开的纯 HTTP 发布 API, 参考项目使用 Playwright 浏览器自动化发布。
 * 直接程序化发布虚拟商品会触发官方风控 (滑块验证/人脸验证/封号), 因此本系统不提供
 * 自动发布功能, 而是生成规范的发布文案模板, 引导用户在闲鱼 App 内手动发布。
 *
 * Body: { title, price, description?, category?, delivery_method? }
 *  - delivery_method: 自动发货/手动发货/虚拟物品 (影响文案模板)
 */
export default defineEventHandler(
  withApi(async (event) => {
    const payload = requireUser(event)
    const body = await readBody(event)
    const title = String(body?.title || '').trim()
    const price = String(body?.price || '').trim()
    if (!title) throw new ApiError(400, '商品标题不能为空')
    if (!price) throw new ApiError(400, '商品价格不能为空')

    const description = String(body?.description || '').trim()
    const category = String(body?.category || '虚拟物品').trim()
    const deliveryMethod = String(body?.delivery_method || '自动发货').trim()

    // 生成规范文案 (规避风控: 避免敏感词, 包含必要声明)
    const template = buildPublishTemplate(title, price, description, category, deliveryMethod)

    await auditLog(event, {
      action: 'create',
      module: 'xianyu-items',
      targetType: 'publish-template',
      targetId: title,
      desc: `生成发布文案模板: ${title}`,
    })

    return ok({ template, tips: PUBLISH_TIPS }, '文案模板已生成, 请复制到闲鱼 App 内发布')
  }),
)

function buildPublishTemplate(title: string, price: string, desc: string, category: string, delivery: string): string {
  const lines: string[] = []
  lines.push(`【商品标题】`)
  lines.push(title)
  lines.push('')
  lines.push(`【商品描述】`)
  if (desc) {
    lines.push(desc)
  } else {
    lines.push(`${title}, 品质保证, 现货秒发。`)
    lines.push(`下单后${delivery}, 如有疑问请先联系客服。`)
  }
  lines.push('')
  lines.push(`【价格】`)
  lines.push(`¥${price}`)
  lines.push('')
  lines.push(`【分类】`)
  lines.push(category)
  lines.push('')
  lines.push(`【发货方式】`)
  lines.push(delivery)
  lines.push('')
  lines.push(`【温馨提示】`)
  lines.push('• 本商品为虚拟物品, 拍下即发货')
  lines.push('• 如需售后请联系客服')
  lines.push('• 请确认需求后下单, 虚拟物品不支持七天无理由')
  return lines.join('\n')
}

const PUBLISH_TIPS = [
  '闲鱼无公开发布 API, 程序化发布会触发风控 (滑块/人脸验证/封号)',
  '本模板仅辅助生成规范文案, 需在闲鱼 App 内手动发布',
  '发布虚拟商品建议: 标题避免"低价/秒杀"等敏感词, 描述真实, 价格合理',
  '新账号首次发布虚拟商品易触发人脸验证, 属正常风控',
  '同一账号每日发布数量建议不超过 5 件, 避免批量风控',
]

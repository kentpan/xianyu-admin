/**
 * 商品类型分类 (v2.3.0) — 全平台热门商品趋势用。
 *
 * 闲鱼站内搜索接口 (mtop.taobao.idlemtopsearch.pc.search) 只有关键词参数, 无类目
 * 过滤字段; 趋势页需要「虚拟商品 / 实体商品」口径 (默认虚拟商品, 与卖虚拟服务的
 * 运营视角一致), 因此按商品标题特征词做轻量分类, 在搜索快照入库时落 item_type 列。
 *
 * 纯标题启发式: 命中任一虚拟特征词 → virtual, 否则 → physical。分类误差只影响
 * 趋势聚合的口径, 不涉及任何交易/资损链路。
 */

/** 虚拟商品特征词 (小写匹配, 覆盖 闲鱼常见虚拟品类: 软件/会员/充值/教程/代做/账号/游戏币 等)
 *  ⚠️ 高歧义词不收录: 序列号/激活/定制/安装/咨询/服务/人工/申请/技术/流量/授权 + tg 单字 (实体描述/型号/交易话术高频复用) */
const VIRTUAL_MARKERS: string[] = [
  'tg api',
  'tgapi',
  'tg号',
  'tg群',
  'api',
  '激活码',
  '充值',
  '代充',
  '会员',
  'cdk',
  'cdkey',
  '卡密',
  '兑换码',
  '密钥',
  '软件',
  '源码',
  '代码',
  '教程',
  '课程',
  '网课',
  '录播',
  '模板',
  '素材',
  '电子书',
  'pdf',
  '文档',
  '资料',
  '题库',
  '脚本',
  '插件',
  '字体',
  '代做',
  '代写',
  '代查',
  '代申请',
  '代练',
  '陪玩',
  '远程',
  '开发',
  '账号',
  '租号',
  '破解',
  'VPN',
  '机场',
  '节点',
  '加速器',
  '网盘',
  '夸克',
  '云盘',
  '话费',
  '点卡',
  '游戏币',
  '皮肤',
  '钻石',
  '金币',
  '元宝',
  '点券',
  '礼包',
  '挂机',
  'vip',
  'svip',
]

export type HotItemType = 'virtual' | 'physical'

/** 按标题分类商品类型: 命中虚拟特征词 → virtual, 否则 physical (空标题归 physical) */
export function classifyItemType(title: string): HotItemType {
  const s = String(title || '').toLowerCase()
  if (!s) return 'physical'
  return VIRTUAL_MARKERS.some((m) => s.includes(m.toLowerCase())) ? 'virtual' : 'physical'
}

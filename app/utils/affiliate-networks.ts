/**
 * affiliate-networks.ts — 佣金联盟注册表 (单例数据, 非DB)。
 *
 * 定义国内外主流佣金联盟的:
 *  - 标识 / 显示名 / 图标色 / 区域 (domestic/overseas)
 *  - 申请注册 URL (点击新窗口打开)
 *  - 申请流程详细说明 (步骤化)
 *  - 账号凭据字段配置 (appKey/appSecret/adzone_id/memberId 等, 动态渲染表单)
 *  - 选品 API 配置 (endpoint / 签名方式 / 是否需要服务端中转)
 *
 * 联盟账号密码等凭据存于 DB 表 affiliate_accounts (按 network_id + user_id 隔离)。
 */

/** 联盟凭据字段定义 (动态表单)。 */
export interface NetworkField {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea'
  required: boolean
  placeholder?: string
  help?: string
  /** 字段在选品 API 请求中的作用。 */
  role?: 'auth' | 'tracking' | 'endpoint'
}

/** 申请步骤。 */
export interface RegistrationStep {
  title: string
  detail: string
}

/** 联盟定义。 */
export interface AffiliateNetwork {
  id: string
  name: string
  /** 中文名/别名。 */
  nameCn?: string
  region: 'domestic' | 'overseas'
  /** 图标背景色 (Tailwind class)。 */
  color: string
  /** 官网/申请注册地址 (新窗口打开)。 */
  registerUrl: string
  /** 文档地址 (可选)。 */
  docsUrl?: string
  /** 一句话描述。 */
  description: string
  /** 佣金模式说明。 */
  commissionModel: string
  /** 申请流程详细步骤。 */
  registrationSteps: RegistrationStep[]
  /** 账号凭据字段 (动态表单)。 */
  fields: NetworkField[]
  /** 选品 API 是否支持服务端中转调用 (true=本系统可代为调 API; false=仅存储凭据, 用户手动选品)。 */
  supportsServerSearch: boolean
  /** 选品 API endpoint (若 supportsServerSearch)。 */
  searchEndpoint?: string
  /** 签名方式。 */
  signType?: 'md5' | 'hmac' | 'none'
  /** 是否启用。 */
  enabled: boolean
}

/** 国内外主流佣金联盟注册表。 */
export const AFFILIATE_NETWORKS: AffiliateNetwork[] = [
  // ============ 国内联盟 ============
  {
    id: 'taobao_alliance',
    name: 'Taobao Alliance (阿里妈妈)',
    nameCn: '淘宝联盟',
    region: 'domestic',
    color: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300',
    registerUrl: 'https://pub.alimama.com/',
    docsUrl: 'https://open.taobao.com/api.htm?docId=40&docType=2',
    description: '阿里妈妈旗下淘宝/天猫官方佣金推广平台, 商品池最大, 佣金率 1%-50%',
    commissionModel: 'CPS 按成交佣金 (佣金率基点, 如 1350 = 13.5%)',
    registrationSteps: [
      { title: '注册阿里妈妈账号', detail: '访问 pub.alimama.com, 用淘宝账号登录, 完成实名认证 (个人/企业均可)' },
      { title: '申请媒体备案', detail: '在「我的媒体」添加推广位 (网站/App/社交媒体), 等待审核 (通常 1-3 工作日)' },
      { title: '获取推广位 PID', detail: '审核通过后, 在「推广管理」获取推广位 ID (adzone_id), 这是选品和跟踪佣金的关键' },
      { title: '申请开放平台 AppKey', detail: '访问 open.taobao.com, 创建应用, 获取 AppKey + AppSecret (需企业资质或个人开发者认证)' },
      { title: '配置到本系统', detail: '将 AppKey / AppSecret / Adzone ID 填入下方表单, 即可使用选品广场搜索商品' },
    ],
    fields: [
      { key: 'app_key', label: 'AppKey', type: 'text', required: true, placeholder: '3xxxxxxx', help: '淘宝开放平台应用 AppKey', role: 'auth' },
      { key: 'app_secret', label: 'AppSecret', type: 'password', required: true, placeholder: '••••••••', help: '淘宝开放平台应用 AppSecret (用于签名, 切勿泄露)', role: 'auth' },
      { key: 'adzone_id', label: '推广位 ID (Adzone ID)', type: 'text', required: true, placeholder: '110xxxxxx', help: '阿里妈妈推广位 ID, 用于佣金跟踪', role: 'tracking' },
      { key: 'member_id', label: 'Member ID (可选)', type: 'text', required: false, placeholder: 'mm_xxx_xxx_xxx', help: '阿里妈妈会员 ID, 部分接口需要' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'taobao.tbk.dg.material.optional.upgrade',
    signType: 'md5',
    enabled: true,
  },
  {
    id: 'jd_alliance',
    name: 'JD Alliance (京粉)',
    nameCn: '京东联盟',
    region: 'domestic',
    color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
    registerUrl: 'https://union.jd.com/',
    docsUrl: 'https://union.jd.com/openplatform/api',
    description: '京东官方佣金推广平台, 3C/家电类目优势, 佣金率 0.5%-30%',
    commissionModel: 'CPS 按成交佣金 (佣金率百分比)',
    registrationSteps: [
      { title: '注册京东联盟账号', detail: '访问 union.jd.com, 用京东账号登录, 完实名认证' },
      { title: '申请推广位', detail: '在「推广管理-推广位管理」创建推广位, 获取 unionId 和 webId' },
      { title: '申请 API 权限', detail: '在「API 权限」申请 jd.union.open.goods.query 等选品接口权限 (需推广位审核通过)' },
      { title: '获取 AppKey', detail: '在京麦开放平台 (jd.com) 创建应用, 获取 AppKey + AppSecret' },
      { title: '配置到本系统', detail: '填入 AppKey / AppSecret / UnionId / WebId' },
    ],
    fields: [
      { key: 'app_key', label: 'AppKey', type: 'text', required: true, placeholder: 'JD AppKey', role: 'auth' },
      { key: 'app_secret', label: 'AppSecret', type: 'password', required: true, placeholder: '••••••••', role: 'auth' },
      { key: 'union_id', label: 'Union ID', type: 'text', required: true, placeholder: '100xxxxxx', help: '京东联盟成员 ID', role: 'tracking' },
      { key: 'web_id', label: 'Web ID (推广位)', type: 'text', required: true, placeholder: '200xxxxxx', help: '京东联盟推广位 ID', role: 'tracking' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'jd.union.open.goods.query',
    signType: 'md5',
    enabled: true,
  },
  {
    id: 'pdd_alliance',
    name: 'PDD DuoKe (多多客)',
    nameCn: '拼多多多多客',
    region: 'domestic',
    color: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
    registerUrl: 'https://jinbao.pinduoduo.com/',
    docsUrl: 'https://open.pinduoduo.com/',
    description: '拼多多官方佣金推广平台, 低价商品转化率高, 佣金率 1%-50%',
    commissionModel: 'CPS 按成交佣金 + 红包奖励',
    registrationSteps: [
      { title: '注册多多客账号', detail: '访问 jinbao.pinduoduo.com, 用拼多多账号登录' },
      { title: '申请推广位', detail: '在「推广管理」创建推广位, 获取 pid' },
      { title: '申请开放平台', detail: '访问 open.pinduoduo.com, 创建应用获取 client_id + client_secret' },
      { title: '配置到本系统', detail: '填入 Client ID / Client Secret / PID' },
    ],
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, placeholder: 'PDD Client ID', role: 'auth' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, placeholder: '••••••••', role: 'auth' },
      { key: 'pid', label: '推广位 PID', type: 'text', required: true, placeholder: 'xxxxxx_xxxx', help: '拼多多多多客推广位 ID', role: 'tracking' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'pdd.ddk.goods.search',
    signType: 'md5',
    enabled: true,
  },
  {
    id: 'douyin_alliance',
    name: 'Douyin E-commerce (抖客)',
    nameCn: '抖音电商抖客',
    region: 'domestic',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200',
    registerUrl: 'https://buyin.jinritemai.com/',
    docsUrl: 'https://developer.open-douyin.com/',
    description: '抖音电商官方推广平台, 短视频/直播带货, 佣金率 1%-40%',
    commissionModel: 'CPS 按成交佣金',
    registrationSteps: [
      { title: '注册抖客账号', detail: '访问 buyin.jinritemai.com, 用抖音账号登录, 完成实名认证' },
      { title: '申请抖客身份', detail: '在「抖客推广」申请成为抖客, 需有一定粉丝基础' },
      { title: '创建推广位', detail: '获取 external_id 用于佣金跟踪' },
      { title: '申请开放平台', detail: '访问 developer.open-douyin.com, 创建应用获取 app_id + app_secret' },
      { title: '配置到本系统', detail: '填入 App ID / App Secret / External ID' },
    ],
    fields: [
      { key: 'app_id', label: 'App ID', type: 'text', required: true, placeholder: '抖音开放平台 App ID', role: 'auth' },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true, placeholder: '••••••••', role: 'auth' },
      { key: 'external_id', label: 'External ID (推广位)', type: 'text', required: true, placeholder: '推广位 ID', role: 'tracking' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'product.search',
    signType: 'hmac',
    enabled: true,
  },
  {
    id: 'vip_alliance',
    name: 'Vipshop V-Alliance',
    nameCn: '唯品会V联盟',
    region: 'domestic',
    color: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-300',
    registerUrl: 'https://vpub.vip.com/',
    description: '唯品会官方佣金推广平台, 品牌特卖类目, 佣金率 3%-15%',
    commissionModel: 'CPS 按成交佣金',
    registrationSteps: [
      { title: '注册V联盟账号', detail: '访问 vpub.vip.com, 用唯品会账号登录' },
      { title: '申请媒体备案', detail: '添加推广媒体, 等待审核' },
      { title: '获取推广位', detail: '获取 source_id 用于佣金跟踪' },
      { title: '申请 API', detail: '联系V联盟商务申请 API 权限' },
      { title: '配置到本系统', detail: '填入 App Key / Secret / Source ID' },
    ],
    fields: [
      { key: 'app_key', label: 'App Key', type: 'text', required: true, role: 'auth' },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true, role: 'auth' },
      { key: 'source_id', label: 'Source ID (推广位)', type: 'text', required: true, role: 'tracking' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'suning_alliance',
    name: 'Suning Alliance',
    nameCn: '苏宁联盟',
    region: 'domestic',
    color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    registerUrl: 'https://fanxian.suning.com/',
    description: '苏宁易购官方佣金推广平台, 家电/3C 类目, 佣金率 1%-10%',
    commissionModel: 'CPS 按成交佣金',
    registrationSteps: [
      { title: '注册苏宁联盟账号', detail: '访问 fanxian.suning.com, 用苏宁账号登录' },
      { title: '申请推广位', detail: '创建推广位获取 track_id' },
      { title: '配置到本系统', detail: '填入 Track ID (凭据较少, 主要用 Cookie 方式)' },
    ],
    fields: [
      { key: 'track_id', label: 'Track ID', type: 'text', required: true, role: 'tracking' },
      { key: 'cookie', label: 'Cookie (可选)', type: 'textarea', required: false, help: '苏宁联盟后台 Cookie, 用于选品搜索' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'mogujie_alliance',
    name: 'Mogujie Alliance',
    nameCn: '蘑菇街联盟',
    region: 'domestic',
    color: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
    registerUrl: 'https://ued.mogujie.com/',
    description: '蘑菇街官方佣金推广平台, 女装/美妆类目, 佣金率 5%-20%',
    commissionModel: 'CPS 按成交佣金',
    registrationSteps: [
      { title: '注册蘑菇街联盟', detail: '访问 ued.mogujie.com 登录注册' },
      { title: '申请推广位', detail: '获取推广位 ID' },
      { title: '配置到本系统', detail: '填入 App Key / 推广位 ID' },
    ],
    fields: [
      { key: 'app_key', label: 'App Key', type: 'text', required: true, role: 'auth' },
      { key: 'adzone_id', label: '推广位 ID', type: 'text', required: true, role: 'tracking' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },

  // ============ 海外联盟 ============
  {
    id: 'amazon_associates',
    name: 'Amazon Associates',
    nameCn: '亚马逊联盟',
    region: 'overseas',
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    registerUrl: 'https://affiliate-program.amazon.com/',
    docsUrl: 'https://webservices.amazon.com/paapi5/documentation/',
    description: 'Amazon 官方联盟, 全球最大电商联盟, 佣金率 1%-10% (类目不同)',
    commissionModel: 'CPS 按成交佣金 (类目差异化佣金率)',
    registrationSteps: [
      { title: '注册 Amazon Associates', detail: '访问 affiliate-program.amazon.com, 用 Amazon 账号注册 (需有网站/App/社交媒体)' },
      { title: '填写网站信息', detail: '提交你的推广渠道 URL, 描述推广方式' },
      { title: '获取 Associate Tag', detail: '审核通过后获取 Associate Tag (如 yourtag-20), 这是佣金跟踪标识' },
      { title: '申请 Product Advertising API', detail: '在「Account Settings」申请 PA-API 5.0 权限 (需在 180 天内有 3 笔 qualifying sale 才能保留)' },
      { title: '获取 API 凭据', detail: '申请通过后获取 Access Key + Secret Key' },
      { title: '配置到本系统', detail: '填入 Access Key / Secret Key / Associate Tag / 选择站点 (com/co.uk/de 等)' },
    ],
    fields: [
      { key: 'access_key', label: 'Access Key ID', type: 'text', required: true, placeholder: 'AKIAxxxxx', role: 'auth' },
      { key: 'secret_key', label: 'Secret Access Key', type: 'password', required: true, placeholder: '••••••••', role: 'auth' },
      { key: 'associate_tag', label: 'Associate Tag', type: 'text', required: true, placeholder: 'yourtag-20', help: '亚马逊联盟跟踪标识', role: 'tracking' },
      { key: 'host', label: 'API Host', type: 'text', required: true, placeholder: 'webservices.amazon.com', help: '站点: com/co.uk/de/fr/it/es/co.jp' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'SearchItems',
    signType: 'hmac',
    enabled: true,
  },
  {
    id: 'ebay_partner',
    name: 'eBay Partner Network',
    nameCn: 'eBay 联盟',
    region: 'overseas',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
    registerUrl: 'https://partnernetwork.ebay.com/',
    docsUrl: 'https://developer.ebay.com/api-docs/buy/browse/overview.html',
    description: 'eBay 官方联盟, 全球二手/新品拍卖, 佣金率 1%-4%',
    commissionModel: 'CPS 按成交佣金 (按类目)',
    registrationSteps: [
      { title: '注册 eBay Partner Network', detail: '访问 partnernetwork.ebay.com 注册 (需有推广渠道)' },
      { title: '审核通过', detail: 'eBay 审核 1-3 工作日, 通过后获取 Campaign ID' },
      { title: '申请 eBay Developer', detail: '访问 developer.ebay.com, 创建应用获取 Client ID + Client Secret' },
      { title: '配置到本系统', detail: '填入 Client ID / Client Secret / Campaign ID' },
    ],
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, role: 'auth' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, role: 'auth' },
      { key: 'campaign_id', label: 'Campaign ID', type: 'text', required: true, role: 'tracking' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'buy.browse.search',
    signType: 'none',
    enabled: true,
  },
  {
    id: 'shareasale',
    name: 'ShareASale',
    nameCn: 'ShareASale 联盟',
    region: 'overseas',
    color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    registerUrl: 'https://www.shareasale.com/affiliate-signup.cfm',
    docsUrl: 'https://developers.shareasale.com/',
    description: '美国主流联盟营销平台, 4000+ 商家, 佣金率因商家而异 (5%-50%)',
    commissionModel: 'CPS/CPA/CPC 混合 (按商家)',
    registrationSteps: [
      { title: '注册 ShareASale 账号', detail: '访问 shareasale.com/affiliate-signup.cfm, 填写网站信息 (需有英文网站)' },
      { title: '审核通过', detail: 'ShareASale 审核 1-2 工作日' },
      { title: '申请商家', detail: '在平台内搜索商家并单独申请 (每个商家需单独审核)' },
      { title: '获取 Affiliate ID + API Token', detail: '在「Account Settings」获取 Affiliate ID + API Token' },
      { title: '配置到本系统', detail: '填入 Affiliate ID / API Token / Secret Token' },
    ],
    fields: [
      { key: 'affiliate_id', label: 'Affiliate ID', type: 'text', required: true, role: 'tracking' },
      { key: 'api_token', label: 'API Token', type: 'password', required: true, role: 'auth' },
      { key: 'secret_token', label: 'Secret Token', type: 'password', required: true, help: '用于 API 签名', role: 'auth' },
    ],
    supportsServerSearch: true,
    searchEndpoint: 'shareasale.com/wshare.cfm',
    signType: 'hmac',
    enabled: true,
  },
  {
    id: 'cj_affiliate',
    name: 'CJ Affiliate (Commission Junction)',
    nameCn: 'CJ 联盟',
    region: 'overseas',
    color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300',
    registerUrl: 'https://www.cj.com/signup',
    description: '全球顶级联盟营销平台, 500+ 知名品牌, 佣金率因广告主而异',
    commissionModel: 'CPS/CPA/ CPL 混合',
    registrationSteps: [
      { title: '注册 CJ 账号', detail: '访问 cj.com/signup, 填写网站/推广渠道信息 (英文)' },
      { title: '审核通过', detail: 'CJ 审核 3-5 工作日, 需有高质量英文网站' },
      { title: '申请广告主', detail: '在「Find Advertisers」搜索并申请 (每个广告主单独审核)' },
      { title: '获取 PID + Website ID', detail: '在账户信息中获取 PID (Publisher ID) 和 Website ID' },
      { title: '申请 API 权限', detail: '联系 CJ 商务申请 API access, 获取 access_token' },
      { title: '配置到本系统', detail: '填入 PID / Website ID / Access Token' },
    ],
    fields: [
      { key: 'pid', label: 'Publisher ID (PID)', type: 'text', required: true, role: 'tracking' },
      { key: 'website_id', label: 'Website ID', type: 'text', required: true, role: 'tracking' },
      { key: 'access_token', label: 'API Access Token', type: 'password', required: true, role: 'auth' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'rakuten_advertising',
    name: 'Rakuten Advertising',
    nameCn: 'Rakuten 乐天联盟',
    region: 'overseas',
    color: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
    registerUrl: 'https://affiliate.rakuten.com/signup',
    description: '乐天广告联盟, 1000+ 品牌, 佣金率因广告主而异',
    commissionModel: 'CPS/CPA 混合',
    registrationSteps: [
      { title: '注册 Rakuten Affiliate', detail: '访问 affiliate.rakuten.com/signup, 填写网站信息' },
      { title: '审核通过', detail: 'Rakuten 审核 3-7 工作日' },
      { title: '申请广告主', detail: '在「Programs」搜索并申请广告主' },
      { title: '获取 Affiliate ID', detail: '在账户信息获取 Affiliate ID' },
      { title: '配置到本系统', detail: '填入 Affiliate ID (API 需联系商务开通)' },
    ],
    fields: [
      { key: 'affiliate_id', label: 'Affiliate ID', type: 'text', required: true, role: 'tracking' },
      { key: 'api_token', label: 'API Token (可选)', type: 'password', required: false, role: 'auth' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'impact',
    name: 'Impact',
    nameCn: 'Impact 联盟',
    region: 'overseas',
    color: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300',
    registerUrl: 'https://app.impact.com/secure/loginV2.ihtml',
    description: '新一代联盟营销平台, 技术驱动, 500+ 品牌',
    commissionModel: 'CPS/CPA/CPL 混合',
    registrationSteps: [
      { title: '注册 Impact 账号', detail: '访问 app.impact.com, 注册为 Partner (媒体方)' },
      { title: '完善档案', detail: '填写推广渠道信息, 提交审核' },
      { title: '申请品牌', detail: '在「Marketplace」搜索并申请品牌合作' },
      { title: '获取 API 凭据', detail: '在「Settings - API」获取 Account SID + Auth Token' },
      { title: '配置到本系统', detail: '填入 Account SID / Auth Token / Sub ID' },
    ],
    fields: [
      { key: 'account_sid', label: 'Account SID', type: 'text', required: true, role: 'auth' },
      { key: 'auth_token', label: 'Auth Token', type: 'password', required: true, role: 'auth' },
      { key: 'sub_id', label: 'Sub ID (推广位)', type: 'text', required: false, role: 'tracking' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'awin',
    name: 'Awin',
    nameCn: 'Awin 联盟',
    region: 'overseas',
    color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300',
    registerUrl: 'https://www.awin.com/gb/publisher-signup',
    description: '欧洲最大联盟营销平台, 15000+ 广告主, 全球覆盖',
    commissionModel: 'CPS/CPA 混合',
    registrationSteps: [
      { title: '注册 Awin Publisher', detail: '访问 awin.com/publisher-signup, 填写网站信息 (需英文, 审核 5-10 工作日)' },
      { title: '缴纳审核费', detail: 'Awin 收取 $1 审核费 (通过后退还为余额)' },
      { title: '审核通过', detail: '技术团队审核网站质量' },
      { title: '申请广告主', detail: '在「Advertiser Directory」申请广告主' },
      { title: '获取 Affiliate ID', detail: '在账户信息获取 Affiliate ID' },
      { title: '配置到本系统', detail: '填入 Affiliate ID' },
    ],
    fields: [
      { key: 'affiliate_id', label: 'Affiliate ID', type: 'text', required: true, role: 'tracking' },
      { key: 'api_token', label: 'API Token (可选)', type: 'password', required: false, role: 'auth' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
  {
    id: 'skimlinks',
    name: 'Skimlinks',
    nameCn: 'Skimlinks 联盟',
    region: 'overseas',
    color: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300',
    registerUrl: 'https://skimlinks.com/signup',
    description: '自动联盟营销平台, 40000+ 商家, 内容变现首选',
    commissionModel: 'CPS 按成交佣金 (平台抽成 25%)',
    registrationSteps: [
      { title: '注册 Skimlinks', detail: '访问 skimlinks.com/signup, 填写网站信息 (需有内容流量)' },
      { title: '审核通过', detail: 'Skimlinks 审核 2-3 工作日' },
      { title: '获取 Publisher ID', detail: '在账户信息获取 Publisher ID + API Key' },
      { title: '配置到本系统', detail: '填入 Publisher ID / API Key' },
    ],
    fields: [
      { key: 'publisher_id', label: 'Publisher ID', type: 'text', required: true, role: 'tracking' },
      { key: 'api_key', label: 'API Key', type: 'password', required: true, role: 'auth' },
    ],
    supportsServerSearch: false,
    enabled: true,
  },
]

/** 按 id 获取联盟。 */
export function getNetworkById(id: string): AffiliateNetwork | undefined {
  return AFFILIATE_NETWORKS.find((n) => n.id === id)
}

/** 列出所有启用的联盟 (按区域分组)。 */
export function listEnabledNetworks(): { domestic: AffiliateNetwork[]; overseas: AffiliateNetwork[] } {
  const enabled = AFFILIATE_NETWORKS.filter((n) => n.enabled)
  return {
    domestic: enabled.filter((n) => n.region === 'domestic'),
    overseas: enabled.filter((n) => n.region === 'overseas'),
  }
}

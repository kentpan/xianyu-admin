/**
 * affiliate/search.ts — 各联盟选品搜索实现 (服务端中转)。
 *
 * 支持: 淘宝联盟 / 京东联盟 / 拼多多多多客 / Amazon Associates / eBay Partner Network / ShareASale
 * 抖音抖客需 access_token 授权流程, 暂返回提示。
 * 不支持服务端搜索的联盟 (supportsServerSearch=false) 不会进入这里。
 */
import crypto from 'node:crypto'
import type { AffiliateNetwork } from '../affiliate-networks'

export interface SearchParams {
  keyword: string
  page: number
  page_size: number
  sort: string
  min_price?: number
  max_price?: number
  has_coupon?: boolean
}

export interface SearchResultItem {
  item_id: string
  title: string
  price: string
  commission_rate: string
  commission_amount: string
  pic_url: string
  item_url: string
  shop_name: string
  category: string
  sales: string
  coupon?: { amount: string; start_fee?: string; url?: string }
  raw?: any
}

export interface SearchResult {
  items: SearchResultItem[]
  total: number
}

export async function searchProducts(
  net: AffiliateNetwork,
  creds: Record<string, string>,
  params: SearchParams,
): Promise<SearchResult> {
  switch (net.id) {
    case 'taobao_alliance':
      return searchTaobao(creds, params)
    case 'jd_alliance':
      return searchJD(creds, params)
    case 'pdd_alliance':
      return searchPdd(creds, params)
    case 'douyin_alliance':
      throw new Error('抖音选品需先获取 access_token, 请前往抖音开放平台授权后使用')
    case 'amazon_associates':
      return searchAmazon(creds, params)
    case 'ebay_partner':
      return searchEbay(creds, params)
    case 'shareasale':
      return searchShareasale(creds, params)
    default:
      return { items: [], total: 0 }
  }
}

async function searchTaobao(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const appKey = creds.app_key
  const appSecret = creds.app_secret
  const adzoneId = creds.adzone_id
  if (!appKey || !appSecret || !adzoneId) throw new Error('淘宝联盟凭据不完整 (需 app_key/app_secret/adzone_id)')

  const t = String(Date.now())
  const biz: Record<string, any> = {
    adzone_id: Number(adzoneId),
    keyword: p.keyword,
    page_no: p.page,
    page_size: p.page_size,
    sort: p.sort === 'price_asc' ? 'price_asc' : p.sort === 'price_desc' ? 'price_desc' : p.sort === 'commission' ? 'commission' : 'default',
    has_coupon: p.has_coupon ? 'true' : 'false',
  }
  // 淘宝 TOP 签名: md5(secret + 排序后的参数kv + secret) 大写
  const signParts: string[] = [appSecret]
  for (const k of Object.keys(biz).sort()) signParts.push(k, String(biz[k]))
  signParts.push('app_key', appKey, 'method', 'taobao.tbk.dg.material.optional.upgrade', 'sign_method', 'md5', 'v', '1.0', 't', t)
  signParts.push(appSecret)
  const sign = crypto.createHash('md5').update(signParts.join('')).digest('hex').toUpperCase()

  const body = new URLSearchParams({
    method: 'taobao.tbk.dg.material.optional.upgrade',
    app_key: appKey,
    sign,
    sign_method: 'md5',
    t,
    v: '1.0',
    format: 'json',
    adzone_id: String(biz.adzone_id),
    keyword: p.keyword,
    page_no: String(p.page),
    page_size: String(p.page_size),
    sort: biz.sort,
    has_coupon: biz.has_coupon,
  }).toString()

  const res = await fetch('https://eco.taobao.com/router/rest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  const resp = json?.tbk_dg_material_optional_upgrade_response
  if (json?.error_response) throw new Error(json.error_response.sub_msg || json.error_response.msg || '淘宝 API 错误')
  const list = resp?.result_list?.map_data || []
  return {
    items: list.map((it: any): SearchResultItem => ({
      item_id: String(it.item_id || it.num_iid || ''),
      title: it.title || '',
      price: String(it.zk_final_price || it.price || ''),
      commission_rate: String(it.commission_rate || ''),
      commission_amount: String(it.commission || ''),
      pic_url: it.pict_url || it.pic_url || '',
      item_url: it.click_url || it.url || '',
      shop_name: it.shop_title || '',
      category: String(it.category || ''),
      sales: String(it.volume || ''),
      coupon: it.coupon_amount ? { amount: String(it.coupon_amount), start_fee: String(it.coupon_start_fee || '') } : undefined,
      raw: it,
    })),
    total: resp?.total_results || list.length,
  }
}

async function searchJD(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const appKey = creds.app_key
  const appSecret = creds.app_secret
  const unionId = creds.union_id
  const webId = creds.web_id
  if (!appKey || !appSecret || !unionId || !webId) throw new Error('京东联盟凭据不完整 (需 app_key/app_secret/union_id/web_id)')

  const t = String(Date.now())
  const biz = {
    keyword: p.keyword,
    pageIndex: p.page,
    pageSize: p.page_size,
    unionId: Number(unionId),
    webId: Number(webId),
    sortName: p.sort === 'price_asc' ? 'price' : p.sort === 'commission' ? 'commission' : 'inOrderCount30Days',
    sortDesc: p.sort !== 'price_asc',
  }
  const paramJson = JSON.stringify(biz)
  const signStr = `${appSecret}360buy_param_json${paramJson}app_key${appKey}methodjd.union.open.goods.querytimestamp${t}v1.0${appSecret}`
  const sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase()

  const body = new URLSearchParams({
    '360buy_param_json': paramJson,
    app_key: appKey,
    method: 'jd.union.open.goods.query',
    timestamp: t,
    v: '1.0',
    sign,
  }).toString()

  const res = await fetch('https://api.jd.com/routerjson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  const inner = json?.jd_union_open_goods_query_responce?.result
  let parsed: any = {}
  try { parsed = JSON.parse(inner || '{}') } catch {}
  const list = parsed?.data || []
  return {
    items: list.map((it: any): SearchResultItem => ({
      item_id: String(it.skuId || ''),
      title: it.skuName || '',
      price: String(it.priceInfo?.price || ''),
      commission_rate: String(it.commissionInfo?.commissionShare || '') + '%',
      commission_amount: String(it.commissionInfo?.commission || ''),
      pic_url: it.imgUrl || '',
      item_url: it.materialUrl || '',
      shop_name: it.shopInfo?.shopName || '',
      category: it.categoryInfo?.cname3 || '',
      sales: String(it.inOrderCount30Days || ''),
      raw: it,
    })),
    total: list.length,
  }
}

async function searchPdd(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const clientId = creds.client_id
  const clientSecret = creds.client_secret
  const pid = creds.pid
  if (!clientId || !clientSecret || !pid) throw new Error('拼多多凭据不完整 (需 client_id/client_secret/pid)')

  const t = String(Math.floor(Date.now() / 1000))
  const biz = {
    keyword: p.keyword,
    page: p.page,
    page_size: p.page_size,
    pid,
    sort: p.sort === 'price_asc' ? 1 : p.sort === 'commission' ? 6 : 0,
  }
  const paramJson = JSON.stringify(biz)
  const sign = crypto.createHash('md5').update(clientSecret + paramJson + t + clientSecret).digest('hex').toUpperCase()

  const res = await fetch('https://gw-api.pinduoduo.com/api/router', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'pdd.ddk.goods.search',
      client_id: clientId,
      timestamp: t,
      sign,
      data: paramJson,
    }),
  })
  const json = await res.json()
  const list = json?.goods_search_response?.goods_list || []
  return {
    items: list.map((it: any): SearchResultItem => ({
      item_id: String(it.goods_sign || it.goods_id || ''),
      title: it.goods_name || '',
      price: String(it.min_group_price || ''),
      commission_rate: String(it.commission_rate || '') + '%',
      commission_amount: String(it.min_normal_price ? (Number(it.min_normal_price) - Number(it.min_group_price)).toFixed(2) : ''),
      pic_url: it.goods_thumbnail_url || '',
      item_url: it.goods_sign ? `https://mobile.yangkeduo.com/goods.html?goods_sign=${it.goods_sign}` : '',
      shop_name: it.mall_name || '',
      category: String(it.opt_name || ''),
      sales: String(it.sales_tip || ''),
      coupon: it.coupon_discount ? { amount: String(it.coupon_discount / 100) } : undefined,
      raw: it,
    })),
    total: json?.goods_search_response?.total_count || list.length,
  }
}

async function searchAmazon(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const accessKey = creds.access_key
  const secretKey = creds.secret_key
  const tag = creds.associate_tag
  const host = creds.host || 'webservices.amazon.com'
  const region = host.includes('.co.uk') || host.includes('.de') || host.includes('.fr') || host.includes('.it') || host.includes('.es') ? 'eu-west-1' : host.includes('.co.jp') ? 'us-west-2' : 'us-east-1'
  if (!accessKey || !secretKey || !tag) throw new Error('Amazon 凭据不完整 (需 access_key/secret_key/associate_tag)')

  const payload = JSON.stringify({
    Keywords: p.keyword,
    ItemCount: p.page_size,
    ItemPage: p.page,
    Resources: ['Images.Primary.Medium', 'ItemInfo.Title', 'Offers.Listings.Price'],
    PartnerTag: tag,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.com',
  })
  const t = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const canonicalQ = `Marketplace=www.amazon.com&PartnerTag=${encodeURIComponent(tag)}&PartnerType=Associates`
  const canonical = `POST\n${host}\n/paapi5/searchitems\n${canonicalQ}\n${hashHex(payload)}`
  const stringToSign = `AWS4-HMAC-SHA256\n${t}\n${t.slice(0, 8)}/${region}/ProductAdvertisingAPI/aws4_request\n${hashHex(canonical)}`
  const kDate = hmac('AWS4' + secretKey, t.slice(0, 8))
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 'ProductAdvertisingAPI')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKey}/${t.slice(0, 8)}/${region}/ProductAdvertisingAPI/aws4_request, SignedHeaders=content-encoding;host;x-amz-date, Signature=${signature}`

  const res = await fetch(`https://${host}/paapi5/searchitems?Marketplace=www.amazon.com&PartnerTag=${encodeURIComponent(tag)}&PartnerType=Associates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Encoding': 'amz-1.0',
      'Host': host,
      'X-Amz-Date': t,
      'Authorization': auth,
    },
    body: payload,
  })
  const json = await res.json()
  if (json?.Errors) throw new Error(json.Errors[0]?.Message || 'Amazon PA-API 错误')
  const list = json?.SearchResult?.Items || []
  return {
    items: list.map((it: any): SearchResultItem => ({
      item_id: String(it.ASIN || ''),
      title: it.ItemInfo?.Title?.DisplayValue || '',
      price: String(it.Offers?.Listings?.[0]?.Price?.Amount || ''),
      commission_rate: '4%',
      commission_amount: String(Number(it.Offers?.Listings?.[0]?.Price?.Amount || 0) * 0.04),
      pic_url: it.Images?.Primary?.Medium?.URL || '',
      item_url: it.DetailPageURL || '',
      shop_name: 'Amazon',
      category: String(it.ItemInfo?.Classifications?.Binding?.DisplayValue || ''),
      sales: '',
      raw: it,
    })),
    total: json?.SearchResult?.TotalResultCount || list.length,
  }
}

async function searchEbay(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const clientId = creds.client_id
  const clientSecret = creds.client_secret
  if (!clientId || !clientSecret) throw new Error('eBay 凭据不完整 (需 client_id/client_secret)')

  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })
  const tokenJson = await tokenRes.json()
  const accessToken = tokenJson?.access_token
  if (!accessToken) throw new Error('eBay OAuth token 获取失败, 请检查凭据')

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(p.keyword)}&limit=${p.page_size}&offset=${(p.page - 1) * p.page_size}`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  })
  const json = await res.json()
  const list = json?.itemSummaries || []
  return {
    items: list.map((it: any): SearchResultItem => ({
      item_id: String(it.itemId || ''),
      title: it.title || '',
      price: String(it.price?.value || ''),
      commission_rate: '2%',
      commission_amount: String(Number(it.price?.value || 0) * 0.02),
      pic_url: it.image?.imageUrl || '',
      item_url: it.itemWebUrl || '',
      shop_name: it.seller?.username || '',
      category: String(it.categories?.[0]?.categoryName || ''),
      sales: '',
      raw: it,
    })),
    total: json?.total || list.length,
  }
}

async function searchShareasale(creds: Record<string, string>, p: SearchParams): Promise<SearchResult> {
  const affiliateId = creds.affiliate_id
  const apiToken = creds.api_token
  const secretToken = creds.secret_token
  if (!affiliateId || !apiToken || !secretToken) throw new Error('ShareASale 凭据不完整 (需 affiliate_id/api_token/secret_token)')

  const actionVerb = 'productSearch'
  const sigStr = `${affiliateId}:${actionVerb}:${secretToken}`
  const sigHash = crypto.createHash('sha256').update(sigStr).digest('hex')
  const params = new URLSearchParams({
    action: actionVerb,
    affiliateId,
    token: apiToken,
    keyword: p.keyword,
    pageNum: String(p.page),
    perPage: String(p.page_size),
    sigID: affiliateId,
    sig: sigHash,
    format: 'json',
  })
  const res = await fetch(`https://shareasale.com/wshare.cfm?${params.toString()}`, {
    headers: { 'x-ShareASale-Auth': apiToken },
  })
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    const list = json?.products || json?.data || []
    return {
      items: list.map((it: any): SearchResultItem => ({
        item_id: String(it.productID || it.id || ''),
        title: it.name || it.title || '',
        price: String(it.price || ''),
        commission_rate: String(it.commission || '') + '%',
        commission_amount: '',
        pic_url: it.imageUrl || it.image || '',
        item_url: it.url || it.affiliateURL || '',
        shop_name: it.merchant || it.merchantName || '',
        category: String(it.category || ''),
        sales: '',
        raw: it,
      })),
      total: list.length,
    }
  } catch {
    throw new Error('ShareASale 响应解析失败, 请检查凭据与权限')
  }
}

function hashHex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}

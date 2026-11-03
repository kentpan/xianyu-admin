/**
 * s3-client — 最小 S3 兼容对象存储客户端 (SigV4 手签, 零第三方依赖)。
 *
 * 用途: 备份存储的 R2/S3 双形态 (系统设置「R2/S3 存储」页配置):
 *   - Cloudflare R2 : endpoint = https://<account_id>.r2.cloudflarestorage.com (region 固定 auto)
 *   - 任意 S3 兼容  : AWS S3 / MinIO / 阿里云 OSS 兼容模式 / 腾讯云 COS 兼容模式等
 *
 * 签名: AWS Signature Version 4 (path-style 寻址, R2 与主流兼容存储均支持)。
 * 运行时: Node 与 workerd (nodejs_compat) 通吃 — 仅依赖 node:crypto 的 createHash/createHmac。
 */

import { createHash, createHmac } from 'node:crypto'

export interface S3Config {
  endpoint: string // 形如 https://<account>.r2.cloudflarestorage.com 或 https://s3.amazonaws.com
  region: string // R2 固定 "auto"; AWS 如 us-east-1
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** path-style 寻址 (endpoint/bucket/key); 默认 true — R2/MinIO 必须, AWS 亦兼容 */
  pathStyle?: boolean
}

export interface S3ObjectMeta {
  key: string
  size: number
  modified_at: string
}

const SHA256_EMPTY = createHash('sha256').update('').digest('hex')

function sha256Hex(data: ArrayBuffer | Uint8Array | string): string {
  return createHash('sha256').update(data as any).digest('hex')
}

function hmac(key: ArrayBuffer | Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key as any).update(data, 'utf8').digest()
}

/** RFC3986 全量编码 (SigV4 要求): 按 UTF-8 字节逐字节编码, 非 [A-Za-z0-9_.~-] 全部转 %XX。 */
function uriEncode(s: string, encodeSlash = true): string {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  for (const b of bytes) {
    const ch = String.fromCharCode(b)
    if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch
    else if (b === 0x2f /* / */) out += encodeSlash ? '%2F' : '/'
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

/** 对象键编码为规范路径: '/' 是路径分隔符保留, 仅逐段编码 (SigV4 canonical URI 规则)。 */
function encodeKeyPath(key: string): string {
  return key.split('/').map((seg) => uriEncode(seg)).join('/')
}

function hostOf(endpoint: string): { scheme: string; host: string } {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  const m = trimmed.match(/^https?:\/\//i)
  const scheme = m ? (m[0].toLowerCase().startsWith('http://') ? 'http' : 'https') : 'https'
  const host = (m ? trimmed.slice(m[0].length) : trimmed).replace(/\/+$/, '')
  if (!host) throw new Error('S3/R2 endpoint 为空或非法')
  return { scheme, host }
}

/** SigV4 签名并请求。key 为对象键 (不含 bucket)。 */
async function s3Request(
  cfg: S3Config,
  method: 'PUT' | 'GET' | 'DELETE',
  key: string,
  opts: { query?: Record<string, string>; body?: ArrayBuffer | Uint8Array | string } = {},
): Promise<{ status: number; text: string; body: ArrayBuffer }> {
  const { scheme, host } = hostOf(cfg.endpoint)
  const region = cfg.region || 'auto'
  const service = 's3'
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(opts.body ?? '')

  // 实际请求 URL: 单重编码 (服务端解码一次得到原始键)。
  // SigV4 canonical URI: S3 规范要求路径段「双重 URI 编码」('%' → '%25', '/' 分隔符保留),
  // ASCII 键两形态相同, 含中文/空格/加号等键不双重编码必 403 SignatureDoesNotMatch。
  const urlPath = cfg.pathStyle === false
    ? `/${encodeKeyPath(key)}`
    : `/${uriEncode(cfg.bucket)}/${encodeKeyPath(key)}`
  const canonicalUri = urlPath.replace(/%/g, '%25')

  const queryEntries = Object.entries(opts.query || {}).map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)])
  queryEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canonicalQuery = queryEntries.map(([k, v]) => `${k}=${v}`).join('&')

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort()
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  headers['authorization'] = authorization

  const url = `${scheme}://${host}${urlPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' || method === 'DELETE' ? undefined : (opts.body as any),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let body: ArrayBuffer = new ArrayBuffer(0)
  if (method === 'GET') {
    body = await res.arrayBuffer().catch(() => new ArrayBuffer(0))
  }
  return { status: res.status, text, body }
}

/** XML 最小提取 (ListObjectsV2 结果 → 元数据列表; 不引 XML 解析器)。 */
function parseListV2(xml: string): S3ObjectMeta[] {
  const out: S3ObjectMeta[] = []
  const re = /<Contents>([\s\S]*?)<\/Contents>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const block = m[1]
    const key = decodeURIComponent(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '')
    const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0)
    const modified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] || ''
    if (key) out.push({ key, size, modified_at: modified })
  }
  return out.sort((a, b) => b.modified_at.localeCompare(a.modified_at))
}

function s3Error(action: string, status: number, text: string): Error {
  const code = text.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] || ''
  const msg = text.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] || ''
  return new Error(`S3/R2 ${action}失败 (HTTP ${status}${code ? ` ${code}` : ''}): ${String(msg || text).slice(0, 200)}`)
}

/** S3 兼容存储操作集 (put/get/list/delete)。 */
export function s3Store(cfg: S3Config) {
  return {
    async put(key: string, data: ArrayBuffer | Uint8Array | string): Promise<void> {
      const r = await s3Request(cfg, 'PUT', key, { body: data })
      if (r.status < 200 || r.status >= 300) throw s3Error(`上传 ${key}`, r.status, r.text)
    },
    async get(key: string): Promise<Uint8Array | null> {
      const r = await s3Request(cfg, 'GET', key)
      if (r.status === 404) return null
      if (r.status < 200 || r.status >= 300) throw s3Error(`下载 ${key}`, r.status, r.text)
      return new Uint8Array(r.body)
    },
    async list(prefix: string): Promise<S3ObjectMeta[]> {
      const out: S3ObjectMeta[] = []
      let token = ''
      do {
        const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' }
        if (token) query['continuation-token'] = token
        const r = await s3Request(cfg, 'GET', '', { query })
        if (r.status < 200 || r.status >= 300) throw s3Error('列举对象', r.status, r.text)
        out.push(...parseListV2(r.text))
        token = r.text.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || ''
      } while (token)
      return out
    },
    async delete(key: string): Promise<void> {
      const r = await s3Request(cfg, 'DELETE', key)
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw s3Error(`删除 ${key}`, r.status, r.text)
    },
  }
}

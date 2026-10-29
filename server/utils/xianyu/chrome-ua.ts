/**
 * xianyu/chrome-ua — 真实 Chromium UA 唯一真源。
 *
 * 为什么必须动态探测 (实测证据, 2026-10-27 探针):
 *   挑战签发 (mtop fetch) 与滑块求解浏览器必须同 UA — 且 UA 必须与真实浏览器版本一致。
 *   Chromium 导航自动携带 Sec-CH-UA / Sec-CH-UA-Platform (由浏览器自身版本派生, UA 字符串
 *   覆盖无效), JS 侧 navigator.userAgentData 同样暴露真实版本。此前写死 "Chrome/133 +
 *   Windows" 而真实浏览器是 Chromium 143 + Linux → 三重矛盾直接被判非真人, 滑块必拒
 *   (punish 页实测 "验证失败 error:dz5Unt")。
 *
 * 规则: 优先探测 Playwright Chromium 二进制 (--version, 进程级缓存); 探测失败回退
 *   历史静态值。平台段跟随部署机 (win32/darwin/linux), 保证 UA ↔ Sec-CH-UA ↔
 *   userAgentData ↔ 求解浏览器四方一致。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 探测失败时的静态回退 (与 protocol.ts 历史值一致)。 */
const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

export interface ChromeUAInfo {
  ua: string
  secChUa: string
  secChUaPlatform: string
  version: string
  source: 'detected' | 'fallback'
}

const g = globalThis as any
if (!g.__xyChromeUAInfo) g.__xyChromeUAInfo = null

function findChromiumBinary(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || '',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries: string[] = []
    try { entries = readdirSync(root) } catch { continue }
    for (const name of entries) {
      // 只认完整 chromium (headless_shell 指纹更差且不用于有头求解)
      if (!/^chromium-\d+$/.test(name)) continue
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const cand = path.join(root, name, sub, 'chrome')
        if (existsSync(cand)) return cand
      }
    }
  }
  return null
}

function platformParts(): { uaPlatform: string; chPlatform: string; osTag: string } {
  switch (process.platform) {
    case 'win32':
      return { uaPlatform: 'Windows NT 10.0; Win64; x64', chPlatform: '"Windows"', osTag: 'Windows/10' }
    case 'darwin':
      return { uaPlatform: 'Macintosh; Intel Mac OS X 10_15_7', chPlatform: '"macOS"', osTag: 'macOS' }
    default:
      return { uaPlatform: 'X11; Linux x86_64', chPlatform: '"Linux"', osTag: 'Linux' }
  }
}

/** 解析真实 Chromium UA (带进程级缓存, 首次 --version 探测 ~200ms)。 */
export function resolveChromeUA(): ChromeUAInfo {
  if (g.__xyChromeUAInfo) return g.__xyChromeUAInfo
  const p = platformParts()
  let version = ''
  let source: ChromeUAInfo['source'] = 'fallback'
  try {
    const bin = findChromiumBinary()
    if (bin) {
      const out = execFileSync(bin, ['--version'], { timeout: 5000, encoding: 'utf8' })
      const m = String(out).match(/(\d+\.\d+\.\d+\.\d+)/)
      if (m) {
        version = m[1]
        source = 'detected'
      }
    }
  } catch {
    // 探测失败 → 静态回退
  }
  if (!version) {
    version = FALLBACK_UA.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/)?.[1] || '133.0.0.0'
  }
  const major = version.split('.')[0]
  const info: ChromeUAInfo = {
    ua: `Mozilla/5.0 (${p.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    secChUa: `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not?A_Brand";v="99"`,
    secChUaPlatform: p.chPlatform,
    version,
    source,
  }
  g.__xyChromeUAInfo = info
  console.log(`[chrome-ua] UA 真源: Chrome/${version} (${p.chPlatform}) source=${source}`)
  return info
}

/** WebSocket 注册包 UA (与握手 UA 同版本同平台, DingTalk 网关字段格式保持 butler 同构)。 */
export function registerUA(): string {
  const info = resolveChromeUA()
  const p = platformParts()
  return `${info.ua} DingTalk(2.1.5) OS(${p.osTag}) Browser(Chrome/${info.version}) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5`
}

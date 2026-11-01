/**
 * 无损 JSON 解析器 — 闲鱼所有外部响应 (mtop HTTP / WS 下行帧 / 同步包) 的唯一解析入口。
 *
 * 背景: 闲鱼响应中 orderId / itemId / buyerId 等字段是 16~19 位数字字面量,
 * JSON.parse 把它们转成 IEEE-754 double (安全整数上限 2^53-1 ≈ 9.007e15) 时
 * 静默丢失末尾精度 → 产生结尾带 0 的错误订单号 → 订单列表错乱 / 详情查错单 /
 * 付款卡片提取到错误订单号导致自动发货落错单 / 回复决策日志缺号错号。
 *
 * 规则: 除「超过安全整数范围的整数字面量按原始文本保留为字符串」外,
 * 其余语义与 JSON.parse 完全一致 (含非法输入抛异常的行为, 调用方原有 try/catch 不变)。
 * 保留为字符串后, 既有用法 String(x) / JSON.stringify(x) / 模板拼接 / SQL 参数行为全部不变。
 */

/** 判断 JSON 整数字面量是否超出安全整数范围 (按十进制位数 + 数值双保险)。 */
function isUnsafeIntegerLiteral(lit: string): boolean {
  const digits = lit.startsWith('-') ? lit.slice(1) : lit
  if (digits.length > 16) return true
  if (digits.length < 15) return false
  const num = Number(lit)
  return num > Number.MAX_SAFE_INTEGER || num < -Number.MAX_SAFE_INTEGER
}

export function parseLosslessJson(text: string): any {
  const s = String(text ?? '')
  const n = s.length
  let i = 0

  function skipWs(): void {
    while (i < n) {
      const c = s.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }

  function expectWord(word: string): void {
    if (s.startsWith(word, i)) i += word.length
    else throw new Error(`Unexpected token at position ${i}`)
  }

  function readValue(): any {
    skipWs()
    if (i >= n) throw new Error('Unexpected end of JSON input')
    const c = s[i]
    if (c === '{') return readObject()
    if (c === '[') return readArray()
    if (c === '"') return readString()
    if (c === 't') { expectWord('true'); return true }
    if (c === 'f') { expectWord('false'); return false }
    if (c === 'n') { expectWord('null'); return null }
    if (c === '-' || (c >= '0' && c <= '9')) return readNumber()
    throw new Error(`Unexpected token '${c}' at position ${i}`)
  }

  function readObject(): Record<string, any> {
    i++
    const out: Record<string, any> = {}
    skipWs()
    if (i < n && s[i] === '}') { i++; return out }
    for (;;) {
      skipWs()
      if (i >= n || s[i] !== '"') throw new Error(`Expected string key at position ${i}`)
      const k = readString()
      skipWs()
      if (s[i] !== ':') throw new Error(`Expected ':' at position ${i}`)
      i++
      out[k] = readValue()
      skipWs()
      if (s[i] === ',') { i++; continue }
      if (s[i] === '}') { i++; return out }
      throw new Error(`Expected ',' or '}' at position ${i}`)
    }
  }

  function readArray(): any[] {
    i++
    const out: any[] = []
    skipWs()
    if (s[i] === ']') { i++; return out }
    for (;;) {
      out.push(readValue())
      skipWs()
      if (s[i] === ',') { i++; continue }
      if (s[i] === ']') { i++; return out }
      throw new Error(`Expected ',' or ']' at position ${i}`)
    }
  }

  function readString(): string {
    const start = i
    i++
    let out = ''
    while (i < n) {
      const c = s[i]
      if (c === '"') { i++; return out }
      if (c === '\\') {
        const e = s[i + 1]
        i += 2
        if (e === '"') out += '"'
        else if (e === '\\') out += '\\'
        else if (e === '/') out += '/'
        else if (e === 'b') out += '\b'
        else if (e === 'f') out += '\f'
        else if (e === 'n') out += '\n'
        else if (e === 'r') out += '\r'
        else if (e === 't') out += '\t'
        else if (e === 'u') {
          const hex = s.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Bad unicode escape at position ${i}`)
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else throw new Error(`Bad escape '\\${e ?? ''}' at position ${i - 2}`)
        continue
      }
      out += c
      i++
    }
    throw new Error(`Unterminated string starting at position ${start}`)
  }

  function readNumber(): number | string {
    const start = i
    if (s[i] === '-') i++
    while (i < n && s[i] >= '0' && s[i] <= '9') i++
    let isInt = true
    if (s[i] === '.') {
      isInt = false
      i++
      while (i < n && s[i] >= '0' && s[i] <= '9') i++
    }
    if (s[i] === 'e' || s[i] === 'E') {
      isInt = false
      i++
      if (s[i] === '+' || s[i] === '-') i++
      while (i < n && s[i] >= '0' && s[i] <= '9') i++
    }
    const lit = s.slice(start, i)
    if (!lit || lit === '-') throw new Error(`Invalid number at position ${start}`)
    if (isInt && isUnsafeIntegerLiteral(lit)) return lit
    return Number(lit)
  }

  const value = readValue()
  skipWs()
  if (i !== n) throw new Error(`Unexpected non-whitespace content at position ${i}`)
  return value
}

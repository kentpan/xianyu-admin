/**
 * POST /api/export/csv — generic CSV export.
 * Body: { filename, headers: string[], rows: (string|number)[][] }
 * Returns CSV file download. NOT wrapped in unified envelope (raw bytes).
 */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const body = await readBody(event)
  const { filename = 'export.csv', headers = [], rows = [] } = body || {}

  if (!Array.isArray(headers) || !Array.isArray(rows)) {
    setResponseStatus(event, 400)
    return { success: false, code: 400, message: 'headers 和 rows 必须是数组' }
  }

  function escapeCell(v: any): string {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  const lines: string[] = []
  if (headers.length) lines.push(headers.map(escapeCell).join(','))
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','))
  }
  // BOM for Excel UTF-8 compatibility
  const csv = '\ufeff' + lines.join('\r\n')

  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="${filename}"`)
  return csv
})

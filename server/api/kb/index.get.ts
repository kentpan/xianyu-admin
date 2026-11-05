/**
 * GET /api/kb — AI 知识库全量数据 (v2.3.0)。
 *
 * 一次拉取: 分组 + 问话 + 回答 + 分组成员映射 + 已捕获消息 ID 集合
 * (消息管理页「已添加到知识库 ✅」标志依据)。知识库条目为人工精选规模
 * (数十~数百条), 全量拉取最简单可靠, 前端 3 列表各自分页渲染。
 * 问话/回答按 sort 升序 (sort 即优先级, AI 检索同序)。
 */
export default defineEventHandler(
  withApi(async (event) => {
    requireUser(event)
    const db = await getDb()

    const [groups, questions, answers, members, capturedQ, capturedA] = await Promise.all([
      db.all('SELECT id, name, sort, created_at, updated_at FROM kb_groups ORDER BY sort ASC, id ASC').catch(() => []),
      db
        .all(
          `SELECT id, content, source_message_id, source_chat_id, source_cookie_id, item_id, buyer_id,
                  freq, sort, ai_hit_count, ai_last_used_at, created_at, updated_at
           FROM kb_questions ORDER BY sort ASC, id ASC`,
        )
        .catch(() => []),
      db
        .all(
          `SELECT id, content, source_message_id, source_chat_id, source_cookie_id, item_id,
                  is_ai_generated, freq, sort, ai_hit_count, ai_last_used_at, created_at, updated_at
           FROM kb_answers ORDER BY sort ASC, id ASC`,
        )
        .catch(() => []),
      db.all('SELECT group_id, item_type, item_id FROM kb_group_members').catch(() => []),
      db.all("SELECT source_message_id FROM kb_questions WHERE source_message_id != ''").catch(() => []),
      db.all("SELECT source_message_id FROM kb_answers WHERE source_message_id != ''").catch(() => []),
    ])

    const captured = [...capturedQ, ...capturedA].map((r: any) => String(r.source_message_id))
    return ok({
      groups,
      questions,
      answers,
      members,
      captured,
      stats: {
        groups: groups.length,
        questions: questions.length,
        answers: answers.length,
        ai_hits: questions.concat(answers).reduce((s: number, r: any) => s + Number(r.ai_hit_count || 0), 0),
      },
    })
  }),
)

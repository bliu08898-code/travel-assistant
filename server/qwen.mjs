const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    selectedId: { type: 'string' },
    title: { type: 'string' },
    mission: { type: 'string' },
    reason: { type: 'string' },
    durationMinutes: { type: 'integer', minimum: 20, maximum: 120 },
  },
  required: ['selectedId', 'title', 'mission', 'reason', 'durationMinutes'],
}

const SYSTEM_PROMPT = [
  '你是 LITTLE DETOUR 的中文 Quest 决策器。',
  '你只能从用户消息里的真实候选地点中选择，selectedId 必须逐字复制候选 id。绝不能创造、改写或补充地点事实。',
  '优先级依次是：能完整放进用户给出的最早出发—最晚结束时间窗口、符合同行人数、人均预算可接受、符合用户心情、有一点意外感。一次只安排一个目的地，不做行程规划。',
  '候选中的 plannedDeparture 是后端核算出的可行出发时间；如果不是当前时刻，文案必须尊重该时间，不能写“现在就去”或声称地点此刻正在营业。营业时间未公开的候选只能作为备选，且不得自行声称营业。',
  '必须结合 partySize 和 partyGuidance 判断地点及任务是否适合同行人数；人数越多不代表安排越多，而是更重视共同参与、协调成本、空间与互动方式。',
  'title 必须包含所选地点的完整原名，并写成一句简短、有行动感的中文指令。',
  'mission 是抵达后可以完成、不打扰他人、有观察感的小任务；独自出发时应可独立完成，多人出发时应让大家共同参与。reason 要解释为什么这个时间窗口和这个人数适合去。',
  '语言要自然、轻松、有一点社媒感，但不要油腻、不要堆网络热词。',
  '只返回符合给定 JSON 结构的对象，不要 Markdown，不要额外说明。',
].join('\n')

function parseContent(content) {
  if (typeof content !== 'string') throw new Error('千问没有返回可用文本')
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

function validateResult(value) {
  if (!value || typeof value !== 'object') throw new Error('千问结果不是有效对象')
  for (const key of ['selectedId', 'title', 'mission', 'reason']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`千问结果缺少 ${key}`)
  }
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 20 || value.durationMinutes > 120) {
    throw new Error('千问返回的建议时长不合规')
  }
  return value
}

export async function askQwen({ input, candidates }, config = {}) {
  const apiKey = config.apiKey
  if (!apiKey) return null

  if (!config.baseUrl) throw new Error('未配置百炼业务空间 API 地址')
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const model = config.model || 'qwen-flash'
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            user: input,
            candidates,
            outputSchema: RESPONSE_SCHEMA,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const apiCode = String(payload?.error?.code || payload?.code || 'UNKNOWN').replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
    const error = new Error(`千问请求失败（${response.status}，${apiCode}）`)
    error.status = response.status
    error.apiCode = apiCode
    throw error
  }

  const payload = await response.json()
  return validateResult(parseContent(payload.choices?.[0]?.message?.content))
}

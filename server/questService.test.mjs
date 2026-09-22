import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuest, fallbackWriting, minutesUntil, partyProfileFor, QuestServiceError, resolveTimeWindow } from './questService.mjs'

const originalFetch = globalThis.fetch

function futureChinaDeadline(hoursAhead = 6) {
  const target = new Date(Date.now() + hoursAhead * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(target)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  }
}

function json(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function installAmapMock({ walkingDurationSeconds = 360, openingHours = '24小时营业' } = {}) {
  globalThis.fetch = async (request) => {
    const url = new URL(String(request))
    if (url.pathname.includes('/coordinate/convert')) return json({ status: '1', locations: '114.123456,22.543210' })
    if (url.pathname.includes('/geocode/regeo')) return json({
      status: '1',
      regeocode: { formatted_address: '广东省深圳市罗湖区宝安南路1881号', addressComponent: { adcode: '440303', citycode: '0755' } },
    })
    if (url.pathname.includes('/place/around')) return json({
      status: '1',
      pois: [{
        id: 'B0REALPLACE', name: '深圳书城罗湖城', location: '114.124000,22.544000', distance: '280',
        type: '购物服务;文化用品店;书店', pname: '广东省', cityname: '深圳市', adname: '罗湖区',
        address: '深南东路5033号', business: { opentime_today: openingHours, cost: '88', rating: '4.8' },
      }],
    })
    if (url.pathname.includes('/direction/walking')) return json({
      status: '1', route: { paths: [{ distance: '420', cost: { duration: String(walkingDurationSeconds) } }] },
    })
    throw new Error(`Unexpected URL: ${url}`)
  }
}

test.afterEach(() => { globalThis.fetch = originalFetch })

test('uses an explicit date so a next-day afternoon is never treated as today', () => {
  const deadline = futureChinaDeadline(6)
  const result = minutesUntil(deadline.time, deadline.date)
  assert.ok(result >= 358 && result <= 360)
})

test('builds a real window from a custom earliest start instead of always using now', () => {
  const start = futureChinaDeadline(30)
  const finish = futureChinaDeadline(34)
  const window = resolveTimeWindow({
    earliestStartMode: 'custom', earliestStartDate: start.date, earliestStartTime: start.time,
    freeUntilDate: finish.date, freeUntil: finish.time,
  })
  assert.ok(window.startAt > Date.now())
  assert.ok(window.availableMinutes >= 238 && window.availableMinutes <= 240)
})

test('returns a grounded quest whose place and address come from the POI provider', async () => {
  installAmapMock()
  const deadline = futureChinaDeadline()
  const quest = await createQuest({
    input: {
      locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
      freeUntilDate: deadline.date, freeUntil: deadline.time, partySize: '2', vibe: 'curious', budget: 'custom', customBudget: '200',
    },
    excludedIds: [],
  }, { AMAP_WEB_SERVICE_KEY: 'test-key' })

  assert.equal(quest.id, 'amap:B0REALPLACE')
  assert.equal(quest.place, '深圳书城罗湖城')
  assert.match(quest.address, /深南东路5033号/)
  assert.match(quest.travel, /6 分钟/)
  assert.match(quest.navigationUrl, /^https:\/\/uri\.amap\.com\/navigation/)
  assert.equal(quest.verificationNote, '真实地点、步行路线、营业时间与人均预算均已核验。')
  assert.equal(quest.partyLabel, '2 人同行')
  assert.doesNotMatch(JSON.stringify(quest), /转角书房/)
})

test('rejects a known over-budget candidate instead of pretending it is feasible', async () => {
  installAmapMock()
  const deadline = futureChinaDeadline()
  await assert.rejects(
    createQuest({
      input: {
        locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
        freeUntilDate: deadline.date, freeUntil: deadline.time, partySize: '1', vibe: 'curious', budget: 'custom', customBudget: '50',
      },
      excludedIds: [],
    }, { AMAP_WEB_SERVICE_KEY: 'test-key' }),
    (error) => error instanceof QuestServiceError && error.code === 'NO_FEASIBLE_PLACE',
  )
})

test('does not filter a known price when per-person budget is unrestricted', async () => {
  installAmapMock()
  const deadline = futureChinaDeadline()
  const quest = await createQuest({
    input: {
      locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
      freeUntilDate: deadline.date, freeUntil: deadline.time, partySize: '4', vibe: 'curious', budget: 'any', customBudget: '',
    },
    excludedIds: [],
  }, { AMAP_WEB_SERVICE_KEY: 'test-key' })

  assert.equal(quest.place, '深圳书城罗湖城')
  assert.match(quest.verificationNote, /未限制人均预算/)
})

test('keeps a future candidate with unknown hours but labels it for confirmation', async () => {
  installAmapMock({ openingHours: '' })
  const start = futureChinaDeadline(30)
  const finish = futureChinaDeadline(34)
  const quest = await createQuest({
    input: {
      locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
      earliestStartMode: 'custom', earliestStartDate: start.date, earliestStartTime: start.time,
      freeUntilDate: finish.date, freeUntil: finish.time, partySize: '3', vibe: 'curious', budget: 'any', customBudget: '',
    },
    excludedIds: [],
  }, { AMAP_WEB_SERVICE_KEY: 'test-key' })

  assert.equal(quest.operatingStatus, 'unknown')
  assert.equal(quest.closing, '营业时间待确认')
  assert.match(quest.verificationNote, /出发前在高德确认/)
  assert.match(quest.schedule, /建议.*后出发/)
})

test('rejects places whose verified walking route exceeds 30 minutes', async () => {
  installAmapMock({ walkingDurationSeconds: 31 * 60 })
  const deadline = futureChinaDeadline()

  await assert.rejects(
    createQuest({
      input: {
        locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
        freeUntilDate: deadline.date, freeUntil: deadline.time, partySize: '2', vibe: 'curious', budget: 'any', customBudget: '',
      },
      excludedIds: [],
    }, { AMAP_WEB_SERVICE_KEY: 'test-key' }),
    (error) => error instanceof QuestServiceError
      && error.code === 'NO_FEASIBLE_PLACE'
      && /步行 30 分钟内/.test(error.message),
  )
})

test('maps party size to social needs and adapts fallback missions', () => {
  assert.match(partyProfileFor(1).guidance, /安静|沉浸/)
  assert.match(partyProfileFor(2).guidance, /交流/)
  assert.match(partyProfileFor(4).guidance, /共同参与/)
  assert.match(partyProfileFor(7).guidance, /集体娱乐/)
  assert.match(partyProfileFor(12).guidance, /协调成本/)

  const pairCopy = fallbackWriting({ id: 'pair', name: '城市公园', category: '公园' }, { vibe: 'active', partySize: '2' })
  const groupCopy = fallbackWriting({ id: 'group', name: '周末市集', category: '市场' }, { vibe: 'local', partySize: '6' })
  assert.match(pairCopy.mission, /各自完成一次/)
  assert.match(groupCopy.mission, /全员轮流/)
})

test('rejects invalid party sizes', async () => {
  const deadline = futureChinaDeadline()
  await assert.rejects(
    createQuest({
      input: {
        locationLabel: '我的当前位置', coordinates: { longitude: 114.12, latitude: 22.54 },
        freeUntilDate: deadline.date, freeUntil: deadline.time, partySize: '0', vibe: 'curious', budget: 'free', customBudget: '',
      },
      excludedIds: [],
    }, { AMAP_WEB_SERVICE_KEY: 'test-key' }),
    (error) => error instanceof QuestServiceError && error.code === 'INVALID_PARTY_SIZE',
  )
})

test('offers forty distinct grounded mission variants across venue types and vibes', () => {
  const venues = [
    ['reading', '街角图书馆', '图书馆'],
    ['nature', '城市中央公园', '公园'],
    ['exhibition', '今日美术馆', '美术馆'],
    ['market', '周末旧物市集', '市场'],
    ['creative', '南头创意园', '创意园'],
    ['retail', '城市生活馆', '生活馆'],
    ['landmark', '海边灯塔', '景点'],
    ['general', '城市体验空间', '休闲场所'],
  ]
  const vibes = ['quiet', 'curious', 'active', 'local', 'surprise']
  const results = new Set()

  for (const [id, name, category] of venues) {
    for (const vibe of vibes) {
      const copy = fallbackWriting({ id, name, category }, { vibe })
      results.add(`${copy.title}|${copy.mission}|${copy.reason}`)
    }
  }

  assert.equal(results.size, 40)
})

// The glyph table behind the pixel markers: every character the panel and the sprites draw must
// have a 3 x 5 bitmap, or glyph() silently paints nothing.
import { assert, test } from 'orca/testing'
import { BOT_COLORS, C, GLYPHS, XMAS, botColors, brickBot, christmasTree, costumeOf, festive, glyph, holidayLights, inChristmasSeason, look, setFestive, workstation } from './sprites.js'
import { botMascot } from './loft.js'

test('every glyph the office draws exists and is 3 x 5', () => {
  for (const ch of ['?', '!', 'z', '+']) {
    const rows = GLYPHS[ch]
    assert.ok(rows, `no glyph for ${ch}`)
    assert.equal(rows.length, 5, `${ch} is not 5 rows tall`)
    for (const row of rows) assert.equal(row.length, 3, `${ch} has a row that is not 3 wide`)
  }
})

test('the + marker paints a cross of five pixels at its origin', () => {
  const painted: string[] = []
  glyph((x: number, y: number) => painted.push(`${x},${y}`), '+', 10, 20, '#fff')
  assert.deepEqual(painted.sort(), ['11,21', '10,22', '11,22', '12,22', '11,23'].sort())
})

test('an agent on a paired server works on a thin client, a local one on a dark monitor', () => {
  const paint = (remote: boolean, state = 'working', t = 2) => {
    const px = new Map<string, string>()
    workstation((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
    }, { id: 'a', state }, t, false, remote)
    return px
  }
  const local = paint(false)
  const remote = paint(true)
  assert.equal(local.get('5,9'), C.frame)
  assert.equal(local.has('2,12'), false)
  assert.equal(remote.get('5,9'), C.thinFrame)
  assert.equal(remote.get('2,12'), C.thinBox)
  // the link light blinks while the far machine is busy, and stays dark when it is not
  assert.equal(paint(true, 'working', 2).get('2,11'), C.blue)
  assert.equal(paint(true, 'working', 0).get('2,11'), C.thinEdge)
  assert.equal(paint(true, 'done', 2).get('2,11'), C.thinEdge)
})

test('christmas theme dresses characters in festive costumes and draws tree and lights', () => {
  try {
    setFestive(true)
    assert.equal(festive(), true)

    const costumes = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => costumeOf(id)))
    assert.ok(costumes.size >= 2)
    for (const c of costumes) {
      assert.ok(['santa', 'elf', 'reindeer', 'grinch'].includes(c))
    }

    const lk = look('agent-1')
    assert.ok(lk.costume)

    const treePx = new Map<string, string>()
    christmasTree((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) treePx.set(`${x + i},${y + j}`, c)
    }, 0)
    assert.equal(treePx.get('7,-1'), C.white)
    assert.equal(treePx.get('7,17'), XMAS.woodTrunk)

    const lightPx = new Map<string, string>()
    holidayLights((x: number, y: number, w: number, h: number, c: string) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) lightPx.set(`${x + i},${y + j}`, c)
    }, 24, 0)
    assert.ok(lightPx.size > 0)
  } finally {
    setFestive(false)
  }
})

test('a waiting agent paints an animated question mark overhead', () => {
  const px = new Map<string, string>()
  workstation((x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.set(`${x + i},${y + j}`, c)
  }, { id: 'a', state: 'waiting' }, 0, false, false)
  // the '?' top bar sits beside the head at (15..17, 0), then bobs down a pixel
  assert.equal(px.get('15,0'), C.amber)
  assert.equal(px.get('17,0'), C.amber)
  // nothing is painted above the seat's own cell, into the row above
  assert.ok([...px.keys()].every((k) => Number(k.split(',')[1]) >= 0))
})

test('the christmas theme is offered from 15 November through 1 January only', () => {
  const on = (y: number, m: number, d: number) => inChristmasSeason(new Date(y, m - 1, d, 12))
  assert.equal(on(2026, 11, 14), false)
  assert.equal(on(2026, 11, 15), true)
  assert.equal(on(2026, 12, 31), true)
  assert.equal(on(2027, 1, 1), true)
  assert.equal(on(2027, 1, 2), false)
  assert.equal(on(2027, 7, 1), false)
})


test('every bot on screen gets a colour of its own, the same whatever order they come in', () => {
  const bots = ['Chief of Stack', 'Release notes', 'Triage', 'Deps', 'Docs', 'Oncall'].map((name) => ({ id: name, name }))
  const colors = botColors(bots)
  assert.equal(new Set([...colors.values()]).size, 6, 'two bots share a colour')
  const again = botColors([...bots].reverse())
  for (const bot of bots) assert.equal(again.get(bot.id), colors.get(bot.id), `${bot.name} changed colour`)
  for (const c of colors.values()) assert.ok(BOT_COLORS.includes(c))
  // a seventh bot starts the colours round again rather than going without
  assert.ok(botColors([...bots, { id: 'x', name: 'Seventh' }]).get('x'))
})

test('a bot is drawn as its mascot: Brick flat in 10 x 9, the loft outlined in 12 x 12', () => {
  const colors = BOT_COLORS[0]
  for (const state of ['working', 'waiting', 'blocked', 'done', 'watching', 'idle', 'asleep']) {
    const flat: number[][] = []
    brickBot((x: number, y: number, w: number, h: number) => flat.push([x, y, w, h]), colors, state, 3)
    for (const [x, y, w, h] of flat) assert.ok(x >= -1 && y >= 0 && x + w <= 11 && y + h <= 10, `Brick ${state} paints outside its box`)
    const outlined: string[] = []
    botMascot((x: number, y: number, w: number, h: number, c: string) => outlined.push(`${x},${y},${w},${h},${c}`), 0, 0, colors, state, 3)
    assert.ok(outlined.some((p) => p.endsWith('#1d1b26')), `the loft ${state} has no outline`)
    for (const p of outlined) {
      const [x, y, w, h] = p.split(',').map(Number)
      assert.ok(x >= -2 && y >= -4 && x + w <= 14 && y + h <= 14, `the loft ${state} paints outside its box`)
    }
  }
  // asleep, it dims: its body colour is not the awake one
  const asleep: string[] = []
  brickBot((_x: number, _y: number, _w: number, _h: number, c: string) => asleep.push(c), colors, 'asleep', 0)
  assert.ok(!asleep.includes(colors.body))
})

// The loft's seating rules and its floor plan: seats stay put while others come and go, a
// family sits together, and everyone has room to stand and walk.
import { assert, test } from 'orca/testing'
import { LOFT_MIN_W, drawLoft, loftGeometry, loftMinW, layoutLoft } from './loft.js'
import { routePlanner, walkGrid } from './walking.js'

type Staff = { id: string; state: string; specialists: unknown[] }
type Desk = { id: string; name: string; label: string; parentId: string | null; staff: Staff[] }

const helpers = {
  families: (desks: Desk[]) => {
    const roots = desks.filter((d) => !d.parentId)
    return roots.map((r) => [r, ...desks.filter((d) => d.parentId === r.id)])
  },
  familySeats: (family: Desk[]) => family.flatMap((desk) => desk.staff.map((staff) => ({ desk, staff }))),
  activeSpecialists: (staff: Staff) => staff.specialists
}

const desk = (repo: string, n: number, parentId: string | null = null, asleep = false): Desk => ({
  id: `${repo}-${n}`,
  name: `${repo}-${n}`,
  label: `${repo}-${n}`,
  parentId,
  staff: asleep ? [] : [{ id: `${repo}-agent-${n}`, state: 'working', specialists: [] }]
})
const office = (floors: Record<string, Desk[]>) => ({ at: 0, error: null, floors: Object.entries(floors).map(([repo, desks]) => ({ repo, desks })) })
const slots = (layout: any, repo: string) => new Map(layout.seats.filter((s: any) => s.room.name === repo).map((s: any) => [s.key, s.slot]))

test('the front row fills first, and a seat stays put when its neighbour leaves', () => {
  const desks = [1, 2, 3, 4].map((n) => desk('keep', n))
  const layout = layoutLoft(office({ keep: desks }), 900, 3, helpers)
  const first = slots(layout, 'keep')
  assert.deepEqual([...first.values()], [0, 1, 2, 3])
  assert.deepEqual(layout.seats.map((s: any) => s.front), [true, true, true, false])
  const later = slots(layoutLoft(office({ keep: [desks[0], desks[2], desks[3]] }), 900, 3, helpers), 'keep')
  for (const [key, slot] of later) assert.equal(slot, first.get(key), `${key} moved`)
  // a newcomer takes the seat that came free
  const back = slots(layoutLoft(office({ keep: [desks[0], desks[2], desks[3], desk('keep', 9)] }), 900, 3, helpers), 'keep')
  assert.equal(back.get('keep-9|keep-agent-9'), 1)
})

test('a child worktree sits beside its parent when that desk is free', () => {
  const parent = desk('fam', 1)
  const other = desk('fam', 2)
  const child = desk('fam', 3, parent.id)
  const placed = slots(layoutLoft(office({ fam: [parent, other, child] }), 900, 3, helpers), 'fam')
  assert.equal(placed.get('fam-3|fam-agent-3'), (placed.get('fam-1|fam-agent-1') as number) + 1)
})

test('a seventh agent opens a second island, and every island has six desks', () => {
  const layout = layoutLoft(office({ big: [1, 2, 3, 4, 5, 6, 7].map((n) => desk('big', n)) }), 900, 3, helpers)
  const room = layout.rooms.find((r: any) => r.name === 'big')
  assert.equal(room.islands.length, 2)
  for (const isl of room.islands) assert.equal(isl.cells.length, 6)
})

test('rooms go two to a row on a wide floor and one on a narrow one, inside the walls', () => {
  const big = (r: string) => [1, 2, 3, 4].map((n) => desk(r, n))
  const floors = { a: big('a'), b: big('b'), c: big('c') }
  const wide = layoutLoft(office(floors), 330 * 3, 3, helpers)
  assert.equal(wide.building.cols, 2)
  assert.equal(wide.lines.length, 2)
  const narrow = layoutLoft(office(floors), LOFT_MIN_W * 3, 3, helpers)
  assert.equal(narrow.building.cols, 1)
  assert.equal(narrow.lines.length, 3)
  for (const layout of [wide, narrow]) {
    for (const room of layout.rooms) assert.ok(room.x >= 4 && room.x + room.w <= layout.artW - 4, `${room.name} pokes through a wall`)
  }
})

test('a team of three or fewer gets half an island, and two such teams share a room', () => {
  const layout = layoutLoft(office({ big: [1, 2, 3, 4, 5].map((n) => desk('big', n)), s1: [desk('s1', 1)], s2: [desk('s2', 1), desk('s2', 2)] }), 330 * 3, 3, helpers)
  assert.equal(layout.teamCount, 3)
  assert.equal(layout.rooms.length, 2)
  const shared = layout.rooms.find((r: any) => r.islands.length === 2)
  assert.ok(shared.islands.every((i: any) => i.half && i.cells.length === 3 && i.team), 'the shared room holds two named half islands')
  assert.ok(layout.seats.filter((s: any) => s.room.name !== 'big').every((s: any) => s.front), 'a half island seats its team facing their screens')
})

test('a sleeping worktree keeps its desk, empty, with its nameplate', () => {
  const layout = layoutLoft(office({ t: [desk('t', 1), desk('t', 2, null, true)] }), 330 * 3, 3, helpers)
  const cells = layout.rooms[0].islands[0].cells
  assert.equal(layout.seats.length, 1)
  const vacant = cells.find((c: any) => c?.vacant)
  assert.equal(vacant.label, 't-2')
})

for (const [width, look] of [[330 * 3, 'wide'], [LOFT_MIN_W * 3, 'narrow']] as const)
test(`everyone stands and every break spot is on open floor, ${look}`, () => {
  const layout = layoutLoft(office({ a: [1, 2, 3, 4, 5, 6].map((n) => desk('a', n)), b: [desk('b', 1)] }), width, 3, helpers)
  const blocks = loftGeometry.obstacles(layout)
  const overlaps = ([ax, ay, aw, ah]: number[], [bx, by, bw, bh]: number[]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
  const feet = ({ x, y }: { x: number; y: number }) => [x + 1, y + 12, 6, 3]
  const clear = (spot: { x: number; y: number }) => !blocks.some((b: number[]) => overlaps(b, feet(spot)))
  for (const seat of layout.seats) {
    assert.ok(clear(loftGeometry.homeOf(seat)), `${seat.key} has nowhere to stand up`)
    for (const stool of seat.stools) assert.ok(clear(loftGeometry.stoolStops(seat, stool).aisle), `${seat.key} has no aisle by a stool`)
  }
  const c: any = layout.common
  for (const spot of [...c.spots, ...c.foos]) assert.ok(clear(spot), `a ${spot.kind} spot is inside furniture`)
})

test('the leisure area is below every Loft workstation bay', () => {
  const floors = Object.fromEntries(['a', 'b', 'c', 'd'].map((r) => [r, [1, 2, 3, 4].map((n) => desk(r, n))]))
  const layout = layoutLoft(office(floors), LOFT_MIN_W * 3, 3, helpers)
  assert.ok(layout.rooms.every((r: any) => r.y + r.h < layout.common.y), 'the leisure area follows the work deck')
  assert.equal(layout.lines.at(-1), layout.common.y, 'the leisure bulkhead follows the leisure area')
})

test('the fixed-height leisure module can dock to the bottom of a tall panel', () => {
  const layout = layoutLoft(office({ a: [desk('a', 1)] }), LOFT_MIN_W * 3, 3, helpers, 400)
  assert.equal(layout.artH, 400)
  assert.equal(layout.common.y + layout.common.h + 6, 400)
})

test('a tall office centers a single workstation row vertically', () => {
  const compact = layoutLoft(office({ a: [desk('a', 1)] }), LOFT_MIN_W * 3, 3, helpers)
  const tall = layoutLoft(office({ a: [desk('a', 1)] }), LOFT_MIN_W * 3, 3, helpers, 400)
  const room = tall.rooms[0]
  const island = room.islands[0]
  assert.ok(room.h > compact.rooms[0].h)
  assert.equal(island.y - room.y, 14 + Math.floor((room.h - compact.rooms[0].h) / 2))
  assert.equal(tall.common.y + tall.common.h + 6, 400)
})

test('on a narrow floor the hangout leaves the walkway by the right wall clear', () => {
  const layout = layoutLoft(office({ a: [desk('a', 1)], b: [desk('b', 1)] }), LOFT_MIN_W * 3, 3, helpers)
  const { spineX } = layout.building
  for (const t of layout.common.things) {
    const size: Record<string, number> = { booth: 20, fridge: 13, cooler: 7, plant: 9, tulip: 7, roundTable: 16, foosball: 28, coffeeTable: 24, barTable: 28, barStool: 7 }
    const right = t.x + (t.w ?? size[t.kind] ?? 0)
    assert.ok(right <= spineX, `the ${t.kind} stands in the walkway`)
  }
})

test('specialists on both sides of neighbouring desks never sit on each other or on a chair', () => {
  const layout = layoutLoft(office({ a: [1, 2, 3, 4, 5, 6].map((n) => desk('a', n)) }), 330 * 3, 3, helpers)
  const front = layout.seats.filter((s: any) => s.front && s.row0 === 0).sort((a: any, b: any) => a.cx - b.cx)
  for (let i = 0; i + 1 < front.length; i++) {
    const right = front[i].stools[0]
    const left = front[i + 1].stools[1]
    assert.ok(right.x + 8 < left.x - 1, `stools of ${front[i].key} and ${front[i + 1].key} overlap`)
    assert.ok(right.x + 8 <= front[i + 1].cx - 6, `a stool runs into the chair of ${front[i + 1].key}`)
    assert.ok(right.x >= front[i].cx + 9, `the specialist of ${front[i].key} sits on its chair`)
  }
})

test('a desk keeps its own key, for its mat and things, when its worktree wakes up', () => {
  const asleep = layoutLoft(office({ k: [desk('k', 1), desk('k', 2, null, true)] }), 330 * 3, 3, helpers)
  const vacant = asleep.rooms[0].islands[0].cells.find((c: any) => c?.vacant)
  const awake = layoutLoft(office({ k: [desk('k', 1), desk('k', 2)] }), 330 * 3, 3, helpers)
  const seat = awake.seats.find((s: any) => s.desk.id === 'k-2')
  assert.equal(seat.unit, vacant.key)
})

test('a big office paints only the rows on screen, the same as before, and each desk mat once', () => {
  const g = globalThis as any
  const offscreen = g.OffscreenCanvas
  let mats = 0
  const anything = () => new Proxy({} as any, { get: (t, k) => (k in t ? t[k] : () => {}) })
  g.OffscreenCanvas = class {
    width: number
    height: number
    constructor(w: number, h: number) {
      mats++
      this.width = w
      this.height = h
    }
    getContext() {
      return anything()
    }
  }
  try {
    // one agent and 500 sleeping worktrees: far more desks than a panel shows, and than the mats kept
    const desks = [desk('huge', 0), ...Array.from({ length: 500 }, (_, n) => desk('huge', n + 1, null, true))]
    const layout = layoutLoft(office({ huge: desks }), 330 * 2, 2, helpers)
    assert.ok(layout.artH > 3000, 'the office should be much taller than the panel')
    let painted: string[] = []
    const ctx: any = anything()
    ctx.fillRect = (x: number, y: number, w: number, h: number) => painted.push(`${x},${y},${w},${h},${ctx.fillStyle}`)
    ctx.drawImage = (img: any, x: number, y: number) => painted.push(`img ${x},${y},${img.width},${img.height}`)
    const frame = (view?: { y0: number; y1: number }) => {
      painted = []
      drawLoft(ctx, layout, {
        tick: 0,
        away: () => false,
        seatedAt: () => [],
        people: [],
        sittersAt: new Set(),
        palu: null,
        bowls: () => {},
        nameplate: () => '',
        drawText: () => {},
        view
      })
      return painted
    }
    const whole = frame()
    // a band of desks, and one across the hangout
    const views = [
      { y0: 1200, y1: 1500 },
      { y0: layout.common.y - 40, y1: layout.common.y + layout.common.h + 40 }
    ]
    for (const view of views) {
      const inView = (op: string) => {
        const [, y, , h] = op.replace('img ', '').split(',').map(Number)
        return y < view.y1 && y + h > view.y0
      }
      const culled = frame(view)
      const made = mats
      assert.deepEqual(frame(view), culled)
      assert.equal(mats, made, 'the next frame painted the desk mats again')
      assert.ok(culled.length * 4 < whole.length, 'the rows off screen were painted too')
      assert.ok(culled.filter(inView).length > 100, `nothing painted in rows ${view.y0} to ${view.y1}`)
      assert.deepEqual(culled.filter(inView), whole.filter(inView), `rows ${view.y0} to ${view.y1} look different`)
    }
  } finally {
    g.OffscreenCanvas = offscreen
  }
})


// ---- bots ----------------------------------------------------------------------------------------

type BotLike = { id: string; name: string; state: string; desks: Desk[]; staff: Staff[] }
const botDesk = (bot: string, repo: string, n: number, asleep = false): Desk & { repo: string; bot: string } => ({ ...desk(repo, n, null, asleep), id: `${bot}-${repo}-${n}`, repo, bot })
const aBot = (name: string, desks: Desk[] = [], state = 'working'): BotLike => ({ id: name, name, state, desks, staff: [{ id: `chat-${name}`, state: 'working', specialists: [] }] })
const overlap = ([ax, ay, aw, ah]: number[], [bx, by, bw, bh]: number[]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
const feetAt = ({ x, y }: { x: number; y: number }) => [x + 1, y + 12, 6, 3]

/**
 * Whether someone can walk from `from` to `to` over open floor only. (The route search itself
 * may squeeze through furniture into a snug spot, so this walks the grid strictly.)
 */
function reachable(layout: any, from: { x: number; y: number }, to: { x: number; y: number }, extra: number[][] = []) {
  const grid = walkGrid({ w: layout.artW, h: layout.building.h, wall: 4, size: 2, feet: { side: [1, 12, 6, 3], upright: [1, 12, 6, 3] }, blocks: [...loftGeometry.obstacles(layout), ...extra] })
  const open = (c: number) => grid.side[c] && grid.upright[c]
  const cell = (p: { x: number; y: number }) => Math.round(p.y / 2) * grid.W + Math.round(p.x / 2)
  const start = cell(from)
  const goal = cell(to)
  assert.ok(open(start) && open(goal), `${JSON.stringify(from)} or ${JSON.stringify(to)} is not on open floor`)
  const seen = new Uint8Array(grid.W * grid.H)
  const queue = [start]
  seen[start] = 1
  while (queue.length) {
    const c = queue.pop()!
    if (c === goal) return true
    const x = c % grid.W
    for (const n of [x > 0 ? c - 1 : -1, x < grid.W - 1 ? c + 1 : -1, c - grid.W, c + grid.W]) {
      if (n < 0 || n >= seen.length || seen[n] || !open(n)) continue
      seen[n] = 1
      queue.push(n)
    }
  }
  return false
}

test('without bots the loft is laid out exactly as before', () => {
  const floors = { a: [1, 2, 3, 4].map((n) => desk('a', n)), b: [desk('b', 1)] }
  for (const width of [330 * 3, LOFT_MIN_W * 3]) {
    const plan = (layout: any) => ({
      size: [layout.artW, layout.artH, layout.building, layout.lines, layout.teamCount, layout.coordinator],
      rooms: layout.rooms.map((r: any) => [r.x, r.y, r.w, r.h, r.name, r.head, r.drawers, r.islands.map((i: any) => [i.x, i.y, i.half, i.team])]),
      seats: layout.seats.map((s: any) => [s.key, s.x, s.y, s.cx, s.front, s.stools]),
      common: { ...layout.common, table: layout.common.table.length }
    })
    const before = layoutLoft(office(floors), width, 3, helpers)
    const after = layoutLoft(office(floors), width, 3, helpers, null, { list: [], coordinator: null })
    assert.deepEqual(plan(after), plan(before))
  }
})

test("a bot's desks sit in a room of its own, first, with the bot at the head of the island", () => {
  const rel = aBot('Release notes', [botDesk('Release notes', 'web', 1), botDesk('Release notes', 'docs', 2), botDesk('Release notes', 'docs', 3, true)])
  const layout = layoutLoft(office({ web: [1, 2, 3, 4].map((n) => desk('web', n)) }), 330 * 3, 3, helpers, null, { list: [rel], coordinator: null })
  const [first, ...rest] = layout.rooms
  assert.equal(first.name, 'Release notes')
  assert.equal(first.bot, rel)
  assert.ok(rest.every((r: any) => !r.bot), 'only the first room is a bot room')
  assert.equal(layout.teamCount, 1, 'a bot room is not a team')
  const isl = first.islands[0]
  assert.equal(first.islands.length, 1)
  assert.ok(isl.half && isl.bot === rel, 'three desks make a half island in the bot room')
  assert.deepEqual(layout.seats.filter((s: any) => s.room.bot === rel).map((s: any) => s.desk.repo), ['web', 'docs'])
  assert.ok(isl.cells.some((c: any) => c?.vacant && c.desk.repo === 'docs'), 'the sleeping desk keeps its place')
  // the head stands on its podium at the island's left end, inside the room
  const head = first.head
  assert.equal(head.bot, rel)
  assert.ok(head.x + 16 <= isl.x && head.x >= first.x, 'the podium stands beside the island, in the room')
  const blocks = loftGeometry.obstacles(layout)
  assert.ok(!blocks.some((b: number[]) => overlap(b, feetAt(layout.coordinator ? layout.coordinator.stops[0].at : { x: head.x + 2, y: head.y + 6 }))), 'there is room to stand in front of the podium')
})

test('a bot with no desks yet shows its room with only the bot at the head', () => {
  const triage = aBot('Triage')
  const layout = layoutLoft(office({ web: [desk('web', 1)] }), 330 * 3, 3, helpers, null, { list: [triage], coordinator: null })
  const room = layout.rooms[0]
  assert.equal(room.name, 'Triage')
  assert.equal(room.islands.length, 0)
  assert.ok(room.head && room.head.x >= room.x && room.head.y < room.y + room.h)
})

for (const [width, look] of [[330 * 3, 'wide'], [300 * 3, 'a narrower hangout'], [0, 'narrow']] as const)
test(`the coordinator has a room at the hangout's right end, its way in at the back, ${look}`, () => {
  const chief = aBot('Chief of Stack', [botDesk('Chief of Stack', 'web', 1)], 'watching')
  const rel = aBot('Release notes', [botDesk('Release notes', 'docs', 1)])
  const bots = { list: [chief, rel], coordinator: chief.id }
  const floors = { web: [1, 2, 3, 4].map((n) => desk('web', n)), api: [desk('api', 1)] }
  const layout = layoutLoft(office(floors), width || loftMinW({ heads: true, coordinator: true }) * 3, 3, helpers, null, bots)
  const c: any = layout.common
  const k = c.coord
  assert.ok(k, 'the hangout has the coordinator room')
  assert.equal(layout.coordinator.bot, chief)
  // its own desks still form an island in a room named after it, with nobody at the head
  const own = layout.rooms.find((r: any) => r.bot === chief)
  assert.ok(own && !own.head, "the coordinator's desks have a room without a head")
  assert.ok(layout.rooms.find((r: any) => r.bot === rel)?.head, 'another bot stands at its head')
  // it runs from the back curtain to the front, inside the hangout and the walls
  assert.equal(k.y, c.y)
  assert.equal(k.h, c.h)
  assert.ok(k.x >= c.x && k.x + k.w <= c.x + c.w && k.x + k.w <= layout.artW - 4)
  assert.equal(layout.lines.at(-1), c.y, 'its back curtain is the hangout bulkhead')
  // the hangout makes room: nothing of the hangout stands in the room
  const size: Record<string, number> = { booth: 20, fridge: 13, cooler: 7, plant: 9, tulip: 7, roundTable: 16, foosball: 28, coffeeTable: 24, barTable: 28, barStool: 7, tree: 15 }
  for (const t of c.things) assert.ok(t.x + (t.w ?? size[t.kind] ?? 0) <= k.x, `the ${t.kind} stands in the coordinator's room`)
  // its pieces never stand on each other or on the hangout's things
  const pieces = [
    [k.board.x, k.board.y + 16, 32, 7],
    [k.desk.x, k.desk.y + 3, 40, 8],
    ...k.stools.map((s: any) => [s.x, s.y + 2, 7, 4]),
    ...k.plants.map((p: any) => [p.x + 1, p.y + 10, 8, 5])
  ]
  pieces.forEach((a, i) => pieces.forEach((b, j) => i < j && assert.ok(!overlap(a, b), `pieces ${i} and ${j} of the room overlap`)))
  for (const piece of pieces) assert.ok(piece[0] >= k.in0 && piece[0] + piece[2] <= k.in1, 'a piece pokes through a curtain')
  // where it sits down, waits and stops are on open floor
  const blocks = loftGeometry.obstacles(layout)
  for (const spot of [k.home, k.entrance, ...layout.coordinator.stops.map((s: any) => s.at)]) {
    assert.ok(!blocks.some((b: number[]) => overlap(b, feetAt(spot))), `${JSON.stringify(spot)} is inside something`)
  }
  // its only way in is from the office floor above: from its desk out to the floor, never to the lounge
  const above = { x: layout.building.spineX + 12, y: c.y - 24 }
  assert.ok(reachable(layout, k.home, above), 'the coordinator cannot get out of its room')
  for (const spot of [...c.spots, c.foos[0]]) {
    assert.ok(reachable(layout, spot, above), `the ${spot.kind} spot is cut off from the floor`)
  }
  // and everyone on a break still has open floor to stand on
  for (const spot of [...c.spots, ...c.foos]) assert.ok(!blocks.some((b: number[]) => overlap(b, feetAt(spot))), `a ${spot.kind} spot is inside furniture`)
})

for (const [width, look] of [[330 * 3, 'wide'], [0, 'narrow']] as const)
test(`the coordinator's room keeps the lounge out: its only way in is the gap in the back curtain, ${look}`, () => {
  const chief = aBot('Chief of Stack', [], 'working')
  const layout = layoutLoft(office({ web: [desk('web', 1)], api: [desk('api', 1)] }), width || loftMinW({ coordinator: true }) * 3, 3, helpers, null, { list: [chief], coordinator: chief.id })
  const c: any = layout.common
  const k = c.coord
  const lounge = c.foos[0]
  assert.ok(reachable(layout, lounge, k.home), 'through the gap, round by the floor above, it can be reached')
  assert.ok(!reachable(layout, lounge, k.home, [[k.gap.x, c.y - 3, k.gap.w, 3]]), 'the lounge reaches the room some other way')
})

test('the narrowest loft still fits a bot room with its head and the coordinator room', () => {
  const chief = aBot('Chief of Stack', [], 'working')
  const rel = aBot('Release notes', [botDesk('Release notes', 'docs', 1)])
  const minW = loftMinW({ heads: true, coordinator: true })
  assert.ok(minW >= LOFT_MIN_W)
  const layout = layoutLoft(office({ web: [desk('web', 1)] }), minW * 3, 3, helpers, null, { list: [chief, rel], coordinator: chief.id })
  for (const room of layout.rooms) assert.ok(room.x >= 4 && room.x + room.w <= layout.artW - 4, `${room.name} pokes through a wall`)
  const head = layout.rooms[0].head
  assert.ok(head.x >= layout.rooms[0].x, 'the podium pokes out of its room')
  const c: any = layout.common
  const k = c.coord
  // on one column the room takes the walkway by the right wall, its way in the walkway's gap, and
  // the lounge gets a gap of its own beside it
  assert.equal(k.x + k.w, c.x + c.w)
  assert.ok(k.gap.x >= layout.building.spineX + 10, 'its way in is past the column')
  assert.ok(c.loungeGap && c.loungeGap.x + c.loungeGap.w <= k.x, 'the lounge has a gap of its own')
  for (const t of c.things) assert.ok(t.x + (t.w ?? 0) <= c.loungeGap.x, `the ${t.kind} stands under the lounge's gap`)
})

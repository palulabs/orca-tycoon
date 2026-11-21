// The loft: the office seen from the front and above, like a doll's house with the front
// wall taken off. One concrete hall: the far wall is a tall steel window onto the garden; every team
// sits in a room closed at the back by a navy curtain, rooms two side by side and open toward each
// other, and a curtain line with a column and a gap ends each row of rooms. The hangout fills the
// far end. Desks stand in fixed islands of six that stay put while seats empty and fill, and every
// sprite gets a dark outline from one extra pass in the painter.
//
// The panel keeps the mechanics (breaks, specialists coming and going, Palú, clicks); this file
// owns where things are and how they look.

import { C, XMAS, christmasTree, dimmed, festive, festiveHeadgear, glyph, holidayLights, look, lounger, roleColor, walker } from './sprites.js'

const INK = '#1d1b26'
export const OUTER = 4 // the side walls
const WALL = 68 // the window band across the top: two regular window bays
const SPINE = 24 // a column and the walkway beside it, where the curtain lines open
// Furniture is sized to the people: a monitor about one and a half shoulders wide, a desk wide
// enough for its agent and a specialist on a stool at either side.
const IW = 36 // one desk of an island, across
const ID = 18 // one desk of an island, deep
const HALF = IW / 2
const MON = 16 // a monitor, across
const MON_X = (IW - MON) / 2
const ISL_W = IW * 3
const ISL_PITCH = 76 // from one island to the next one down
const ROOM_PAD = 6
const ROOM_MIN = ISL_W + ROOM_PAD * 2
/** Narrower than this and not even one room fits beside the walkway. */
export const LOFT_MIN_W = ROOM_MIN + SPINE + OUTER * 2 + 4
// A bot stands at the head of its island, on a podium at the island's left end.
const HEAD_W = 20
const PODIUM_W = 16
const BOT_ROOM_MIN = ROOM_MIN + HEAD_W - ROOM_PAD
// The coordinator's room at the right end of the hangout, its curtain included.
const COORD_W = 64
const COORD_WIDE = 236 // the wide hangout still fits beside the coordinator's room down to this

/**
 * The narrowest the loft is drawn with these bots in it: a bot room needs floor for its head, and
 * the coordinator's room needs the hangout to make room for it.
 */
export function loftMinW({ heads = false, coordinator = false } = {}) {
  const rooms = (heads ? BOT_ROOM_MIN : ROOM_MIN) + SPINE + OUTER * 2 + 4
  // the stacked hangout needs 96 across for its furniture, a way down from the floor beside it
  // and the room
  return coordinator ? Math.max(rooms, 96 + 26 + COORD_W + OUTER * 2 + 4) : rooms
}
const HANG_WIDE = 270 // the hangout spreads out from this width, else it stacks
// Fill order inside an island: the front row first, its screens face you; then the back row.
const FILL = [3, 4, 5, 0, 1, 2]
const NAVY = ['#3c516d', '#4a6283', '#5b7597', '#33465f']
const LIGHT = { working: '#4be08f', monitoring: '#73b3ff', waiting: '#f6b23c', blocked: '#ff5468', done: '#3c4660', idle: '#3c4660' }

// ---- painting -----------------------------------------------------------------------------------

/** Draws the rectangles `draw` paints with a one-pixel ink outline around every solid one. */
function ol(p, draw) {
  const rects = []
  draw((x, y, w, h, c) => rects.push([x, y, w, h, c]))
  for (const [x, y, w, h, c] of rects) if (c[0] === '#') p(x - 1, y - 1, w + 2, h + 2, INK)
  for (const [x, y, w, h, c] of rects) p(x, y, w, h, c)
}
const at = (p, ox, oy) => (x, y, w, h, c) => p(ox + x, oy + y, w, h, c)
/** Mirrors left and right around the vertical line x = `mid`. */
const flip = (p, mid) => (x, y, w, h, c) => p(2 * mid - x - w, y, w, h, c)
const shadow = (p, x, y, w, h) => p(x, y, w, h, 'rgba(25,22,45,0.20)')

function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  n ^= n >>> 13
  n = Math.imul(n, 0xc2b2ae35)
  return (n ^ (n >>> 16)) >>> 0
}
function hashText(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return hash(h)
}

// ---- desks that stay put ----------------------------------------------------------------------
// Every worktree of a team owns a desk, one per agent when it runs several, and keeps it while it
// sleeps: an empty chair with its nameplate. Desks fill in order, the front row of an island first;
// a desk keeps its place until its worktree goes, and nobody moves up. A new worktree takes the
// first free desk, or the one beside the previous desk of its family when that one is free, so a
// stack of worktrees still reads as one line.

const slotMemory = new Map() // repo -> Map(desk key -> fill index)

function assignSlots(floor, { families }) {
  const order = []
  families(floor.desks).forEach((family, fam) => {
    for (const desk of family) {
      const staff = [...desk.staff].sort((a, b) => a.id.localeCompare(b.id))
      for (let i = 0; i < Math.max(1, staff.length); i++) order.push({ desk, staff: staff[i] ?? null, fam, unit: `${desk.id}#${i}` })
    }
  })
  const memory = slotMemory.get(floor.repo) ?? new Map()
  slotMemory.set(floor.repo, memory)
  const live = new Set(order.map((u) => u.unit))
  for (const key of memory.keys()) if (!live.has(key)) memory.delete(key)
  const used = new Set(memory.values())
  order.forEach((u, i) => {
    if (memory.has(u.unit)) return
    let n = null
    const prev = order[i - 1]
    if (prev && prev.fam === u.fam && memory.has(prev.unit)) {
      const s = memory.get(prev.unit)
      if (s % 3 !== 2 && !used.has(s + 1)) n = s + 1
    }
    for (let k = 0; n === null; k++) if (!used.has(k)) n = k
    memory.set(u.unit, n)
    used.add(n)
  })
  return order.map((u) => ({ ...u, n: memory.get(u.unit) }))
}

// ---- layout ---------------------------------------------------------------------------------

const FULL_BLOCK = 80 // a full island and the floor around it, in a room
const HALF_BLOCK = 58 // a half island (one row of three) with its team's name over it

/**
 * The office at one scale. A team of up to three desks gets half an island, a bigger one full
 * islands of six; two small teams share a room. Rooms go two to a row when the floor is wide
 * enough, else one; each row of rooms ends in a curtain line; the hangout sits halfway.
 *
 * `bots` is `{ list, coordinator }`: the bots on the floor and the id of the one picked as the
 * coordinator, or null. Each bot gets a room of its own, ordered first, its desks at one island
 * like a team's and the bot at the island's head; the coordinator has a room in the hangout
 * instead, and only its desks get an island, with nobody at the head.
 */
export function layoutLoft(snapshot, cssW, scale, helpers, targetH = null, bots = null) {
  const shownBots = bots?.list ?? []
  const coordBot = shownBots.find((b) => b.id === bots?.coordinator) ?? null
  const heads = shownBots.some((b) => b !== coordBot)
  const artW = Math.max(loftMinW({ heads, coordinator: Boolean(coordBot) }), Math.floor(cssW / scale))
  const x0 = OUTER + 2
  const floorW = artW - OUTER * 2 - 4
  const cols = floorW >= (heads ? BOT_ROOM_MIN : ROOM_MIN) * 2 + SPINE ? 2 : 1
  const colW = Math.floor((floorW - SPINE) / cols)
  const spineX = x0 + colW
  const colX = [x0, spineX + SPINE]
  const perRowOf = (head) => Math.max(1, Math.floor((colW - ROOM_PAD * 2 - (head ? HEAD_W : 0) + 8) / (ISL_W + 8)))

  const busy = (floor) => floor.desks.some((d) => d.staff.length > 0)
  const teamOf = (floor, memoryKey = floor.repo, bot = null, head = false) => {
    const units = floor.desks.length ? assignSlots(memoryKey === floor.repo ? floor : { ...floor, repo: memoryKey }, helpers) : []
    const last = Math.max(0, ...units.map((u) => u.n))
    const half = last < 3
    const islands = half ? 1 : Math.ceil((last + 1) / 6)
    const rows = half ? 1 : Math.ceil(islands / perRowOf(head))
    return { floor, units, half, islands, rows, h: half ? HALF_BLOCK : rows * FULL_BLOCK, bot, head }
  }
  const teams = (snapshot?.floors ?? [])
    .filter(busy)
    .map((floor) => teamOf(floor))
    .sort((a, b) => b.units.length - a.units.length || a.floor.repo.localeCompare(b.floor.repo))
  // a bot's room: its desks, named after it; the coordinator's only when it runs desks
  const botTeams = shownBots
    .filter((bot) => bot !== coordBot || bot.desks.length)
    .map((bot) => teamOf({ repo: bot.name, desks: bot.desks }, `\u0000bot|${bot.id}`, bot, bot !== coordBot))

  // Rooms: a bot's first, one each; then a big team has one to itself; small teams pair up.
  const roomPlans = botTeams.map((t) => [t])
  const small = []
  for (const team of teams) (team.half ? small : roomPlans).push([team])
  for (let i = 0; i < small.length; i += 2) roomPlans.push(small.slice(i, i + 2).map((t) => t[0]))
  const contentH = (plan) => plan.reduce((n, t) => n + t.h, 0)

  // Rows of rooms. When the panel is taller than the natural floor plan, the extra height is
  // distributed across these rows so each office can center its workstations vertically.
  const bands = []
  for (let b = 0; b < roomPlans.length; b += cols) {
    const band = roomPlans.slice(b, b + cols)
    bands.push({ band, h: 26 + Math.max(...band.map(contentH)) })
  }
  const naturalWorkH = bands.reduce((sum, band) => sum + band.h, 0)
  // on one column the walkway by the right wall is where the coordinator's room goes
  const oneCol = cols === 1 ? spineX : null
  const naturalCommon = hangout(x0, WALL + naturalWorkH + 8, floorW, Boolean(coordBot), oneCol)
  const naturalH = naturalCommon.y + naturalCommon.h + 6
  const extraWorkH = Math.max(0, (targetH ?? naturalH) - naturalH)
  const perBand = bands.length ? Math.floor(extraWorkH / bands.length) : 0
  const remainder = bands.length ? extraWorkH % bands.length : 0
  bands.forEach((band, i) => {
    band.h += perBand + (i < remainder ? 1 : 0)
  })
  const rooms = []
  const seats = []
  const lines = [] // curtain lines: the floor row each one stands on
  let common = null
  let top = WALL
  // The work deck occupies the upper part of the Loft. The leisure module is always last, so the
  // window, workstation bays and commons read as a single top-to-bottom composition.
  for (let b = 0; b < bands.length; b++) {
    const bottom = top + bands[b].h
    bands[b].band.forEach((plan, c) => {
      const room = { x: colX[c], y: top, w: colW, h: bottom - top, name: plan.map((t) => t.floor.repo).join(' · '), first: top === WALL, islands: [] }
      const contentOffset = Math.floor((room.h - (26 + contentH(plan))) / 2)
      let cursor = top + contentOffset
      for (const team of plan) {
        const ref = { name: team.floor.repo }
        if (team.bot) {
          ref.bot = team.bot
          room.bot = team.bot
        }
        const head = team.head ? HEAD_W : 0
        const isles = []
        if (team.half) {
          const ix = room.x + Math.floor((colW - ISL_W - head) / 2) + head
          if (team.units.length) isles.push({ x: ix, y: cursor + 14, half: true, cells: Array(3).fill(null), team: plan.length > 1 ? team.floor.repo : null })
          // the head stands on its podium at the island's left end, level with the chairs
          if (team.head) room.head = { bot: team.bot, x: ix - head + 2, y: cursor + 14 + 22 }
        } else {
          const perRow = perRowOf(team.head)
          for (let i = 0; i < team.islands; i++) {
            const row = Math.floor(i / perRow)
            const inRow = Math.min(perRow, team.islands - row * perRow)
            const rowW = inRow * ISL_W + (inRow - 1) * 8
            const ix = room.x + Math.floor((colW - rowW - head) / 2) + head + (i % perRow) * (ISL_W + 8)
            isles.push({ x: ix, y: cursor + 22 + row * FULL_BLOCK, half: false, cells: Array(6).fill(null), team: null })
          }
          if (team.head) room.head = { bot: team.bot, x: isles[0].x - head + 2, y: isles[0].y + ID + 22 }
        }
        if (team.bot) for (const isl of isles) isl.bot = team.bot
        room.islands.push(...isles)
        for (const u of team.units) {
          const island = team.half ? isles[0] : isles[Math.floor(u.n / 6)]
          const cell = team.half ? u.n : FILL[u.n % 6]
          const front = team.half || cell >= 3
          const row0 = team.half ? 0 : ID
          const cx = island.x + (cell % 3) * IW + HALF
          const iy = island.y
          if (!u.staff) {
            island.cells[cell] = { vacant: true, key: u.unit, desk: u.desk, label: u.desk.label || u.desk.name, front, cx, island, row0 }
            continue
          }
          const sy = front ? iy + row0 + 8 : iy - 22
          const seat = {
            key: `${u.desk.id}|${u.staff.id}`,
            // the desk's own key: its mat and things stay the same whether it sleeps or works
            unit: u.unit,
            slot: u.n,
            desk: u.desk,
            staff: u.staff,
            room: ref,
            island,
            front,
            row0,
            cx,
            // the box the panel's shared code reads, roughly where the agent is
            x: cx - 10,
            y: front ? iy + row0 - 4 : iy - 18,
            stools: [
              // a clear step from the chair, so the specialist sits beside the agent, not on them
              { x: cx + 9, y: sy },
              { x: cx - 17, y: sy, flip: true }
            ],
            overflow: Math.max(0, helpers.activeSpecialists(u.staff).length - 2)
          }
          island.cells[cell] = seat
          seats.push(seat)
        }
        cursor += team.h
      }
      room.drawers = drawerBlocks(room)
      rooms.push(room)
    })
    lines.push(bottom)
    top = bottom
  }
  common = hangout(x0, top + 8, floorW, Boolean(coordBot), oneCol)
  let h = common.y + common.h + 6
  // The last curtain is the leisure area's own bulkhead. Keep it attached to the module when the
  // module docks to the bottom of a tall panel; the earlier lines remain workstation separators.
  if (lines.length) lines[lines.length - 1] = common.y
  else if (coordBot) lines.push(common.y) // the coordinator's room needs its back curtain
  const building = { w: artW, h, doorY: common.doorY, x0, floorW, spineX, cols }
  const coordinator = coordBot ? coordinatorPlan(coordBot, common.coord, rooms) : null
  return { theme: 'loft', artW, artH: h, scale, building, rooms, seats, common, lines, teamCount: teams.length, coordinator }
}

/**
 * Where the coordinator sits, waits and walks: its chair behind the desk, the gap in its back
 * curtain, and a stop at the head of every other bot's island. The panel adds the desks that need
 * you, which change between polls.
 */
function coordinatorPlan(bot, room, rooms) {
  // it stands in front of the podium, low enough that what it says leaves the bot on it in view
  const stops = rooms.filter((r) => r.head).map((r) => ({ at: { x: r.head.x + 2, y: r.head.y + 14 }, say: `Checking on ${r.head.bot.name}` }))
  return { bot, room, home: room.home, entrance: room.entrance, stops }
}

const DRAWER_W = 12

/**
 * The yellow drawer blocks: one in a room's back corner, against the curtain or the window, when the
 * corner has room beside the islands. Which corners get one, how tall, and what stands on top comes
 * from the room's name, so a room keeps its look.
 */
function drawerBlocks(room) {
  const left = Math.min(...room.islands.map((i) => i.x), ...(room.head ? [room.head.x - 2] : []))
  const right = Math.max(...room.islands.map((i) => i.x + ISL_W), ...(room.head ? [room.head.x + PODIUM_W] : []))
  const spots = []
  if (left - room.x >= DRAWER_W + 2) spots.push(room.x + 1)
  if (room.x + room.w - right >= DRAWER_W + 2) spots.push(room.x + room.w - DRAWER_W - 1)
  return spots
    .map((x, i) => ({ x, roll: hashText(`${room.name}|drawer|${i}`) }))
    .filter(({ roll }) => roll % 100 < 60)
    .map(({ x, roll }) => ({ x, base: room.y + 24, h: roll % 3 === 0 ? 22 : 30, top: [null, 'retro', 'plant', 'books'][(roll >>> 8) % 4] }))
}

/** The hangout: phone booths, the coffee corner, the sofa on the pink rug, foosball, a bar. */
const HANG_MAX = 330 // wider than this, the hangout keeps its size in the middle of the floor

function hangout(fx, y, fw, coord = false, spine = null) {
  const w = Math.min(fw, HANG_MAX)
  const x = fx + Math.floor((fw - w) / 2)
  const full = x + w
  // the coordinator's room takes the right end; the furniture lays itself out in what is left
  const R = coord ? full - COORD_W : full
  const c = { x, y, w, things: [] }
  const add = (kind, props) => {
    const thing = { kind, ...props }
    c.things.push(thing)
    return thing
  }
  const wide = coord ? R - x >= COORD_WIDE : w >= HANG_WIDE
  if (wide) {
    c.h = 104
    const booths = [add('booth', { x: x + 4, floor: y + 50 }), add('booth', { x: x + 27, floor: y + 50 })]
    // beside the coordinator's room the kitchen gets shorter
    const counterW = Math.max(56, Math.min(80, 80 - (HANG_WIDE - (R - x))))
    const counter = add('counter', { x: R - 30 - counterW, y: y + 6, w: counterW })
    add('fridge', { x: R - 28, floor: y + 21 })
    add('cooler', { x: counter.x - 10, floor: y + 22 })
    const rug = add('rug', { x: x + 56, y: y + 18, w: Math.min(124, w - 166), h: 74 })
    const sofa = add('sofa', { x: rug.x + 16, y: rug.y + 4, w: Math.max(40, rug.w - 68) })
    add('coffeeTable', { x: sofa.x + Math.floor(sofa.w / 2) - 12, y: rug.y + 24 })
    const chairs = tableGroup(add, rug.x + rug.w - 48, y + 56)
    const foos = add('foosball', { x: R - 120, y: y + 50 })
    add('tree', { x: R - 82, y: y + 47 }) // in season, between the foosball and the high table
    add('barStool', { x: R - 60, y: y + 54 })
    add('barStool', { x: R - 14, y: y + 54 })
    add('barTable', { x: R - 48, y: y + 48 })
    add('barStool', { x: R - 45, y: y + 62 })
    add('barStool', { x: R - 29, y: y + 62 })
    add('plant', { x: rug.x + 2, y: y + 2 })
    add('plant', { x: R - 22, y: y + 86 })
    c.bed = { x: x + 20, y: y + 86 }
    c.bowls = { x: x + 4, y: y + 91 }
    c.doorY = y + 56
    finish(c, { booths, counter, sofa, foos, chairs })
    if (coord) c.coord = coordinatorRoom(R, y, c.h, full < fx + fw - 1)
  } else {
    // The right edge stays clear: it lines up with the gaps in the curtain lines, so people walk
    // straight down from their rooms. Booth, fridge and counter stand against the curtain, the
    // sofa corner below them, foosball and Palú's corner below that.
    c.h = 140
    // With the coordinator on one column, its room takes the walkway under the curtain's gap by
    // the right wall, and the lounge gets a gap of its own beside the room. On two columns the
    // room stands just left of the walkway.
    const corner = coord && spine !== null
    const clear = corner ? full - COORD_W - 26 : full - 34 - (coord ? COORD_W : 0)
    const booths = [add('booth', { x: x + 4, floor: y + 46 })]
    add('fridge', { x: x + 28, floor: y + 21 })
    add('cooler', { x: x + 44, floor: y + 22 })
    const counter = add('counter', { x: x + 54, y: y + 6, w: Math.max(30, clear - 12 - (x + 54)) })
    add('plant', { x: clear - 10, y: y + 6 })
    const rug = add('rug', { x: x + 4, y: y + 52, w: clear - x - 4, h: 38 })
    const sofaW = Math.max(40, Math.min(56, rug.w - 58))
    const sofa = add('sofa', { x: rug.x + 6, y: rug.y + 4, w: sofaW })
    add('coffeeTable', { x: sofa.x + Math.floor(sofa.w / 2) - 12, y: rug.y + 24 })
    const chairs = tableGroup(add, rug.x + rug.w - 40, rug.y + 2)
    // the last row: foosball, Palú's corner, and the high table with its stools when it fits
    const foos = add('foosball', { x: x + 12, y: y + 112 })
    c.bed = { x: x + 50, y: y + 118 }
    c.bowls = { x: x + 52, y: y + 108 }
    if (clear - (x + 80) >= 50) {
      const bx = clear - 40
      add('barStool', { x: bx - 10, y: y + 104 })
      add('barStool', { x: bx + 33, y: y + 104 })
      add('barTable', { x: bx + 2, y: y + 98 })
      add('barStool', { x: bx + 5, y: y + 112 })
      add('barStool', { x: bx + 21, y: y + 112 })
    }
    // in season, the tree stands between Palú's corner and the high table, or the right edge
    const treeL = x + 76
    const treeR = clear - (x + 80) >= 50 ? clear - 50 : clear
    if (treeR - treeL >= 17) add('tree', { x: Math.round((treeL + treeR) / 2) - 7, y: y + 97 })
    c.doorY = y + 94
    finish(c, { booths, counter, sofa, foos, chairs })
    if (corner) {
      c.coord = coordinatorRoom(full - COORD_W, y, c.h, false, spine)
      c.loungeGap = { x: full - COORD_W - 22, w: 18 }
    } else if (coord) c.coord = coordinatorRoom(clear, y, c.h, true)
  }
  return c
}

/**
 * The coordinator's room, `COORD_W` wide from `rx`, from the hangout's back curtain to the
 * front: a curtain down its left side closes it off from the lounge (and one down its right side
 * when the floor goes on past it), so its only way in is a gap in the back curtain at its right.
 * Inside, on a navy rug: the floor map on a stand, a big desk with a terminal, two stools for
 * visitors and two plants.
 */
function coordinatorRoom(rx, y, h, rightCurtain, spine = null) {
  const in0 = rx + 5
  const in1 = rx + COORD_W - (rightCurtain ? 5 : 0)
  const iw = in1 - in0
  const desk = { x: in0 + Math.floor((iw - 40) / 2), y: y + Math.round(h * 0.6) }
  // its way in: a gap of its own in the back curtain, or, by the right wall, the walkway's gap
  // past the column
  const gap = spine === null ? { x: in1 - 20, w: 18, own: true } : { x: spine + 10, w: in1 - spine - 10, own: false }
  return {
    x: rx,
    y,
    w: COORD_W,
    h,
    in0,
    in1,
    rightCurtain,
    gap,
    // its sign hangs on the back curtain over its way in, like a sign over a door; by the right
    // wall it stops short of the column
    signMax: (spine === null ? in1 : spine) - 2 - (in0 + 2),
    rug: { x: in0 + 2, y: y + 30, w: iw - 4, h: h - 34 },
    board: { x: in0 + 2, y: y + 4 },
    desk,
    stools: [
      { x: desk.x + 6, y: desk.y + 18 },
      { x: desk.x + 27, y: desk.y + 18 }
    ],
    plants: [
      { x: in0 + 1, y: y + h - 17 },
      { x: in1 - 10, y: y + h - 17 }
    ],
    // where it sits behind its desk, where it stands to sit down, and where it waits for you
    seat: { x: desk.x + 14, y: desk.y - 12 },
    home: { x: desk.x + 16, y: desk.y - 15 },
    entrance: { x: gap.x + Math.min(5, gap.w - 11), y: y + 4 }
  }
}

/** The round white table with four tulip chairs: two behind it facing you, two in front. */
function tableGroup(add, tx, ty) {
  const chairs = [add('tulip', { x: tx, y: ty, facing: true }), add('tulip', { x: tx + 28, y: ty, facing: true })]
  add('roundTable', { x: tx + 8, y: ty + 12 })
  chairs.push(add('tulip', { x: tx - 4, y: ty + 22, facing: false }), add('tulip', { x: tx + 32, y: ty + 22, facing: false }))
  return chairs
}

/** The spots people take on a break, in the pools the panel hands out. */
function finish(c, { booths, counter, sofa, foos, chairs }) {
  // a seat at the table for a chat: stand by the chair, then sit down on it
  c.table = chairs.map((chair) => ({ x: chair.x, y: chair.y - 4, kind: 'table', chair, left: chair.x > chairs[0].x + 10 }))
  c.booths = booths.map((b) => ({ x: b.x + 6, y: b.floor - 19, kind: 'booth', left: true, bx: b.x, floor: b.floor }))
  c.spots = []
  for (let sx = counter.x + 14; sx + 8 <= counter.x + counter.w; sx += 9) c.spots.push({ x: sx, y: counter.y + 5, kind: 'coffee' })
  c.sofa = []
  for (let i = 0; i < Math.floor((sofa.w - 6) / 10); i++) c.sofa.push({ x: sofa.x + 3 + i * 10, y: sofa.y - 3, kind: 'lounge', sofa })
  c.foos = [
    { x: foos.x + 10, y: foos.y - 16, kind: 'foosball', left: false, back: false },
    { x: foos.x + 10, y: foos.y + 20, kind: 'foosball', left: false, back: true }
  ]
  // Palú wanders along the hangout's last row
  c.laneTop = c.y + c.h - 30
  c.laneBottom = c.y + c.h - 22
}

// ---- where people stand, for the panel's walking ------------------------------------------------

export const loftGeometry = {
  /** Where an agent stands when it gets up: just behind or in front of its chair. */
  homeOf(seat) {
    return seat.front ? { x: seat.cx - 4, y: seat.island.y + seat.row0 + 25 } : { x: seat.cx - 4, y: seat.island.y - 32 }
  },
  /** The aisle spot before a stool, and the stool itself. */
  stoolStops(seat, stool) {
    const aisle = seat.front ? seat.island.y + seat.row0 + 25 : seat.island.y - 32
    return { aisle: { x: stool.x, y: aisle }, on: { x: stool.x, y: stool.y + 3 } }
  },
  /** Palú naps on the floor just in front of a front-row chair. */
  paluDeskSpot(seat) {
    return { x: seat.cx - 9, y: seat.island.y + seat.row0 + 37 }
  },
  visitable: (seat) => seat.front,
  /** The box that is this seat, for clicks and the selection frame. */
  seatBox(seat) {
    return seat.front ? [seat.cx - 9, seat.island.y + seat.row0 - 4, 18, 37] : [seat.cx - 9, seat.island.y - 18, 18, 28]
  },
  seatAnchor(seat) {
    return seat.front ? { x: seat.cx, y: seat.island.y + seat.row0 + 9 } : { x: seat.cx, y: seat.island.y - 16 }
  },
  /** Floor that nobody walks through: [x, y, w, h]. */
  obstacles(layout) {
    const { artW, building: b } = layout
    const boxes = [[0, 0, artW, WALL + 2]]
    for (const room of layout.rooms) for (const isl of room.islands) boxes.push(isl.half ? [isl.x - 8, isl.y - 6, ISL_W + 16, 42] : [isl.x - 8, isl.y - 10, ISL_W + 16, ID + 46])
    for (const line of layout.lines) {
      boxes.push(...curtainSegments(layout, line).map(([sx, w]) => [sx, line - 3, w, 3]))
      boxes.push([b.spineX, line - 4, 10, 5])
    }
    for (const room of layout.rooms) if (room.head) boxes.push([room.head.x - 1, room.head.y - 1, PODIUM_W + 2, 7])
    const k = layout.common.coord
    if (k) {
      // down to the bottom wall, so nobody slips round its foot
      boxes.push([k.x, k.y - 3, 5, k.h + 12])
      if (k.rightCurtain) boxes.push([k.in1, k.y - 3, 5, k.h + 12])
      boxes.push([k.board.x, k.board.y + 16, 32, 7], [k.desk.x, k.desk.y + 3, 40, 8])
      for (const s of k.stools) boxes.push([s.x, s.y + 2, 7, 4])
      for (const pl of k.plants) boxes.push([pl.x + 1, pl.y + 10, 8, 5])
    }
    const c = layout.common
    for (const t of c.things) {
      const box = footprint(t)
      if (box) boxes.push(box)
    }
    boxes.push([c.bowls.x, c.bowls.y + 1, 13, 3])
    for (const room of layout.rooms) for (const d of room.drawers ?? []) boxes.push([d.x, d.base - 6, DRAWER_W, 6])
    return boxes
  },
  /** Places worth a sniff for Palú: where he stands with his nose to them. */
  sniffSpots(layout) {
    const fromRight = (x, base) => ({ x, y: base - 9, left: true })
    const fromLeft = (x, base) => ({ x: x - 18, y: base - 9, left: false })
    const spots = []
    for (const line of layout.lines) spots.push(fromLeft(layout.building.spineX, line + 3))
    for (const t of layout.common.things) {
      if (t.kind === 'plant') spots.push(fromRight(t.x + 9, t.y + 15))
      else if (t.kind === 'sofa') spots.push(fromLeft(t.x - 3, t.y + 13), fromRight(t.x + t.w + 3, t.y + 13))
      else if (t.kind === 'foosball') spots.push(fromLeft(t.x, t.y + 18), fromRight(t.x + 28, t.y + 18))
      else if (t.kind === 'cooler' || t.kind === 'fridge') spots.push(fromLeft(t.x, t.floor))
      else if (t.kind === 'booth') spots.push(fromRight(t.x + 20, t.floor))
    }
    return spots
  }
}

function curtainSegments(layout, line = null) {
  const { x0, floorW, spineX } = layout.building
  const segments = [
    [x0 - 2, spineX - x0 + 2],
    [spineX + SPINE, x0 + floorW - spineX - SPINE + 2]
  ].filter(([, w]) => w > 0)
  // the hangout's back curtain opens onto the coordinator's room at the room's right side, and
  // onto the lounge beside the room when the room took the walkway
  const gaps = line !== null && line === layout.common?.y ? curtainGaps(layout.common) : []
  return gaps
    .reduce(
      (list, gap) =>
        list.flatMap(([sx, w]) => {
          const end = sx + w
          if (gap.x >= end || gap.x + gap.w <= sx) return [[sx, w]]
          return [
            [sx, gap.x - sx],
            [gap.x + gap.w, end - gap.x - gap.w]
          ]
        }),
      segments
    )
    .filter(([, w]) => w > 0)
}

/** The gaps the hangout's back curtain has beyond the walkway's: the coordinator's and the lounge's. */
function curtainGaps(c) {
  return [c.coord?.gap.own ? c.coord.gap : null, c.loungeGap ?? null].filter(Boolean)
}

/** The floor a piece of hangout furniture stands on. */
function footprint(t) {
  switch (t.kind) {
    case 'booth':
      return [t.x, t.floor - 8, 20, 8]
    case 'counter':
      return [t.x, t.y + 6, t.w, 9]
    case 'fridge':
      return [t.x, t.floor - 6, 13, 6]
    case 'cooler':
      return [t.x, t.floor - 5, 7, 5]
    case 'sofa':
      return [t.x - 3, t.y + 4, t.w + 6, 9]
    case 'coffeeTable':
      return [t.x, t.y + 2, 24, 6]
    case 'roundTable':
      return [t.x, t.y + 6, 16, 5]
    case 'tulip':
      return [t.x, t.y + 7, 7, 4]
    case 'foosball':
      return [t.x, t.y + 6, 28, 12]
    case 'barTable':
      return [t.x, t.y + 14, 28, 6]
    case 'barStool':
      return [t.x, t.y + 10, 7, 4]
    case 'plant':
      return [t.x + 1, t.y + 10, 8, 5]
    case 'tree':
      return festive() ? [t.x + 2, t.y + 17, 11, 4] : null
    default:
      return null
  }
}

// ---- the desk mats ------------------------------------------------------------------------------
// Every mat has the colours of the real one, cream, sage, pink and purple, in a pattern of its own,
// picked from the seat's key so a desk keeps its mat. Each mat is painted once into a little canvas.

const MAT = ['#f4eedf', '#c9d3b8', '#ea9c90', '#7b4a78']
const PATTERNS = {
  waves(i, j, k) {
    if ((i > k.w - 7 && j < 3) || (i < 6 && j > k.h - 4)) return 3
    const v = j + k.amp * Math.sin(i / k.f + k.ph) - i / 14
    return v < 1.5 ? 0 : v < 3.5 ? 1 : v < 5.6 ? 2 : 0
  },
  hills(i, j, k) {
    const top = k.h - 2 - k.amp * Math.abs(Math.sin(i / k.f + k.ph)) * 1.6
    const back = k.h - 4 - k.amp * Math.abs(Math.sin(i / (k.f * 1.7) + k.ph * 2))
    return j > top ? 2 : j > back ? 1 : (i * 7 + j * 3) % 23 === 0 ? 3 : 0
  },
  stripes(i, j, k) {
    return Math.floor((i + j * 2 + k.ph * 9) / k.f) % 3 === 0 ? 1 + (Math.floor((i + j * 2) / (k.f * 3)) % 3) : 0
  },
  terrazzo(i, j, k) {
    const h = hash(i * 131 + j * 977 + Math.round(k.ph * 100))
    return h % 9 === 0 ? 1 + ((h >>> 8) % 3) : 0
  },
  sun(i, j, k) {
    const d = Math.hypot(i - (k.ph > 3 ? k.w : 0), j - k.h) / (k.f * 0.7)
    return d < 1 ? 3 : d < 2 ? 2 : d < 3 ? 1 : 0
  },
  blobs(i, j, k) {
    const a = Math.hypot(i - k.w * 0.25, (j - 3) * 2) < k.f + 2
    const b = Math.hypot(i - k.w * 0.7, (j - 6) * 2) < k.f + 4
    return a && b ? 3 : a ? 1 : b ? 2 : 0
  }
}
const mats = new Map()

function mat(key, w, h) {
  const id = `${key}|${w}|${h}`
  let canvas = mats.get(id)
  if (canvas) {
    // the latest used last, so the one to go is the one off screen the longest
    mats.delete(id)
    mats.set(id, canvas)
    return canvas
  }
  let s = hashText(key) || 1
  const r = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  const names = Object.keys(PATTERNS)
  const pattern = PATTERNS[names[Math.floor(r() * names.length)]]
  const k = { amp: 1.6 + r() * 2, f: 3.5 + r() * 4, ph: r() * 6, w, h }
  canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      g.fillStyle = MAT[pattern(i, j, k)]
      g.fillRect(i, j, 1, 1)
    }
  }
  // Only the desks on screen are drawn, far fewer than this, so a big office never repaints its
  // mats every frame the way clearing them all did once it had more desks than the cache held.
  if (mats.size >= 400) mats.delete(mats.keys().next().value)
  mats.set(id, canvas)
  return canvas
}

// ---- monitors and people ----------------------------------------------------------------------

/** A screen's contents by state; `light` is a pale editor theme, some desks have one. */
function screen(p, x, y, w, h, state, t, light) {
  p(x, y, w, h, light ? '#f4f1e6' : '#121722')
  if (state === 'working') {
    if (light) {
      p(x, y, 3, h, '#e2dccb')
      p(x + w - 5, y, 5, h, '#c9a56a')
    }
    const cols = light ? ['#3c4660', '#7b5bb5', '#2f8f6a'] : [C.green, C.blue, C.amber]
    const inner = w - (light ? 10 : 3)
    for (let line = 0; line < h - 1; line += 2) {
      const len = 2 + ((t + line * 3) % Math.max(1, inner - 2))
      p(x + (light ? 4 : 2) + ((line >> 1) % 3 === 1 ? 2 : 0), y + 1 + line, Math.max(1, Math.min(len, inner - 2)), 1, cols[((line >> 1) + (t >> 2)) % 3])
    }
  } else if (state === 'waiting') {
    p(x, y, w, h, '#3a2a10')
    if ((t >> 2) % 2) glyph(p, '?', x + (w >> 1) - 1, y + (h >> 1) - 2, C.amber)
  } else if (state === 'blocked') {
    p(x, y, w, h, (t >> 1) % 2 ? C.red : '#8a2232')
    glyph(p, '!', x + (w >> 1) - 1, y + (h >> 1) - 2, C.white)
  } else if (state === 'done' || state === 'idle') {
    p(x + (t % (w - 2)) + 1, y + 1 + ((t >> 3) % (h - 2)), 1, 1, '#3c4660')
  } else if (state === 'monitoring') {
    p(x + 2, y + (h >> 1), w - 4, 1, '#36354a')
    p(x + 2, y + (h >> 1), t % (w - 4), 1, C.green)
  }
}

/** A front-row monitor, facing you on its riser: a title bar for the nameplate over the screen. */
function monitorFront(p, x, y, seat, t) {
  const remote = Boolean(seat?.desk.environment)
  ol(p, (q) => {
    q(x + 3, y + 10, MON - 6, 3, '#e0533f')
    q(x + 3, y + 10, MON - 6, 1, '#ef6a55')
    q(x + 5, y + 11, MON - 10, 1, '#e5c38f')
    q(x, y, MON, 10, remote ? C.thinFrame : '#23212b')
  })
  p(x + 1, y + 1, MON - 2, 2, seat ? '#2f3a52' : '#1b1f2a')
  const light = seat ? hashText(seat.key) % 5 < 2 : false
  screen(p, x + 1, y + 3, MON - 2, 6, seat ? seat.staff.state : 'off', t, light)
}

/** The back of a back-row monitor: a plain panel, a status light, room for the nameplate. */
function monitorBack(p, x, y, seat, t) {
  const s = seat ? seat.staff.state : 'off'
  ol(p, (q) => {
    q(x + MON / 2 - 1, y + 8, 2, 2, '#4b4a5e')
    q(x, y, MON, 8, seat?.desk.environment ? '#8e92a6' : '#3a3946')
    q(x, y, MON, 1, '#4f4e5e')
  })
  const blink = s === 'waiting' ? (t >> 2) % 2 : s === 'blocked' ? (t >> 1) % 2 : 1
  // on the top edge, above the nameplate
  p(x + MON - 4, y + 1, 3, 1, blink && LIGHT[s] ? LIGHT[s] : '#2a2833')
}

/** A front-row office chair seen from behind, the same chair as chairFront: rounded back, armrests, post and base. */
function chairBack(q, cx, y) {
  q(cx - 5, y + 15, 10, 1, '#eeece8')
  q(cx - 6, y + 16, 12, 8, '#eeece8')
  q(cx - 4, y + 16, 8, 1, '#7f8ea3')
  q(cx - 5, y + 17, 10, 6, '#6d7b90') // the shell of the back
  q(cx - 3, y + 19, 6, 2, '#7f8ea3')
  q(cx - 8, y + 20, 2, 5, '#e3e2e6') // armrests
  q(cx + 6, y + 20, 2, 5, '#e3e2e6')
  q(cx - 8, y + 20, 2, 1, '#6b6a75')
  q(cx + 6, y + 20, 2, 1, '#6b6a75')
  q(cx - 1, y + 24, 2, 3, '#c9c8cf')
  q(cx - 6, y + 26, 12, 1, '#e3e2e6')
  q(cx - 6, y + 27, 2, 1, '#6b6a75')
  q(cx + 4, y + 27, 2, 1, '#6b6a75')
}

/** A back-row office chair seen from the front: rounded back, seat and armrests, its post down to the desk (which hides the rest). */
function chairFront(q, cx, y) {
  q(cx - 1, y - 6, 2, 6, '#c9c8cf') // the gas lift, down to where the desk hides the base
  q(cx - 5, y - 18, 10, 1, '#eeece8')
  q(cx - 6, y - 17, 12, 9, '#eeece8')
  q(cx - 4, y - 17, 8, 1, '#7f8ea3')
  q(cx - 5, y - 16, 10, 7, '#7f8ea3')
  q(cx - 3, y - 13, 6, 2, '#8f9db1') // a soft sheen on the back cushion
  q(cx - 6, y - 8, 12, 3, '#6d7b90') // the seat
  q(cx - 6, y - 8, 12, 1, '#94a2b6')
  q(cx - 8, y - 11, 2, 6, '#e3e2e6') // armrests
  q(cx + 6, y - 11, 2, 6, '#e3e2e6')
  q(cx - 8, y - 11, 2, 1, '#6b6a75')
  q(cx + 6, y - 11, 2, 1, '#6b6a75')
}

/**
 * A front-row agent in an office chair, back to you, looking at the screen. `awake` is one that
 * just finished and sits up ready for the next task, where it would otherwise doze.
 */
function frontAgent(p, cx, y, staff, t, away, awake = false) {
  if (away || !staff) return ol(p, (q) => chairBack(q, cx, y - 5)) // empty: pushed in toward the desk
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const s = staff.state
  const sleepy = (s === 'done' || s === 'idle') && !awake
  const facing = s === 'waiting'
  const bob = s === 'working' ? t % 2 : 0
  const dy = sleepy ? 2 : 0
  ol(p, (q) => {
    q(cx - 5, y + 11 + dy, 10, 6, shirt)
    if (s === 'working') {
      q(cx - 7, y + 11, 2, 3, shirt)
      q(cx + 5, y + 11, 2, 3, shirt)
      q(cx - 7 + (t % 2), y + 9, 2, 2, skin)
      q(cx + 5 - (t % 2), y + 9, 2, 2, skin)
    }
    if (s === 'blocked') {
      q(cx - 6, y + 6, 2, 6, shirt)
      q(cx + 4, y + 6, 2, 6, shirt)
      q(cx - 5, y + 4, 2, 2, skin)
      q(cx + 3, y + 4, 2, 2, skin)
    }
    if (s === 'monitoring') {
      q(cx + 5, y + 11, 2, 3, shirt)
      q(cx + 5, y + 9, 2, 2, C.white)
    }
    if (facing) {
      q(cx - 3, y + 5, 6, 6, skin)
      q(cx - 3, y + 4, 6, 2, hair)
      q(cx - 4, y + 5, 1, 3, hair)
      q(cx + 3, y + 5, 1, 3, hair)
      if (t % 30 !== 0) {
        q(cx - 2, y + 7, 1, 2, INK)
        q(cx + 1, y + 7, 1, 2, INK)
      }
    } else {
      q(cx - 3, y + 5 + dy - bob, 6, 6, hair)
      q(cx - 3, y + 4 + dy - bob, 6, 1, hair)
      q(cx - 4, y + 7 + dy - bob, 1, 2, skin)
      q(cx + 3, y + 7 + dy - bob, 1, 2, skin)
      if (sleepy) q(cx - 3, y + 10 + dy, 6, 1, skin)
    }
    chairBack(q, cx, y)
    if (festive()) festiveHeadgear(q, cx - 3, facing ? y + 4 : y + 4 + dy - bob, costume, !facing)
  })
  marks(p, cx, y + 5, s, t, facing, awake)
  if (s === 'monitoring' && t % 6 < 4) p(cx + 5 + (t % 2), y + 7 - ((t >> 1) % 2), 1, 1, C.steam)
}

/** A back-row agent behind the desk, facing you over the monitor. */
function backAgent(p, cx, y, staff, t, away, awake = false) {
  // an empty chair is pushed in under the desk, only the top of its back showing; a taken one is out
  ol(p, (q) => chairFront(q, cx, away || !staff ? y + 9 : y))
  if (away || !staff) return
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const s = staff.state
  const sleepy = (s === 'done' || s === 'idle') && !awake
  const bob = s === 'working' ? t % 2 : 0
  const dy = sleepy ? 3 : 0
  ol(p, (q) => {
    q(cx - 5, y - 7 + dy, 10, 8, shirt)
    if (s === 'blocked') {
      q(cx - 6, y - 13, 2, 7, shirt)
      q(cx + 4, y - 13, 2, 7, shirt)
      q(cx - 5, y - 15, 2, 2, skin)
      q(cx + 3, y - 15, 2, 2, skin)
    }
    if (s === 'waiting') {
      q(cx + 5, y - 13, 2, 7, shirt)
      q(cx + 5, y - 15, 2, 2, skin)
    }
    if (s === 'monitoring') {
      q(cx - 7, y - 6, 2, 4, shirt)
      q(cx - 7, y - 8, 2, 2, C.white)
    }
    q(cx - 3, y - 13 + dy - bob, 6, 6, skin)
    q(cx - 3, y - 14 + dy - bob, 6, 2, hair)
    q(cx - 4, y - 13 + dy - bob, 1, 3, hair)
    q(cx + 3, y - 13 + dy - bob, 1, 3, hair)
    if (sleepy) {
      q(cx - 2, y - 10 + dy, 1, 1, INK)
      q(cx + 1, y - 10 + dy, 1, 1, INK)
    } else if (t % 30) {
      q(cx - 2, y - 11 - bob, 1, 2, INK)
      q(cx + 1, y - 11 - bob, 1, 2, INK)
    }
    if (festive()) festiveHeadgear(q, cx - 3, y - 14 + dy - bob, costume)
  })
  marks(p, cx, y - 14, s, t, s === 'waiting', awake)
  if (s === 'monitoring' && t % 6 < 4) p(cx - 7 + (t % 2), y - 10 - ((t >> 1) % 2), 1, 1, C.steam)
}

/** A Santa cap, or an elf's green one, on a 5-wide head seen side-on, its top row at (x, y). */
function cap(q, x, y, costume) {
  q(x, y, 5, 1, C.white)
  q(x, y - 2, 4, 2, costume === 'elf' ? XMAS.elfGreen : XMAS.santaRed)
  q(x + 4, y - 1, 1, 1, C.white)
}

/** The ? over someone waiting, the ! over someone stuck, the z over someone dozing. */
function marks(p, cx, head, s, t, waiting, awake = false) {
  if (waiting && (t >> 2) % 2) ol(p, (q) => glyph(q, '?', cx - 1, head - 8, C.amber))
  if (s === 'blocked') ol(p, (q) => glyph(q, '!', cx - 1, head - 8, C.red))
  if ((s === 'done' || s === 'idle') && !awake) {
    const z = t % 16
    if (z < 12) ol(p, (q) => glyph(q, 'z', cx + 4 + (z >> 2), head - 3 - (z >> 2), C.white))
  }
}

/** The orange metal stool, with a specialist on it leaning in toward the agent's screen. */
function stoolSpecialist(p, x, y, spec, t, mirrored) {
  const q0 = mirrored ? flip(p, x + 3.5) : p
  shadow(p, x, y + 24, 9, 2)
  q0(x + 2, y + 18, 1, 5, '#a8381c')
  q0(x + 5, y + 18, 1, 5, '#a8381c')
  ol(q0, (q) => {
    q(x, y + 18, 1, 3, '#d9502a')
    q(x - 1, y + 21, 1, 3, '#d9502a')
    q(x + 7, y + 18, 1, 3, '#d9502a')
    q(x + 8, y + 21, 1, 3, '#d9502a')
    q(x, y + 15, 8, 3, '#ef6a3e')
    q(x, y + 15, 8, 1, '#f58a62')
    q(x, y + 17, 8, 1, '#c94a26')
    q(x + 3, y + 16, 2, 1, '#8a2e16')
  })
  if (!spec) return
  const { skin, hair, shirt, costume } = look(spec.id || 'specialist')
  const lean = spec.state === 'working' && (t >> 2) % 2 ? -1 : 0
  ol(q0, (q) => {
    q(x + 1 + lean, y + 4, 5, 2, hair)
    q(x + 1 + lean, y + 6, 5, 4, skin)
    q(x + 5 + lean, y + 5, 1, 3, hair)
    q(x + 2 + lean, y + 7, 1, 1, INK)
    q(x + 1, y + 10, 6, 6, shirt)
    q(x + 3, y + 11, 2, 2, roleColor(spec.role))
    q(x - 1 + lean, y + 12, 2, 1, skin)
    if (festive()) cap(q, x + 1 + lean, y + 4, costume)
  })
  if (spec.state === 'waiting' && (t >> 2) % 2) ol(p, (q) => glyph(q, '?', x + 2, y - 3, C.amber))
  if (spec.state === 'blocked') ol(p, (q) => glyph(q, '!', x + 2, y - 3, C.red))
}

/** One island: six desks pushed together, the back row facing you, the front row facing away. */
function island(p, g, isl, world) {
  const { x, y, cells, half } = isl
  const t = world.tick
  const W = ISL_W
  const D2 = ID * (half ? 1 : 2)
  const row0 = half ? 0 : ID
  // a cell is an agent's seat, a sleeping worktree's desk (vacant), or a spare desk (null)
  const staffed = (cell) => (cell && !cell.vacant ? cell : null)
  const kicks = (seat) => {
    if (!seat) return
    world.seatedAt(seat).forEach(({ spec, index }) => {
      const st = seat.stools[index]
      stoolSpecialist(p, st.x, st.y, spec, t, st.flip)
    })
    if (seat.overflow) ol(p, (q) => glyph(q, '+', seat.stools[1].x + 2, seat.stools[1].y - 2, C.white))
  }
  if (!half) {
    for (let i = 0; i < 3; i++) {
      const seat = staffed(cells[i])
      kicks(seat)
      backAgent(p, x + i * IW + HALF, y, seat?.staff, t, seat && world.away(seat), Boolean(seat && world.awake?.(seat)))
    }
  }
  shadow(p, x + 1, y + D2 + 13, W, 3)
  ol(p, (q) => {
    for (const lx of [2, W - 5]) {
      q(x + lx, y + D2 + 2, 3, 11, '#e8e8ec')
      q(x + lx - 2, y + D2 + 13, 7, 1, '#c9cad2')
    }
    q(x + W / 2 - 1, y + D2 + 2, 3, 11, '#e8e8ec')
    q(x + W / 2 - 3, y + D2 + 13, 7, 1, '#c9cad2')
  })
  ol(p, (q) => {
    q(x, y, W, D2, '#f3f2ef')
    q(x, y + D2, W, 2, '#d3d1cc')
  })
  if (!half) p(x, y + ID, W, 1, '#dcdad5')
  for (let i = 1; i < 3; i++) p(x + i * IW, y, 1, D2, '#dcdad5')
  cells.forEach((cell, i) => {
    const row = half || i < 3 ? 0 : 1
    g.drawImage(mat(cell ? cell.unit ?? cell.key : `empty|${x}|${y}|${i}`, IW - 6, ID - 4), x + (i % 3) * IW + 3, y + row * ID + 2)
  })
  // a computer only where a worktree has its desk; a spare desk is just the desk
  if (!half) for (let i = 0; i < 3; i++) if (cells[i]) monitorBack(p, x + i * IW + MON_X, y + 2, staffed(cells[i]), t)
  for (let i = 0; i < 3; i++) {
    const cell = cells[half ? i : i + 3]
    const seat = staffed(cell)
    if (cell) monitorFront(p, x + i * IW + MON_X, y + row0 - 4, seat, t)
    if (cell) deskProp(p, x + i * IW, y + row0 + 5, cell.unit ?? cell.key)
    frontAgent(p, x + i * IW + HALF, y + row0 + 6, seat?.staff, t, seat && world.away(seat), Boolean(seat && world.awake?.(seat)))
    kicks(seat)
  }
}

// ---- the hall ------------------------------------------------------------------------------------

function buildingWindow(p, artW, spineX, night = false) {
  const sky = night ? '#101d3c' : '#72b5e6'
  const horizon = night ? '#1a3150' : '#9db07c'
  p(0, 0, artW, WALL, sky)
  if (night) {
    for (let i = 0; i < artW / 3; i++) {
      const h = hash(i * 6151 + 17)
      p(h % artW, 5 + ((h >>> 9) % 30), (h & 3) === 0 ? 2 : 1, 1, ['#d9e8ff', '#8fb9e5', '#f7d889'][(h >>> 14) % 3])
    }
    const mx = Math.max(16, Math.min(artW - 26, Math.round(artW * 0.72)))
    p(mx, 4, 11, 11, '#f4e4a8')
    p(mx + 2, 2, 7, 2, '#f4e4a8')
    p(mx + 2, 15, 7, 2, '#f4e4a8')
    p(mx + 7, 5, 5, 9, sky)
  } else {
    for (const [x, y, w] of [[12, 4, 26], [Math.round(artW * 0.48), 10, 34], [artW - 46, 2, 28]]) {
      p(x, y + 4, w, 4, '#f4f7f2')
      p(x + 6, y + 2, Math.max(8, w - 12), 2, '#ffffff')
      p(x + 12, y, Math.max(6, w - 24), 2, '#ffffff')
    }
  }
  skyline(p, artW, night)
  // the street side: a kerb, a strip of verge, then a paved path along the glass, birches in their pits
  p(0, 46, artW, WALL - 46, horizon)
  p(0, 46, artW, 2, night ? '#2a3a58' : '#b9b6ad') // the far kerb
  const grass = night ? ['#2c4660', '#24405a', '#3a5068', '#31506a'] : ['#c9b56a', '#7e9a5c', '#b08a52', '#d8c98a']
  for (let i = 0; i < artW / 4; i++) {
    const h = hash(i * 6151)
    p(h % artW, 48 + ((h >>> 9) % 3), 1, 1 + ((h >>> 4) % 2), grass[(h >>> 14) % 4])
  }
  const PATH = 51
  const stone = night ? ['#33435f', '#2f3e59', '#38496a'] : ['#d6cfc1', '#cdc5b6', '#ddd7cb']
  const joint = night ? '#223150' : '#b3ab9c'
  p(0, PATH, artW, WALL - 3 - PATH, stone[0])
  p(0, PATH, artW, 1, night ? '#4a5b7c' : '#e9e4d8') // the edging
  for (let row = 0, y = PATH + 1; y < WALL - 3; row++, y += 4) {
    const rh = Math.min(4, WALL - 3 - y)
    p(0, y + rh - 1, artW, 1, joint)
    for (let x = row & 1 ? -5 : 0, k = 0; x < artW; x += 10, k++) {
      const h = hash(row * 4099 + k * 131)
      p(x + 1, y, 9, rh - 1, stone[h % 3])
      p(x, y, 1, rh - 1, joint)
      if ((h >>> 8) % 9 === 0) p(x + 2 + ((h >>> 12) % 6), y + 1, 1, 1, joint) // a chip, a crack
    }
  }
  for (let [kind, tx] of [Math.round(artW * 0.2), Math.round(artW * 0.63)].entries()) {
    if (Math.abs(tx - spineX - 5) < 16) tx = spineX + 26 // never behind the column over the walkway
    p(tx - 5, 58, 12, 6, night ? '#1d2c44' : '#6b5a45') // the tree pit
    p(tx - 5, 58, 12, 1, joint)
    for (let i = 0; i < 6; i++) p(tx - 4 + i * 2, 60 + (i & 1), 1, 2, grass[(i + tx) % 4])
    birch(p, tx, night, kind)
  }
  // the steel frame: two horizontal mullions, and concrete columns with their rusty edges
  const FR = night ? '#40557c' : '#4d5a53'
  p(0, 0, artW, 1, FR)
  for (const y of [22, 45, WALL - 3]) p(0, y, artW, 1, FR)
  for (let x = 6; x < artW; x += 20) p(x, 0, 1, WALL - 3, FR)
  for (const [cx, cw] of [[0, 6], [spineX, 10], [artW - 6, 6]]) {
    p(cx, 0, cw, WALL - 3, night ? '#293b61' : '#b4afa5')
    if (!night) {
      for (let i = 0; i < 10; i++) {
        const h = hash(cx * 13 + i)
        p(cx + 1 + (h % Math.max(1, cw - 2)), (h >>> 8) % (WALL - 4), 1, 1, '#9f998e')
      }
    }
    p(cx, 0, 1, WALL - 3, night ? '#6b82aa' : '#c0632e')
    p(cx + cw - 1, 0, 1, WALL - 3, night ? '#6b82aa' : '#c0632e')
  }
  p(0, WALL - 3, artW, 3, night ? '#1c2c4d' : '#8e9590')
  p(0, WALL, artW, 1, night ? '#0b1428' : '#6f7672')
}

// The buildings across the street, each its own: brick, render, concrete or stucco, its own height,
// window rhythm and roof. Seeded by position, so the same width always draws the same street.
const FACADES = [
  // wall, mortar or shade, trim, window by day, window at night when lit
  { wall: '#b5654a', line: '#a1573f', trim: '#e8e1d4', glass: '#5d6670', lit: '#f2c96b', brick: true },
  { wall: '#dbc38f', line: '#ceb47f', trim: '#e8e8e3', glass: '#5d6670', lit: '#f5d98a', brick: true },
  { wall: '#c9cdd0', line: '#b4b9bd', trim: '#eef0f0', glass: '#4f6a80', lit: '#e9e3b0' },
  { wall: '#e9dcc4', line: '#d9c9ad', trim: '#a9805a', glass: '#56606b', lit: '#f7d48a' },
  { wall: '#8f9cab', line: '#7f8c9b', trim: '#d6dde4', glass: '#3e4c5c', lit: '#ffe39a' },
  { wall: '#c98d6c', line: '#b97c5c', trim: '#f0e6d8', glass: '#5a5f66', lit: '#f4c46a' }
]
const dusk = (hex, k) => {
  const n = parseInt(hex.slice(1), 16)
  const mix = (v, to) => Math.round(v * k + to * (1 - k))
  return `rgb(${mix(n >> 16, 22)},${mix((n >> 8) & 255, 34)},${mix(n & 255, 64)})`
}

const shade = (night) => (col) => (night ? dusk(col, 0.32) : col)

/** The Klokgebouw: a long Philips brick hall and its slim concrete tower with the clock. Returns its width. */
function klokgebouw(p, x, base, night) {
  const c = shade(night)
  const w = 38
  const top = base - 17
  p(x, top, w, 17, c('#9c4a35'))
  for (let r = top + 2; r < base; r += 2) p(x, r, w, 1, c('#8a4130'))
  p(x - 1, top, w + 2, 2, c('#d8d2c6'))
  for (let wy = top + 4; wy < base - 3; wy += 5) {
    for (let k = 0; k < 6; k++) p(x + 3 + k * 6, wy, 3, 3, night && hash(wy * 7 + k) % 3 === 0 ? '#f2c96b' : night ? '#16203a' : '#5a6672')
  }
  // the tower: concrete, the clock high on its face
  const tx = x + 15
  p(tx, base - 40, 8, 23, c('#cfcac0'))
  p(tx + 7, base - 40, 1, 23, c('#b0aa9f'))
  p(tx - 1, base - 41, 10, 1, c('#8e8a83'))
  for (let ly = base - 30; ly < top; ly += 4) p(tx + 3, ly, 2, 2, c('#7a8088'))
  p(tx + 1, base - 39, 6, 6, night ? '#f4e4a8' : '#f6f4ee')
  p(tx + 3, base - 38, 1, 3, '#2a2a33')
  p(tx + 4, base - 36, 2, 1, '#2a2a33')
  return w
}

/** The Trudo tower: slim and white, its balconies full of trees. Returns its width. */
function trudo(p, x, base, night) {
  const c = shade(night)
  const w = 14
  const top = base - 36
  p(x, top, w, 36, c('#e3e1da'))
  p(x + w - 2, top, 2, 36, c('#c7c4bb'))
  for (let fy = top + 2; fy < base - 2; fy += 3) {
    p(x, fy + 2, w, 1, c('#b9b6ad'))
    for (let k = 0; k < 3; k++) {
      const h = hash(fy * 13 + k * 7 + x)
      p(x + 1 + k * 4, fy, 3, 2, night ? (h % 4 === 0 ? '#f2c96b' : '#16203a') : '#5a6672')
      if (h % 3) p(x + k * 4 + ((h >>> 4) % 3), fy - 1, 2, 2, c(['#6f9a48', '#88ad4e', '#c9b24a'][(h >>> 8) % 3]))
    }
  }
  return w
}

/**
 * An easter egg: the Avular building, home of the people who made this. A low glass hall, the red
 * entrance, and the brick block with its tall green-framed glass gable and the white arrow. Returns its width.
 */
function avular(p, x, base, night) {
  const c = shade(night)
  const green = c('#3d6a46')
  const glass = (k) => (night ? (k % 3 ? '#e9c070' : '#c99a52') : ['#7fa3b8', '#8db0c2', '#6f93a8'][k % 3])
  // the glass hall to the left
  p(x, base - 15, 16, 15, glass(0))
  for (let gx = x; gx <= x + 15; gx += 3) p(gx, base - 15, 1, 15, green)
  for (const gy of [base - 15, base - 9, base - 4]) p(x, gy, 16, 1, green)
  p(x, base - 17, 16, 2, c('#5e5a52'))
  // the red entrance
  p(x + 16, base - 6, 4, 6, '#d23a32') // the red stays red at night too, like the real one under its lights
  p(x + 17, base - 4, 2, 4, night ? '#f2c96b' : '#3a2a2a')
  // the brick block
  const bx = x + 20
  p(bx, base - 22, 20, 22, c('#c9ae7e'))
  for (let r = base - 20; r < base; r += 2) p(bx, r, 20, 1, c('#b89c6c'))
  p(bx, base - 22, 20, 1, green)
  // the glazed gable, rising above the brick to its point
  const gx = bx + 4
  const gw = 12
  for (let y = base - 31; y < base; y++) {
    const inset = Math.max(0, base - 26 - y)
    if (inset * 2 >= gw) continue
    p(gx + inset, y, gw - inset * 2, 1, glass(y))
    p(gx + inset, y, 1, 1, green)
    p(gx + gw - 1 - inset, y, 1, 1, green)
  }
  for (let mx = gx + 3; mx < gx + gw - 1; mx += 3) p(mx, base - 26, 1, 26, green)
  for (let my = base - 22; my < base; my += 5) p(gx, my, gw, 1, green)
  // the arrow, white, high on the glass
  const ax = gx + gw / 2
  p(ax, base - 25, 1, 1, '#ffffff')
  p(ax - 1, base - 24, 1, 1, '#ffffff')
  p(ax + 1, base - 24, 1, 1, '#ffffff')
  p(ax - 2, base - 23, 1, 1, '#ffffff')
  p(ax + 2, base - 23, 1, 1, '#ffffff')
  return 40
}

function skyline(p, artW, night) {
  const base = 46
  // a haze of taller blocks far behind, so the street never shows bare sky in its gaps
  for (let x = -6, i = 0; x < artW; i++) {
    const h = hash(i * 2713 + 11)
    const w = 14 + (h % 18)
    const top = base - 26 - ((h >>> 6) % 12)
    p(x, top, w, base - top, night ? '#1b2a4a' : '#a9c4d6')
    if (night) for (let k = 0; k < w / 3; k++) if ((hash(h + k) & 7) === 0) p(x + 2 + ((hash(h + k) >>> 4) % (w - 3)), top + 3 + ((hash(h + k) >>> 9) % (base - top - 5)), 1, 1, '#c9b56a')
    x += w
  }
  // Strijp-S landmarks among the ordinary buildings, where the street has room for them
  // and Avular's own building on the left with them, so a narrow panel still shows all three
  const marks = [
    { at: Math.round(artW * 0.3), draw: avular },
    { at: Math.round(artW * 0.4), draw: klokgebouw }
  ]
  if (artW > 320) marks.push({ at: Math.round(artW * 0.85), draw: trudo })
  for (let x = -4, i = 0; x < artW; i++) {
    const m = marks.find((m) => !m.done && x >= m.at - 24)
    if (m) {
      m.done = true
      x += m.draw(p, x, base, night) + 1
      continue
    }
    const h = hash(i * 7907 + 5)
    const w = 18 + (h % 22)
    const height = 12 + ((h >>> 5) % 20)
    const f = FACADES[(h >>> 10) % FACADES.length]
    facade(p, x, base - height, w, height, f, h, night)
    x += w + ((h >>> 14) % 4 === 0 ? 3 : 0)
  }
}

function facade(p, x, y, w, h, f, seed, night) {
  const c = shade(night)
  p(x, y, w, h, c(f.wall))
  if (f.brick) for (let r = y + 2; r < y + h; r += 2) p(x, r, w, 1, c(f.line))
  else p(x + w - 2, y, 2, h, c(f.line)) // the shaded return
  // the roof: a cornice, a water tower, a stair house, an air-conditioning unit or nothing at all
  const roof = (seed >>> 17) % 5
  p(x - 1, y, w + 2, 2, c(f.trim))
  if (roof === 0 && f.brick && w > 22) {
    // a factory chimney, Ketelhuis style, with its white band near the top
    const tx = x + 3 + ((seed >>> 3) % (w - 10))
    p(tx, y - 14, 4, 14, c('#9c4a35'))
    p(tx + 3, y - 14, 1, 14, c('#7f3b2a'))
    p(tx, y - 12, 4, 1, c('#e8e1d4'))
    p(tx - 1, y - 15, 6, 1, c('#5e4a44'))
  } else if (roof === 1) {
    const sx = x + w - 10
    p(sx, y - 4, 7, 4, c(f.line))
    p(sx + 2, y - 3, 2, 3, c(f.glass))
  } else if (roof === 2) {
    // a rooftop air-conditioning unit with its fan
    const ax = x + 2 + ((seed >>> 4) % Math.max(1, w - 10))
    p(ax, y - 3, 6, 3, c('#a7adb0'))
    p(ax + 1, y - 2, 2, 1, c('#5f666a'))
    p(ax, y - 3, 6, 1, c('#c4c9cb'))
  } else if (roof >= 3 && f.brick && h < 22) {
    // a Strijp-T hall: a sawtooth roof, each tooth glazed on its steep side
    for (let sx = x; sx < x + w - 5; sx += 6) {
      for (let k = 0; k < 5; k++) p(sx + k, y - 1 - Math.floor(k * 0.8), 6 - k, 1, c('#6e6a66'))
      p(sx + 5, y - 5, 1, 5, night ? '#e9c070' : c('#8fb0c4'))
    }
  } else if (roof === 3 && w > 24) {
    p(x + 2, y - 3, w - 4, 3, c(f.wall)) // a set-back top floor
    p(x + 1, y - 3, w - 2, 1, c(f.trim))
  }
  // windows: a rhythm of its own, some tall, some wide, a band of trim on a few
  const tall = (seed >>> 20) & 1
  const ww = tall ? 2 : 3 + ((seed >>> 21) & 1)
  const wh = tall ? 4 : 2
  const gx = ww + 2 + ((seed >>> 22) % 3)
  const gy = wh + 2 + ((seed >>> 24) & 1)
  const band = (seed >>> 25) % 3 === 0
  const cols = Math.max(1, Math.floor((w - 5) / gx))
  const left = x + Math.floor((w - (cols * gx - (gx - ww))) / 2)
  let n = 0
  for (let wy = y + 4; wy + wh < y + h - 1; wy += gy) {
    if (band) p(x, wy + wh, w, 1, c(f.trim))
    for (let k = 0; k < cols; k++, n++) {
      const lit = night && (hash(seed + n * 31) % 100) < 38
      p(left + k * gx, wy, ww, wh, lit ? f.lit : night ? '#16203a' : f.glass)
      if (!night && wh > 2) p(left + k * gx, wy, 1, 1, '#9fb4c4') // a glint
    }
  }
  // a shop front at street level on some
  if (h > 16 && (seed >>> 27) % 3 === 0) {
    p(x + 2, y + h - 4, w - 4, 4, night ? '#e9c070' : c('#6f7d86'))
    p(x + 1, y + h - 5, w - 2, 1, c((seed >>> 29) & 1 ? '#3f7a5b' : '#9b3f3a'))
  }
}

/**
 * A birch: white bark with its dark marks, a few branches and a crown going yellow. No two alike:
 * a tall slender one still mostly green, and a shorter leaning pair with a wide golden crown.
 */
const BIRCHES = [
  { top: 16, cy: 19, rx: 9, ry: 14, lean: 0, twin: false, gold: 0.35, branches: [[1, 30, 5], [-1, 26, 4], [1, 21, 3], [-1, 36, 4]] },
  { top: 28, cy: 27, rx: 15, ry: 11, lean: 1, twin: true, gold: 0.8, branches: [[1, 33, 7], [-1, 31, 6], [1, 38, 4]] }
]

function birch(p, tx, night, kind = 0) {
  const b = BIRCHES[kind % BIRCHES.length]
  const bark = night ? '#a9b2c4' : '#f1f0ea'
  const mark = night ? '#2a3550' : '#4b4a5e'
  const gold = night ? ['#7e7a46', '#8a7a40'] : ['#d6c04a', '#e2b23c', '#c7a23a']
  const green = night ? ['#55663e', '#4a5a38'] : ['#9bb54c', '#86a443']
  // a trunk that leans one pixel every few rows when the tree has a lean
  const trunk = (x0, top, w) => {
    for (let y = top; y < 61; y++) {
      const x = x0 + (b.lean ? Math.floor((61 - y) / 9) : 0)
      p(x, y, w, 1, bark)
      if (hash(x0 * 7 + y) % 6 === 0) p(x + (y & 1) * (w - 1), y, 1, 1, mark)
    }
  }
  if (b.twin) trunk(tx - 4, b.top + 8, 1) // its thinner sibling
  trunk(tx, b.top, 2)
  const cx = tx + (b.lean ? Math.floor((61 - b.cy) / 9) : 0)
  for (const [dir, by, len] of b.branches) {
    const bx = tx + (b.lean ? Math.floor((61 - by) / 9) : 0) + (dir > 0 ? 2 : -1)
    for (let k = 0; k < len; k++) p(bx + dir * k, by - (k >> 1), 1, 1, bark)
  }
  // the crown: an oval of its own size, gold or green by the tree, its shaded side to the right
  for (let i = 0; i < 300; i++) {
    const h = hash(tx * 97 + i)
    const dx = (h % (b.rx * 2 + 1)) - b.rx
    const dy = ((h >>> 8) % (b.ry * 2 + 1)) - b.ry
    if ((dx * dx) / (b.rx * b.rx) + (dy * dy) / (b.ry * b.ry) > 1) continue
    const pick = ((h >>> 16) % 100) / 100 < b.gold ? gold : green
    const shaded = (dx > b.rx / 3 || dy > b.ry / 2) && (h >>> 24) % 3
    p(cx + dx, b.cy + dy, 2, 2, shaded ? pick[pick.length - 1] : pick[(h >>> 20) % pick.length])
  }
  for (let i = 0; i < 6; i++) {
    const h = hash(tx * 31 + i) // a few leaves already let go
    p(tx - 12 + (h % 26), 52 + ((h >>> 8) % 11), 1, 1, gold[(h >>> 16) % gold.length])
  }
}

/** Polished concrete: soft blotches and a sheen from the windows. */
function concrete(p, w, y0, y1) {
  p(0, y0, w, y1 - y0, '#cbc7bf')
  const n = Math.floor((w * (y1 - y0)) / 280)
  for (let i = 0; i < n; i++) {
    const h = hash(i * 7919 + 3)
    const by = y0 + ((h >>> 9) % (y1 - y0))
    p(h % w, by, Math.min(6 + ((h >>> 3) % 16), w), Math.min(2 + ((h >>> 5) % 3), y1 - by), (h >>> 12) % 3 === 0 ? '#d8d5ce' : '#c1bdb4')
  }
  for (let i = 0; i < n / 12; i++) {
    const h = hash(i * 31337)
    p(h % w, y0 + ((h >>> 9) % (y1 - y0)), 18, 1, 'rgba(255,255,255,0.25)')
  }
}

/** The side walls, concrete with a rusty edge, and the front door in the left one. */
function walls(p, artW, h, doorY) {
  for (const x of [0, artW - OUTER]) {
    p(x, WALL, OUTER, h - WALL, '#b4afa5')
    p(x ? x : OUTER - 1, WALL, 1, h - WALL, '#c0632e')
  }
  p(0, h - 3, artW, 3, '#a39e94')
  p(0, doorY - 2, OUTER, 19, '#cbc7bf')
  p(0, doorY - 3, OUTER, 1, '#6f7672')
  p(0, doorY + 17, OUTER, 1, '#6f7672')
  p(OUTER, doorY + 1, 3, 14, '#5d6670')
}

function backCurtain(p, x0, w, floor) {
  const h = 26
  const top = floor - h
  for (let x = x0; x < x0 + w; x += 4) {
    p(x, top, 2, h, NAVY[1])
    p(x + 2, top, 1, h, NAVY[3])
    p(x + 3, top, 1, h, NAVY[2])
  }
  p(x0, top, w, 1, INK)
  p(x0, floor - 2, w, 1, NAVY[3])
  p(x0, floor, w, 2, 'rgba(25,22,45,0.18)')
}

function pillar(p, x, floor, h = 42) {
  shadow(p, x + 2, floor, 12, 3)
  ol(p, (q) => {
    q(x, floor - h - 3, 10, 3, '#cdc8be')
    q(x, floor - h, 10, h, '#b4afa5')
    for (let i = 0; i < 10; i++) {
      const hh = hash(x + i * 17)
      q(x + 1 + (hh % 8), floor - h + ((hh >>> 8) % h), 1, 1, '#9f998e')
    }
    q(x, floor - h, 1, h, '#c0632e')
    q(x + 9, floor - h, 1, h, '#c0632e')
    q(x + 1, floor - 12, 1, 6, '#d47a40')
    q(x + 8, floor - 30, 1, 9, '#d47a40')
    q(x + 4, floor - 16, 3, 7, '#23212b')
    q(x + 5, floor - 14, 1, 1, '#4b4a5e')
    q(x + 5, floor - 12, 1, 1, '#4b4a5e')
  })
}

function sign(p, x, y, w) {
  ol(p, (q) => {
    q(x, y, w, 9, '#23212b')
    q(x, y, w, 1, '#3d394c')
  })
}

// ---- the hangout's furniture ------------------------------------------------------------------

function rug(p, { x, y, w, h }) {
  p(x + 3, y, w - 6, h, '#d99aa3')
  p(x, y + 3, w, h - 6, '#d99aa3')
  p(x + 1, y + 1, w - 2, h - 2, '#d99aa3')
  p(x + 4, y + 2, w - 8, h - 4, '#e8b7bd')
  p(x + 2, y + 4, w - 4, h - 8, '#e8b7bd')
}

function sofa(p, { x, y, w }) {
  shadow(p, x - 2, y + 13, w + 6, 3)
  ol(p, (q) => {
    q(x - 3, y + 3, 3, 9, '#7f9468')
    q(x + w, y + 3, 3, 9, '#7f9468')
    q(x, y, w, 6, '#8fa37a')
    q(x, y, w, 1, '#a7b993')
    q(x, y + 6, w, 6, '#9fb08a')
    q(x + (w >> 1), y + 6, 1, 6, '#7f9468')
  })
}

function coffeeTable(p, { x, y }) {
  shadow(p, x + 1, y + 8, 24, 2)
  ol(p, (q) => {
    q(x, y, 24, 4, '#d4a670')
    q(x, y + 4, 24, 2, '#9c6d3e')
    q(x + 1, y + 6, 1, 2, '#6b4a2e')
    q(x + 22, y + 6, 1, 2, '#6b4a2e')
    q(x + 7, y + 1, 6, 2, '#e8e3d6')
    q(x + 16, y + 1, 2, 2, C.white)
  })
}

function counter(p, { x, y, w }, t) {
  shadow(p, x + 1, y + 15, w, 3)
  ol(p, (q) => {
    q(x, y, w, 4, '#ecebe6')
    q(x, y + 4, w, 11, '#7d9a8f')
    for (let i = 12; i < w; i += 12) {
      q(x + i, y + 5, 1, 9, '#5f7c72')
      q(x + i - 3, y + 8, 2, 1, '#eceef2')
    }
    q(x + w - 18, y + 1, 9, 2, '#a9b4c3')
  })
  // the coffee machine and two mugs on it
  ol(p, (q) => {
    q(x + 4, y - 9, 8, 9, '#3a3b46')
    q(x + 4, y - 9, 8, 2, '#55566a')
    q(x + 6, y - 6, 4, 2, '#1d1e26')
    q(x + 10, y - 8, 1, 1, t % 8 < 4 ? C.red : '#5a2028')
    q(x + 7, y - 3, 2, 2, C.white)
    q(x + 22, y - 3, 3, 3, C.white)
    q(x + 28, y - 3, 3, 3, '#e0533f')
  })
  if (t % 6 < 4) p(x + 7 + (t % 2), y - 5 - ((t >> 1) % 2), 1, 1, C.steam)
}

function fridge(p, { x, floor }) {
  shadow(p, x + 1, floor, 14, 3)
  ol(p, (q) => {
    q(x, floor - 30, 13, 30, '#eef0f3')
    q(x, floor - 19, 13, 1, '#c9ccd8')
    q(x + 10, floor - 27, 1, 5, '#9aa0b4')
    q(x + 10, floor - 16, 1, 6, '#9aa0b4')
  })
}

function cooler(p, { x, floor }, t) {
  shadow(p, x, floor, 8, 2)
  ol(p, (q) => {
    q(x + 1, floor - 16, 5, 6, '#8fd0f0')
    q(x + 2, floor - 16, 3, 1, '#c4ecfb')
    q(x + 2, floor - 14 + (t % 12 < 6 ? 0 : 1), 1, 1, '#e8f8ff')
    q(x, floor - 10, 7, 10, '#e9ebf2')
    q(x + 2, floor - 7, 1, 2, C.blue)
    q(x + 4, floor - 7, 1, 2, C.red)
  })
}

function foosball(p, { x, y }, t, playing) {
  shadow(p, x + 1, y + 18, 28, 2)
  ol(p, (q) => {
    q(x + 1, y + 12, 2, 6, '#6b4a2e')
    q(x + 25, y + 12, 2, 6, '#6b4a2e')
    q(x, y, 28, 12, '#9c6534')
    q(x + 1, y + 1, 26, 8, '#3f8f4a')
    q(x + 13, y + 1, 1, 8, '#cfe8d2')
    q(x, y + 9, 28, 3, '#7a4e28')
  })
  ;[5, 10, 17, 22].forEach((rx, i) => {
    p(x + rx, y - 2, 1, 13, '#b9bccb')
    p(x + rx, y - 3, 1, 1, INK)
    p(x + rx, y + 11, 1, 2, INK)
    const shift = playing ? ((t + i * 2) >> 1) % 3 - 1 : 0
    const c = i % 2 ? '#4f7cff' : '#ff5468'
    p(x + rx - 1, y + 2 + shift, 3, 2, c)
    p(x + rx - 1, y + 6 + shift, 3, 2, c)
  })
  if (playing) {
    const ph = t % 20
    p(x + 3 + Math.round((ph < 10 ? ph : 20 - ph) * 2.2), y + 4 + ((t >> 2) % 2), 1, 1, C.white)
  }
}

/** The mauve phone booth; its caller is drawn between its back and its glass door. */
function boothBack(p, { x, floor }) {
  shadow(p, x + 2, floor, 20, 3)
  ol(p, (q) => {
    q(x, floor - 38, 20, 3, '#c7a3aa')
    q(x, floor - 35, 20, 35, '#b8939a')
    q(x + 4, floor - 32, 12, 30, '#7d8f99')
  })
}
function boothGlass(p, { x, floor }) {
  p(x + 4, floor - 32, 12, 30, 'rgba(170, 210, 235, 0.25)')
  p(x + 5, floor - 31, 2, 12, 'rgba(255, 255, 255, 0.35)')
  p(x + 14, floor - 18, 1, 4, INK)
}

function tulip(p, { x, y }) {
  ol(p, (q) => {
    q(x, y, 7, 5, '#f4f2ec')
    q(x + 1, y + 5, 5, 2, '#e3e0d8')
    q(x + 3, y + 7, 1, 3, '#c9c6be')
    q(x + 1, y + 10, 5, 1, '#c9c6be')
  })
}

function roundTable(p, { x, y }) {
  shadow(p, x + 2, y + 11, 14, 2)
  ol(p, (q) => {
    q(x + 1, y, 14, 1, '#f4f2ec')
    q(x, y + 1, 16, 3, '#f4f2ec')
    q(x + 1, y + 4, 14, 1, '#dcd8cf')
    q(x + 7, y + 5, 2, 5, '#c9c6be')
    q(x + 4, y + 10, 8, 1, '#c9c6be')
  })
}

function barTable(p, { x, y }) {
  shadow(p, x + 6, y + 20, 18, 2)
  ol(p, (q) => {
    q(x, y, 28, 5, '#7a4a3e')
    q(x, y, 28, 1, '#946052')
    q(x, y + 5, 28, 2, '#4f2c27')
    q(x + 13, y + 7, 2, 12, '#2a2833')
    q(x + 8, y + 19, 12, 1, '#2a2833')
  })
}

function barStool(p, { x, y }) {
  shadow(p, x, y + 13, 7, 2)
  ol(p, (q) => {
    q(x, y, 7, 3, '#2a2833')
    q(x + 1, y, 5, 1, '#4b4a5e')
    q(x + 3, y + 3, 1, 10, '#2a2833')
    q(x + 1, y + 8, 5, 1, '#4b4a5e')
    q(x + 1, y + 13, 5, 1, '#2a2833')
  })
}

function plant(p, { x, y }, t = 0) {
  shadow(p, x, y + 15, 10, 2)
  if (festive()) return pine(p, x, y, t)
  ol(p, (q) => {
    q(x + 1, y + 9, 7, 6, '#b4643c')
    q(x + 1, y + 9, 7, 1, '#cf7a50')
    q(x, y + 1, 9, 8, '#4f9d5a')
    q(x + 2, y - 2, 5, 4, '#4f9d5a')
    q(x + 3, y + 2, 1, 5, '#3a7a45')
    q(x + 6, y, 1, 4, '#3a7a45')
  })
}

/** In season the plants are little pines in red pots, their baubles taking turns to light. */
function pine(p, x, y, t) {
  ol(p, (q) => {
    q(x + 1, y + 9, 7, 6, XMAS.santaDark)
    q(x + 1, y + 9, 7, 1, XMAS.santaRed)
    q(x, y + 4, 9, 5, XMAS.pineDark)
    q(x + 1, y + 1, 7, 4, XMAS.pineMid)
    q(x + 3, y - 2, 3, 4, XMAS.pineLight)
  })
  p(x + 4, y - 3, 1, 1, XMAS.starGold)
  const on = (t >> 2) % 2
  p(x + 1, y + 6, 1, 1, on ? XMAS.ornamentRed : XMAS.ornamentGold)
  p(x + 7, y + 5, 1, 1, on ? XMAS.ornamentBlue : XMAS.ornamentRed)
  p(x + 4, y + 2, 1, 1, on ? XMAS.ornamentGold : XMAS.ornamentBlue)
}

// Little things on desks, each standing on the desk from row y upward, at most six pixels wide.
const PROPS = {
  bear(q, x, y) {
    q(x, y - 4, 4, 4, '#7a4a2e')
    q(x, y - 5, 1, 1, '#7a4a2e')
    q(x + 3, y - 5, 1, 1, '#7a4a2e')
    q(x + 1, y - 2, 2, 1, '#f3f2ef')
  },
  locker(q, x, y) {
    q(x, y - 12, 6, 12, '#9fcbe8')
    q(x + 1, y - 10, 4, 1, '#6f9fc4')
    q(x + 1, y - 8, 4, 1, '#6f9fc4')
    q(x + 4, y - 5, 1, 2, '#6f9fc4')
  },
  card(q, x, y) {
    q(x, y - 4, 3, 4, '#f6c6d4')
    q(x + 1, y - 3, 1, 1, '#e0533f')
  },
  plantFace(q, x, y) {
    q(x, y - 5, 5, 5, '#f29a3a')
    q(x + 1, y - 3, 1, 1, INK)
    q(x + 3, y - 3, 1, 1, INK)
    q(x, y - 8, 2, 3, '#4f9d5a')
    q(x + 3, y - 8, 2, 3, '#4f9d5a')
    q(x + 2, y - 9, 1, 4, '#3a7a45')
  },
  mug(q, x, y) {
    q(x, y - 3, 3, 3, C.white)
    q(x + 3, y - 2, 1, 1, C.white)
  },
  lamp(q, x, y) {
    q(x, y - 1, 6, 1, '#4b4a5e')
    q(x + 2, y - 6, 1, 5, '#4b4a5e')
    q(x, y - 9, 6, 3, '#4f9d8f')
    q(x + 1, y - 6, 4, 1, '#f6e7a1')
  },
  cactus(q, x, y) {
    q(x, y - 3, 4, 3, '#d9d4c8')
    q(x + 1, y - 7, 2, 4, '#5f9a52')
    q(x, y - 6, 1, 2, '#5f9a52')
    q(x + 3, y - 5, 1, 2, '#5f9a52')
  },
  luckyCat(q, x, y) {
    q(x, y - 5, 5, 5, '#f6f4ee')
    q(x, y - 6, 1, 1, '#f6f4ee')
    q(x + 4, y - 6, 1, 1, '#f6f4ee')
    q(x + 1, y - 4, 1, 1, INK)
    q(x + 3, y - 4, 1, 1, INK)
    q(x + 1, y - 2, 3, 1, '#e0533f')
  }
}
const PROP_NAMES = Object.keys(PROPS)

/** About one front-row desk in three has a little thing on a corner beside the monitor. */
function deskProp(p, cellX, surface, key) {
  const roll = hashText(`${key}|prop`)
  if (roll % 100 >= 35) return
  const name = PROP_NAMES[(roll >>> 8) % PROP_NAMES.length]
  const x = (roll >>> 16) % 2 ? cellX + 2 : cellX + IW - 8
  // in season about half of these are a little present instead
  if (festive() && (roll >>> 20) % 2) return ol(p, (q) => present(q, x, surface, 5, 4, XMAS.santaRed, XMAS.starGold))
  ol(p, (q) => PROPS[name](q, x, surface))
}

/** A wrapped present w x h standing on row `base`, its ribbon both ways and a bow on top. */
function present(q, x, base, w, h, box, ribbon) {
  const mid = x + (w >> 1)
  q(x, base - h, w, h, box)
  q(mid, base - h, 1, h, ribbon)
  q(x, base - h + (h >> 1), w, 1, ribbon)
  q(mid - 1, base - h - 1, 3, 1, ribbon)
}

/** A slim yellow drawer block, maybe with a tiny retro computer, a plant or books on top. */
function drawers(p, { x, base, h, top }, t) {
  const y = base - h
  shadow(p, x + 1, base, DRAWER_W, 2)
  ol(p, (q) => {
    q(x, y, DRAWER_W, 4, '#f2cf55')
    q(x, y + 4, DRAWER_W, h - 4, '#e3b52e')
    for (let dy = 10; dy < h; dy += 7) q(x, y + dy, DRAWER_W, 1, '#a87e14')
    for (let dy = 6; dy < h - 2; dy += 7) q(x + 4, y + dy, 4, 1, '#eceef2')
  })
  if (top === 'retro') {
    ol(p, (q) => {
      q(x + 2, y - 6, 8, 6, '#eee9da')
      q(x + 3, y - 5, 6, 3, '#2f3440')
      q(x + 4, y - 4, 2, 1, (t >> 2) % 2 ? C.green : '#2f3440')
    })
  } else if (top === 'plant') {
    ol(p, (q) => {
      q(x + 3, y - 4, 6, 4, '#f29a3a')
      q(x + 4, y - 3, 1, 1, INK)
      q(x + 7, y - 3, 1, 1, INK)
      q(x + 3, y - 7, 2, 3, '#4f9d5a')
      q(x + 7, y - 7, 2, 3, '#4f9d5a')
      q(x + 5, y - 8, 2, 4, '#3a7a45')
    })
  } else if (!top && festive()) {
    // in season a bare drawer block gets a little stack of presents
    ol(p, (q) => {
      present(q, x + 1, y, 9, 5, XMAS.santaRed, XMAS.starGold)
      present(q, x + 3, y - 6, 6, 4, XMAS.elfGreen, C.white)
    })
  } else if (top === 'books') {
    ol(p, (q) => {
      q(x + 2, y - 2, 8, 2, '#4f7cff')
      q(x + 3, y - 4, 7, 2, '#f2b134')
      q(x + 2, y - 5, 5, 1, '#c4453c')
    })
  }
}

function dogBed(p, { x, y }) {
  ol(p, (q) => {
    q(x, y + 1, 24, 8, '#8a5a3c')
    q(x + 2, y + 3, 20, 5, '#d29a6c')
  })
}

/** What each piece of hangout furniture covers on screen, from its floor row up. */
function thingBase(t) {
  switch (t.kind) {
    case 'booth':
    case 'fridge':
    case 'cooler':
      return t.floor
    case 'counter':
      return t.y + 15
    case 'sofa':
      return t.y + 13
    case 'coffeeTable':
      return t.y + 8
    case 'roundTable':
    case 'tulip':
      return t.y + 11
    case 'foosball':
      return t.y + 18
    case 'barTable':
      return t.y + 20
    case 'barStool':
      return t.y + 14
    case 'plant':
      return t.y + 15
    case 'tree':
      return t.y + 21
    default:
      return t.y
  }
}

// ---- drawing the whole office -----------------------------------------------------------------

const backgrounds = new Map() // floor geometry -> the hall's static floor and walls, painted once

function background(layout) {
  const { artW, building } = layout
  const key = JSON.stringify([layout.dark === true, artW, building.h, building.doorY, building.spineX, layout.common.bed, layout.common.things.filter((t) => t.kind === 'rug')])
  let canvas = backgrounds.get(key)
  if (canvas) return canvas
  canvas = new OffscreenCanvas(artW, building.h)
  const g = canvas.getContext('2d')
  const p = (x, y, w, h, c) => {
    g.fillStyle = c
    g.fillRect(x, y, w, h)
  }
  buildingWindow(p, artW, building.spineX, layout.dark === true)
  concrete(p, artW, WALL + 1, building.h)
  walls(p, artW, building.h, building.doorY)
  for (const t of layout.common.things) if (t.kind === 'rug') rug(p, t)
  dogBed(p, layout.common.bed)
  if (backgrounds.size > 6) backgrounds.clear()
  backgrounds.set(key, canvas)
  return canvas
}

/**
 * Draws the office. `world` is the panel's live state: `tick`; `away(seat)`, whether the agent is
 * up and about; `awake(seat)`, whether it just finished and sits up at its desk instead of dozing;
 * `seatedAt(seat)`, the specialists on its stools; `people`, everyone standing or
 * walking, each with `{ key, x, y, base, kind, paint(p) }`; `palu`, his box and a painter; and
 * `drawText` for the signs and nameplates at screen resolution.
 */
export function drawLoft(ctx, layout, world) {
  const p = (x, y, w, h, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, w, h)
  }
  const t = world.tick
  ctx.drawImage(background(layout), 0, 0)
  if (festive()) season(p, layout, t)
  const c = layout.common
  const scene = []
  const colorOf = (bot) => world.bots?.colors?.get(bot.id) ?? { body: '#e0786c', belly: '#eb9a8f' }
  if (c.coord) coordinatorRug(p, c.coord)
  for (const room of layout.rooms) if (room.head) scene.push({ base: room.head.y + 5, paint: () => botHead(p, room.head, colorOf(room.head.bot), t) })
  if (c.coord && layout.coordinator) {
    const all = [...(world.bots?.colors?.values() ?? [])]
    coordinatorPieces(p, c.coord, layout.coordinator.bot, colorOf(layout.coordinator.bot), all, world.bots?.chiefSeated !== false, t, scene)
  }
  // the room signs on the window, for the first row of rooms
  for (const room of layout.rooms) if (room.first) sign(p, room.x + 4, 2, signW(room))
  for (const room of layout.rooms) for (const isl of room.islands) scene.push({ base: isl.y + (isl.half ? 0 : ID) + 34, paint: () => island(p, ctx, isl, world) })
  layout.lines.forEach((line) => {
    scene.push({
      base: line,
      paint: () => {
        for (const [sx, w] of curtainSegments(layout, line)) {
          backCurtain(p, sx, w, line)
          if (festive()) holidayLights(at(p, sx, line - 27), w, t)
        }
        // the coordinator's way in, and the lounge's beside it: gaps in the curtain between posts
        if (line === c.y) {
          for (const gap of curtainGaps(c)) {
            p(gap.x - 1, line - 26, 1, 26, INK)
            p(gap.x + gap.w, line - 26, 1, 26, INK)
          }
          // and its sign, like every room's
          if (c.coord && layout.coordinator) sign(p, c.coord.in0 + 2, line - 25, coordSignW(c.coord, layout.coordinator.bot))
        }
        pillar(p, layout.building.spineX, line + 2)
        for (const room of layout.rooms) if (room.y === line) sign(p, room.x + 4, line - 25, signW(room))
      }
    })
  })
  // in season the hangout's big tree, or its first plant when there is no room for one
  const bigPlant = c.things.some((th) => th.kind === 'tree') ? null : c.things.find((th) => th.kind === 'plant')
  const bigTree = (x, y) => ol(p, (q) => christmasTree(at(q, x, y), t))
  const playing = world.people.filter((m) => m.kind === 'foosball').length >= 2
  const callers = new Map(world.people.filter((m) => m.kind === 'booth').map((m) => [m.spot.bx, m]))
  for (const thing of c.things) {
    const base = thingBase(thing)
    const paint = {
      booth: () => {
        boothBack(p, thing)
        callers.get(thing.x)?.paint(p)
        boothGlass(p, thing)
      },
      counter: () => counter(p, thing, t),
      fridge: () => fridge(p, thing),
      cooler: () => cooler(p, thing, t),
      sofa: () => sofa(p, thing),
      coffeeTable: () => coffeeTable(p, thing),
      tulip: () => {
        if (!world.sittersAt?.has(thing)) tulip(p, thing)
      },
      roundTable: () => roundTable(p, thing),
      foosball: () => foosball(p, thing, t, playing),
      barTable: () => barTable(p, thing),
      barStool: () => barStool(p, thing),
      plant: () => (festive() && thing === bigPlant ? bigTree(thing.x - 3, thing.y - 6) : plant(p, thing, t)),
      tree: () => festive() && bigTree(thing.x, thing.y)
    }[thing.kind]
    if (paint) scene.push({ base, paint })
  }
  scene.push({ base: c.bowls.y + 4, paint: () => world.bowls(p, c.bowls) })
  for (const room of layout.rooms) for (const d of room.drawers ?? []) scene.push({ base: d.base, paint: () => drawers(p, d, t) })
  // A walker crossing a room must stay visible while it passes behind the static island/curtain
  // layers. Settled people remain in the normal depth-sorted scene, so sofas and tables still
  // occlude them naturally once they arrive.
  const moving = []
  for (const m of world.people) {
    if (m.kind === 'booth') continue
    if (m.moving) moving.push(m)
    else scene.push({ base: m.base, paint: () => m.paint(p) })
  }
  if (world.palu) scene.push({ base: world.palu.base - 0.5, paint: () => world.palu.paint(p) })
  scene.sort((a, b) => a.base - b.base)
  // `view` is the band of floor rows the panel shows; a thing standing well outside it cannot
  // reach into it, so a big office only paints what is on screen
  const { view } = world
  for (const item of scene) if (!view || (item.base > view.y0 - 8 && item.base < view.y1 + 90)) item.paint()
  moving.sort((a, b) => a.base - b.base)
  for (const m of moving) m.paint(p)

  const s = layout.scale
  // a sign or nameplate is a line of text around its row: one well off screen is not measured
  const shown = (y, bottom = y) => !view || (bottom > view.y0 - 12 && y < view.y1 + 12)
  for (const room of layout.rooms) {
    const y = room.first ? 2 : room.y - 25
    if (shown(y + 5)) world.drawText(room.name, (room.x + 8) * s, (y + 5) * s, (signW(room) - 6) * s, C.white, { weight: 700 })
  }
  const k = c.coord
  if (k && layout.coordinator && shown(k.y - 20)) {
    const w = coordSignW(k, layout.coordinator.bot)
    const name = layout.coordinator.bot.name
    // a smaller letter before a cut-off name, so the whole name shows on a narrow room
    const fits = Math.floor(((w - 4) * s) / (name.length * 0.62))
    world.drawText(name, (k.in0 + 5) * s, (k.y - 20) * s, (w - 4) * s, C.white, { weight: 700, size: Math.max(8, Math.min(12, Math.round(s * 3.4), fits)) })
  }
  const size = Math.max(9, Math.min(12, Math.round(s * 3.4)))
  for (const seat of layout.seats) {
    if (!shown(seat.island.y + (seat.front ? seat.row0 + 25 : 5))) continue
    const label = world.nameplate(seat)
    // a chip sized to the label, never wider than the desk: on the back of a front-row chair, which
    // stays put while its agent is on a break, and on the back of a back-row monitor
    const maxW = (IW - 3) * s
    if (seat.front) world.drawText(label, seat.cx * s, (seat.island.y + seat.row0 + 25) * s, maxW, '#e4e8f2', { align: 'center', size, chip: '#2f3a52' })
    else world.drawText(label, seat.cx * s, (seat.island.y + 5) * s, maxW, '#23212b', { align: 'center', size, chip: '#f1efe8' })
    if (seat.island.bot) projectTag(world, seat, s, size)
  }
  for (const room of layout.rooms) {
    for (const isl of room.islands) {
      if (!shown(isl.y - 10, isl.y + ID * 2 + 25)) continue
      // two small teams in one room: each island carries its team's name
      if (isl.team) world.drawText(isl.team, (isl.x + 1) * s, (isl.y - 10) * s, ISL_W * s, C.white, { weight: 700, size, chip: '#23212b' })
      // a sleeping worktree's desk keeps its nameplate, dimmed
      for (const cell of isl.cells) {
        if (!cell?.vacant) continue
        const maxW = (IW - 3) * s
        if (cell.front) world.drawText(cell.label, cell.cx * s, (isl.y + cell.row0 + 25) * s, maxW, '#9aa0b4', { align: 'center', size, chip: '#3a3f4f' })
        else world.drawText(cell.label, cell.cx * s, (isl.y + 5) * s, maxW, '#6b6a75', { align: 'center', size, chip: '#d9d6cf' })
        if (isl.bot) projectTag(world, { ...cell, island: isl }, s, size)
      }
    }
  }
}

/**
 * The little tag under a desk's nameplate in a bot's room: the project it works in. A front-row
 * desk has it below the nameplate on its chair, a back-row desk on the desk below its monitor.
 */
function projectTag(world, seat, s, size) {
  const y = seat.front ? seat.island.y + seat.row0 + 30.5 : seat.island.y + 10.5
  world.drawText(seat.desk.repo ?? '', seat.cx * s, y * s, (IW - 3) * s, '#23212b', { align: 'center', size: Math.max(8, size - 2), chip: '#f1efe8' })
}

/** Christmas over the hall: lights along the window ledge, snow falling past the steel frames and a
 * red door with a green band, all drawn live over the painted-once background. */
function season(p, layout, t) {
  const { artW, building } = layout
  for (let i = 0; i < artW / 9; i++) {
    const h = hash(i * 4513 + 7)
    const fall = (t + ((h >>> 6) % 40)) % (WALL - 4)
    p((h % artW) + (((t >> 2) + i) % 3) - 1, 1 + fall, 1, 1, C.white)
  }
  holidayLights(at(p, 0, WALL - 5), artW, t)
  p(OUTER, building.doorY + 1, 3, 14, '#b4202a')
  p(OUTER + 1, building.doorY + 3, 1, 10, '#238547')
}

function coordSignW(k, bot) {
  return Math.min(k.signMax, bot.name.length * 4 + 14)
}

function signW(room) {
  return Math.min(room.w - 10, room.name.length * 4 + 14)
}

/**
 * Someone on a tulip chair at the round table: behind the table facing you, or in front of it with
 * their back to you. Whoever has the word shows three little dots over their head.
 */
export function sitting(p, chair, staff, t, talking) {
  const { skin, hair, shirt, costume } = look(staff.id || 'x')
  const x = chair.x
  const y = chair.y
  const facing = chair.facing
  const nod = talking && (t >> 1) % 2 ? 1 : 0
  if (facing) tulip(p, chair)
  ol(p, (q) => {
    q(x, y - 1, 7, 6, shirt)
    q(x + 1, y - 8 + nod, 5, 2, hair)
    q(x + 1, y - 6 + nod, 5, 5, facing ? skin : hair)
    if (facing) {
      q(x + 2, y - 4 + nod, 1, 1, INK)
      q(x + 4, y - 4 + nod, 1, 1, INK)
      q(x - 1, y + 1, 2, 1, skin)
      q(x + 6, y + 1, 2, 1, skin)
    }
    if (festive()) cap(q, x + 1, y - 8 + nod, costume)
  })
  if (!facing) tulip(p, chair)
  if (talking) {
    // a little speech bubble, its dots typing out
    ol(p, (q) => {
      q(x - 1, y - 16, 9, 5, C.white)
      q(x + 1, y - 11, 2, 1, C.white)
    })
    const dots = 1 + ((t >> 2) % 3)
    for (let i = 0; i < dots; i++) p(x + 1 + i * 2, y - 14, 1, 1, INK)
  }
}

// ---- bots ----------------------------------------------------------------------------------------
// A bot is its mascot: 12 x 12, outlined like everything in the loft, with a headset. B body,
// L belly, H headset, T the mic tip. Its eyes and mouth are painted over by state.

const BOT_BODY = ['....BBBB....', '..BBBBBBBB..', '.BBBBBBBBBB.', 'HBBLLLLLLBBB', 'HBLLLLLLLLBB', 'HBLLLLLLLLBB', '.BLLLLLLLLBB', '.HLLLLLLLLBB', '..TLLLLLLBBB', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'B.BB.BB.BB.B']

/**
 * A bot's mascot with its top-left at (x, y). `state` is a BotState: working looks down at its
 * screen and its mic blinks, watching looks from side to side, done smiles with its eyes, blocked
 * throws up its fins, asleep shuts its eyes and dims.
 */
export function botMascot(p, x, y, colors, state, t) {
  const asleep = state === 'asleep'
  const body = asleep ? dimmed(colors.body) : colors.body
  const belly = asleep ? dimmed(colors.belly) : colors.belly
  const oy = asleep ? 1 : 0
  ol(p, (q) => {
    BOT_BODY.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const col = { B: body, L: belly, H: INK, T: state === 'working' && t % 4 < 2 ? C.green : C.amber }[row[i]]
        if (col) q(x + i, y + oy + j, 1, 1, col)
      }
    })
    if (state === 'blocked') {
      q(x - 1, y + 2 + oy, 1, 3, body)
      q(x + 12, y + 2 + oy, 1, 3, body)
    }
  })
  const e = (i, j) => p(x + i, y + oy + j, 1, 1, INK)
  if (asleep || (t % 30 === 0 && state !== 'done')) {
    e(2, 6)
    e(3, 6)
    e(8, 6)
    e(9, 6)
  } else if (state === 'done') {
    e(3, 5)
    e(2, 6)
    e(4, 6)
    e(8, 5)
    e(7, 6)
    e(9, 6)
  } else {
    const dy = state === 'working' ? 1 : 0
    const dx = state === 'watching' ? ((t >> 3) % 2 ? 1 : -1) : 0
    for (const i of [3, 8]) {
      e(i + dx, 5 + dy)
      e(i + dx, 6 + dy)
    }
  }
  if (state === 'blocked') {
    e(5, 7)
    e(6, 7)
    e(4, 8)
    e(7, 8)
  } else if (state === 'done') {
    e(4, 7)
    e(7, 7)
    e(5, 8)
    e(6, 8)
  } else if (!asleep) {
    e(5, 8)
    e(6, 8)
  }
  if (festive()) ol(p, (q) => cap(q, x + 4, y + oy, 'santa'))
}

/** The ? over a bot that waits for you, the ! over a stuck one, the z over one asleep. */
function botMarks(p, cx, head, state, t) {
  if (state === 'waiting' && (t >> 2) % 2) ol(p, (q) => glyph(q, '?', cx - 1, head - 8, C.amber))
  if (state === 'blocked') ol(p, (q) => glyph(q, '!', cx - 1, head - 8, C.red))
  if (state === 'asleep') {
    const z = t % 16
    if (z < 12) ol(p, (q) => glyph(q, 'z', cx + 5 + (z >> 2), head - 3 - (z >> 2), C.white))
  }
}

/** A bot standing or walking about, its feet on the row a person's (y + 15) would be on. */
export function standingBot(p, x, y, colors, state, t, moving) {
  const bob = moving ? t % 2 : 0
  botMascot(p, x - 2, y + 3 - bob, colors, state, t)
  botMarks(p, x + 4, y + 3 - bob, state, t)
}

/** The small navy podium a bot stands on at the head of its island. */
function podium(p, x, y) {
  shadow(p, x + 1, y + 5, PODIUM_W, 2)
  ol(p, (q) => {
    q(x, y, PODIUM_W, 2, '#f4eedf')
    q(x, y + 2, PODIUM_W, 3, NAVY[1])
  })
  for (let i = 2; i < PODIUM_W; i += 4) p(x + i, y + 2, 1, 3, NAVY[3])
}

/** A bot at the head of its island, on its podium. */
function botHead(p, head, colors, t) {
  const state = head.bot.state
  const bob = state === 'working' ? t % 2 : 0
  podium(p, head.x, head.y)
  botMascot(p, head.x + 2, head.y - 12 - bob, colors, state, t)
  botMarks(p, head.x + 8, head.y - 12 - bob, state, t)
}

/** The floor map on its stand: a bar in each bot's colour, lines to the desks they run. */
function floorMap(p, x, y, colors, t) {
  ol(p, (q) => {
    q(x + 4, y + 16, 1, 6, '#7d8296')
    q(x + 27, y + 16, 1, 6, '#7d8296')
    q(x + 2, y + 21, 5, 1, '#7d8296')
    q(x + 25, y + 21, 5, 1, '#7d8296')
    q(x, y, 32, 16, '#b9bccb')
  })
  p(x + 1, y + 1, 30, 14, '#f4f5fa')
  const shown = colors.slice(0, 4)
  shown.forEach((c, i) => {
    const ry = y + 2 + i * 3
    p(x + 2, ry, 7, 2, c.body)
    p(x + 10, ry + 1, 8, 1, '#c9ccd8')
    p(x + 19 + (i % 2) * 4, ry, 2, 2, c.body)
  })
  if (!shown.length) p(x + 3, y + 4, 20, 1, '#c9ccd8')
  // a dot that walks the round on the map
  p(x + 20 + ((t >> 2) % 9), y + 12, 1, 1, C.red)
}

const SALMON = ['#e0786c', '#b4564c']

/** The coordinator's room, everything but its rug: the map, the desk, the stools and the plants. */
function coordinatorPieces(p, k, bot, colors, all, seated, t, scene) {
  const state = bot.state
  scene.push({ base: k.board.y + 22, paint: () => floorMap(p, k.board.x, k.board.y, all, t) })
  scene.push({
    base: k.desk.y + 11,
    paint: () => {
      const { x, y } = k.desk
      if (seated) {
        const bob = state === 'working' ? t % 2 : 0
        botMascot(p, k.seat.x, k.seat.y - bob, colors, state, t)
        botMarks(p, k.seat.x + 6, k.seat.y - bob, state, t)
      } else {
        ol(p, (q) => {
          q(x + 15, y - 9, 10, 6, '#4b4a5e')
          q(x + 16, y - 8, 8, 4, '#5d5c72')
        })
      }
      shadow(p, x + 1, y + 11, 40, 2)
      ol(p, (q) => {
        q(x, y, 40, 3, C.woodTop)
        q(x, y + 3, 40, 6, C.wood)
        q(x, y + 8, 40, 1, C.woodDark)
        q(x + 2, y + 9, 2, 2, C.woodDark)
        q(x + 36, y + 9, 2, 2, C.woodDark)
      })
      p(x + 17, y + 4, 6, 3, C.woodDark)
      p(x + 18, y + 5, 4, 1, '#f2b134')
      // the terminal on the desk, facing you
      ol(p, (q) => q(x + 26, y - 7, 10, 7, '#2a2833'))
      screen(p, x + 27, y - 6, 8, 5, state === 'watching' ? 'monitoring' : state === 'asleep' ? 'off' : state, t, false)
    }
  })
  for (const s of k.stools) {
    scene.push({
      base: s.y + 6,
      paint: () => {
        shadow(p, s.x, s.y + 6, 7, 1)
        ol(p, (q) => {
          q(s.x, s.y, 7, 2, SALMON[0])
          q(s.x, s.y + 2, 7, 1, SALMON[1])
          q(s.x + 3, s.y + 3, 1, 3, '#4b4a5e')
        })
      }
    })
  }
  for (const pl of k.plants) scene.push({ base: pl.y + 15, paint: () => plant(p, pl, t) })
  // the curtains down its sides, in front of everything in the hangout
  const curtain = (x) => {
    p(x, k.y, 5, k.h, INK)
    p(x + 1, k.y, 3, k.h, NAVY[1])
    for (let y = k.y + 3; y < k.y + k.h; y += 4) p(x + 1, y, 3, 1, NAVY[3])
    p(x + 3, k.y, 1, k.h, NAVY[2])
  }
  scene.push({ base: k.y + k.h, paint: () => curtain(k.x) })
  if (k.rightCurtain) scene.push({ base: k.y + k.h, paint: () => curtain(k.in1) })
}

/** The coordinator's navy rug, on the floor under everything in its room. */
function coordinatorRug(p, k) {
  const { x, y, w, h } = k.rug
  p(x, y, w, h, '#3f557a')
  p(x + 2, y + 2, w - 4, h - 4, NAVY[2])
  for (let ry = y + 6; ry < y + h - 4; ry += 7) p(x + 4, ry, w - 8, 1, '#6a84a8')
}

/** Draws a Brick sprite (from sprites.js, painted from its own corner) with the outline pass. */
export function outlinedAt(p, x, y, sprite) {
  ol(p, (q) => sprite(at(q, x, y)))
}

/** Someone standing or walking about: the Brick walker, outlined. */
export function standing(p, x, y, staff, t, moving, left, badge, pose) {
  outlinedAt(p, x, y, (q) => walker(q, staff, t, moving, left, badge, pose))
}

/** Someone on the sofa: the Brick lounger, outlined. */
export function lounging(p, x, y, staff, t, pose) {
  outlinedAt(p, x, y, (q) => lounger(q, staff, t, pose))
}

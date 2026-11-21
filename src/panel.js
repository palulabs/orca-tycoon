// Office Tycoon: every agent on this Orca host as a little pixel worker on one office floor, with
// Palú, the office dog, wandering among them.
// Each project is an open area on the floor; every worktree in it is a seat at a shared desk, with a
// worktree's children seated next to it. Subagents are specialists: they come in through the
// front door, sit on a stool at the end of their agent's desk, and leave the same way.
// The worker answers 'office.snapshot' from `orca worktree ps`; this frame polls it every 3 s
// (the rate Orca's own phone app polls at).
//
// One canvas, never rebuilt: a poll swaps the data and the next frame draws it, so a refresh
// never blanks the screen.

import {
  C,
  SEAT_H,
  SEAT_W,
  STATE_LABEL,
  bookshelf,
  booth,
  boothGlass,
  christmasTree,
  coffeeMachine,
  desk,
  festive,
  foosball,
  glyph,
  holidayLights,
  inChristmasSeason,
  kitchen,
  lounger,
  lounge,
  painter,
  person,
  pick,
  roleColor,
  setFestive,
  specialist,
  stool,
  plant,
  walker,
  paluWalk,
  paluWalkFront,
  paluWalkBack,
  paluSniff,
  dogBowls,
  paluSit,
  paluLie,
  dogBed,
  waterCooler,
  whiteboard,
  workstation,
  botColors,
  brickBot
} from './sprites.js'
import { loftGeometry, loftMinW, drawLoft, forgetSlots, layoutLoft, lounging, outlinedAt, projectOf, sitting, standing, standingBot } from './loft.js'
import {
  breakWalk,
  coordinatorSeated,
  coordinatorWalk,
  deskStayLabel,
  deskStayOf,
  nextDeskStay,
  onTheMove,
  routePlanner,
  staysAtDesk,
  stepToward,
  visitorWalk,
  walkGrid,
  walkerShown
} from './walking.js'

const POLL_MS = 3000
const FRAME_MS = 125
const BUBBLE_MS = 9000

// Geometry, in art pixels.
const OUTER = 4 // building wall
const MARGIN = 6 // floor between the building wall and the rooms
const GAP = 7 // corridor between rooms
const GLASS = 0 // open areas: no walls
const PAD = 4 // inside a room, between the glass and its furniture
const TOP = 13 // room name plaque and whiteboard
const LABEL_H = 5 // nameplate under each seat
const AISLE = 7 // walkway below each row of desks
const DESK_W = SEAT_W + 4 // one agent's desk
const STOOL_W = 9 // one stool at the end of a desk
const MAX_STOOLS = 3 // beyond this the last stool carries a + marker
const LINE_H = SEAT_H + LABEL_H + AISLE
const TABLE_GAP = 6
const MIN_ROOM_W = (DESK_W + STOOL_W + 1) * 2 + PAD * 2 + GLASS * 2
const COMMON_H = 34
const WALK_SPEED = 1.5 // art pixels per frame
// The frame loop runs at 125 ms: eight frames make each half of the teleport exactly one second.
const TELEPORT_OUT_FRAMES = 8
const TELEPORT_IN_FRAMES = 8
// Pixel scale, CSS pixels per art pixel. The office grows to the biggest scale at which the whole
// building still fits the panel, so it fills a tall or wide panel instead of stopping at its own
// height; it never drops below the width's minimum, so a crowded office scrolls as before.
const MAX_SCALE = 8
const SCROLLBAR = 16 // CSS pixels a vertical scrollbar can take from the panel's width
const MIN_ART_W = MIN_ROOM_W + (OUTER + MARGIN) * 2 // narrower than this and not even the smallest room fits
const MAX_CORRIDOR = GAP * 4 // the corridors between rooms widen to reach the panel's bottom, up to this
// States in which an agent leaves its desk for the coffee corner until the state ends.
// 'monitoring' is a finished turn waiting on background tasks; add 'waiting' to also send
// agents that wait for you.
const AWAY_STATES = new Set(['monitoring'])
// What an agent on a break can do. Each one draws an activity per period of its own (weighted,
// seeded by the agent and the period, so a reopened panel shows the same picture).
const ACTIVITIES = [
  { id: 'nap', kind: 'lounge', pose: 'nap', weight: 1.5, sleepyOnly: true },
  { id: 'sofa-coffee', kind: 'lounge', pose: 'coffee', weight: 1.5 },
  { id: 'read', kind: 'lounge', pose: 'read', weight: 1.5 },
  { id: 'coffee', kind: 'coffee', weight: 2 },
  { id: 'foosball', kind: 'foosball', weight: 3 },
  { id: 'call', kind: 'booth', weight: 2 },
  // a chat at the round table: only the loft has one
  { id: 'chat', kind: 'table', weight: 2 }
]
const ACTIVITY_MS = 60000
// States in which an agent goes and naps on the lounge sofa, while there are seats.
const LOUNGE_STATES = new Set(['done', 'idle'])

const FLOOR = { plank: '#d9c8a4', seam: '#c9b78f', joint: '#bba97f' }
const BRICK = { wall: '#b5653f', top: '#cf7a50', dark: '#8f4b2d', window: '#a8d2e6' }
const CARPETS = ['#a98260', '#7f9b74', '#8d7f9c', '#7d8ba6', '#a8936f', '#9c7575', '#6f9a99']
// Every bot's room has the navy of the loft's curtains, outside the team carpets, so it never reads as a project.
const BOT_CARPET = '#5b7597'
const BRICK_HEAD = 22 // the bot and its desk, turned toward the row, at the head of the first row
const COORD_ROOM_W = 96 // the coordinator's room beside the commons
const COORD_ROOM_H = 56 // or under it, on a floor too narrow for both side by side
const COORD_DOOR_X = 46 // its door in the top edge, between its sign and its whiteboard
const COORD_DOOR_W = 16
const STATE_NOTE = {
  working: C.green,
  monitoring: C.blue,
  waiting: C.amber,
  blocked: C.red,
  done: '#9aa0b4',
  idle: '#9aa0b4'
}

const office = document.getElementById('office')
const floor = document.getElementById('floor')
const canvas = document.getElementById('plan')
const ctx = canvas.getContext('2d')
const tooltip = document.getElementById('tooltip')
const dpr = () => window.devicePixelRatio || 1

// The layout and appearance are independent choices. Dark is persisted separately so it can be
// applied to either layout without changing it.
const LAYOUTS = ['brick', 'loft']
const THEME_KEY = 'office-tycoon.theme' // kept for compatibility: this key now stores the layout
const DARK_KEY = 'office-tycoon.dark'
const RENAMED = { classic: 'brick', dollhouse: 'loft', orbital: 'loft' } // what the layouts were called before
let layoutTheme = 'loft' // a saved choice wins; a new viewer starts in the loft
let dark = false
try {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'dark') {
    // Older releases stored Dark as a layout. Migrate it to the default layout plus the attribute.
    layoutTheme = 'loft'
    dark = true
    localStorage.setItem(THEME_KEY, layoutTheme)
    localStorage.setItem(DARK_KEY, 'true')
  } else {
    const name = RENAMED[saved] ?? saved
    if (LAYOUTS.includes(name)) layoutTheme = name
    dark = localStorage.getItem(DARK_KEY) === 'true'
  }
} catch {
  // no storage in this frame: use the defaults for this session
}
const loft = () => layoutTheme === 'loft'

// How long an agent that just finished stays at its desk before it walks to the commons, in
// seconds. The button beside the appearance switch cycles the choices; the pick is kept.
const STAY_KEY = 'office-tycoon.desk-stay'
let deskStay = deskStayOf(null)
try {
  deskStay = deskStayOf(localStorage.getItem(STAY_KEY))
} catch {
  // no storage in this frame: the default for this session
}

// Hide sleeping, as in Orca's sidebar filter: desks with nobody at work are left out, and rooms
// reflow. Off by default, like Orca's; the pick is kept.
const SLEEPING_KEY = 'office-tycoon.hide-sleeping'
let hideSleeping = false
try {
  hideSleeping = localStorage.getItem(SLEEPING_KEY) === 'true'
} catch {
  // no storage in this frame: every desk shows this session
}

/** The office as drawn: with Hide sleeping on, only desks with an agent, and teams that keep one. */
function shown(snap) {
  if (!hideSleeping || !snap) return snap
  const awake = (desks) => desks.filter((d) => d.staff.length > 0)
  return {
    ...snap,
    floors: snap.floors.map((f) => ({ ...f, desks: awake(f.desks) })).filter((f) => f.desks.length > 0),
    bots: (snap.bots ?? []).map((b) => ({ ...b, desks: awake(b.desks) }))
  }
}

// The coordinator: one bot, picked in the header, that gets a room of its own and walks the floor.
// Kept by its id, so it is the panel's choice and never a name built into the code.
const COORD_KEY = 'office-tycoon.coordinator'
let coordinatorPick = null
try {
  coordinatorPick = localStorage.getItem(COORD_KEY) || null
} catch {
  // no storage in this frame: no coordinator this session until one is picked
}

function applyDark() {
  document.documentElement.dataset.dark = String(dark)
  document.body?.setAttribute('data-dark', String(dark))
  canvas.style.filter = dark ? 'brightness(0.68) saturate(0.78) hue-rotate(8deg)' : 'none'
}
applyDark()

// Christmas dresses either look from 15 Nov through 1 Jan: the tree button shows only then, on by
// default, and a viewer who turns it off keeps it off.
const FESTIVE_KEY = 'office-tycoon.christmas'
const festiveSwitch = document.getElementById('christmas')
let festivePick = null // 'on' or 'off' once the viewer has pressed the button
try {
  festivePick = localStorage.getItem(FESTIVE_KEY)
} catch {
  // no storage in this frame: on in season, every time
}
function applySeason() {
  const season = inChristmasSeason()
  setFestive(season && festivePick !== 'off')
  if (festiveSwitch) {
    festiveSwitch.hidden = !season
    festiveSwitch.querySelector('button')?.setAttribute('aria-pressed', String(festive()))
  }
}
applySeason()
setInterval(applySeason, 60_000) // an office left open crosses into or out of the season
festiveSwitch?.querySelector('button')?.addEventListener('click', () => {
  festivePick = festive() ? 'off' : 'on'
  try {
    localStorage.setItem(FESTIVE_KEY, festivePick)
  } catch {
    // kept for this session only
  }
  applySeason()
  draw()
})

let snapshot = null // the office as drawn, after Hide sleeping
let received = null // the worker's last answer, as it came
let layout = { artW: 0, artH: 0, scale: 3, building: null, rooms: [], seats: [], common: null }
// The bots on the floor and their colours, taken from each snapshot.
let shownBots = []
let botPalette = new Map()
const BOT_KEY = 'bot:'
const botKey = (bot) => `${BOT_KEY}${bot.id}`
/** The bot a key belongs to, when it is a bot's. */
const botOf = (key) => (key?.startsWith(BOT_KEY) ? shownBots.find((b) => b.id === key.slice(BOT_KEY.length)) ?? null : null)
const colorsOf = (bot) => botPalette.get(bot.id) ?? { body: '#e0786c', belly: '#eb9a8f' }
/** The coordinator's id when that bot is in the snapshot, else null. */
const coordinatorId = () => (coordinatorPick && (snapshot?.bots ?? []).some((b) => b.id === coordinatorPick) ? coordinatorPick : null)

/**
 * The bots that show: one whose own chat is open or one of whose desks is busy, and the
 * coordinator always, asleep in its room when nothing is going on.
 */
function botsOnFloor(snap) {
  const coord = coordinatorId()
  return (snap?.bots ?? []).filter((b) => b.staff.length > 0 || b.desks.some((d) => d.staff.length > 0) || b.id === coord)
}
let selected = null // seat key, or a specialist's visitor key (`seat key|specialist id`)
let tick = 0
const lastState = new Map() // seat key -> state, to pop a bubble when it changes
const doneAt = new Map() // seat key -> when the panel saw its agent finish at its desk
const bubbles = new Map() // seat key -> { text, until }
const walkers = new Map() // seat key -> { x, y, path, mode: 'out' | 'away' | 'back' | 'teleport-*' }
const visitors = new Map() // specialist key -> { spec, x, y, path, mode: 'in' | 'seated' | 'out' }
// False until the first snapshot has been placed. Whatever that snapshot shows is already true when
// the panel opens, so it is drawn in place; only changes seen after it are walked.
let scenePrimed = false
let primed = false

function since(ms) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}

/** What a seat's nameplate reads: the worker picks it from the conversation and workspace names. */
function nameplate(seat) {
  return seat.staff.label || seat.desk.name.split(/[\s/]+/)[0] || 'workspace'
}

// ---- layout ----------------------------------------------------------------------------------

/** Root worktrees, each with all its descendants, so a family shares one desk. */
function families(desks) {
  const byId = new Map(desks.map((d) => [d.id, d]))
  const kids = new Map()
  const roots = []
  for (const d of desks) {
    if (d.parentId && byId.has(d.parentId)) {
      const list = kids.get(d.parentId) ?? []
      list.push(d)
      kids.set(d.parentId, list)
    } else roots.push(d)
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  const descend = (d) => [d, ...(kids.get(d.id) ?? []).sort(byName).flatMap(descend)]
  return roots.sort(byName).map(descend)
}

/** The seats of one family, parent first: one per agent in each worktree. */
function familySeats(family) {
  return family.flatMap((desk) =>
    [...desk.staff].sort((a, b) => a.id.localeCompare(b.id)).map((staff) => ({ desk, staff }))
  )
}

/** Specialists still at work: done ones have left. */
function activeSpecialists(staff) {
  return staff.specialists.filter((sp) => sp.state !== 'done' && sp.state !== 'idle').sort((a, b) => a.id.localeCompare(b.id))
}

/** An agent's desk plus its stools: always one free stool, up to MAX_STOOLS. */
function stoolCount(staff) {
  return Math.max(1, Math.min(MAX_STOOLS, activeSpecialists(staff).length))
}

function segmentW(seat) {
  return DESK_W + stoolCount(seat.staff) * STOOL_W + 1
}

/** Splits families into tables no wider than the room, then packs tables into lines. */
function planRoom(floor, innerW) {
  const tables = []
  // Brick seats agents only: a sleeping worktree has no desk here, nor ties its children together
  for (const family of families(floor.desks.filter((d) => d.staff.length > 0))) {
    let table = []
    let width = 0
    for (const seat of familySeats(family)) {
      const w = segmentW(seat)
      if (table.length && width + w > innerW) {
        tables.push(table)
        table = []
        width = 0
      }
      table.push(seat)
      width += w
    }
    if (table.length) tables.push(table)
  }
  const tableW = (table) => table.reduce((n, seat) => n + segmentW(seat), 0)
  const lines = []
  let line = []
  let width = 0
  for (const table of tables) {
    const w = tableW(table)
    if (line.length && width + TABLE_GAP + w > innerW) {
      lines.push(line)
      line = []
      width = 0
    }
    width += (line.length ? TABLE_GAP : 0) + w
    line.push(table)
  }
  if (line.length) lines.push(line)
  return { lines, tableW }
}

/**
 * The office at one scale. `corridor` is the floor between a room and whatever lies above or
 * below it, another room or the commons band; fitLayout widens it to fill the panel.
 */
function computeLayout(cssW, scale, corridor = GAP) {
  const artW = Math.floor(cssW / scale)
  const floorW = artW - OUTER * 2 - MARGIN * 2
  const cols = Math.max(1, Math.floor((floorW + GAP) / (MIN_ROOM_W + GAP)))
  const roomW = Math.floor((floorW - GAP * (cols - 1)) / cols)
  const innerW = roomW - GLASS * 2 - PAD * 2

  // Plan every area first, so the commons band can go where it splits the floor in two.
  // A team that would need three or more rows of desks in one column gets the whole floor width
  // instead, so it spreads across rather than down. Biggest teams go first.
  const fullInner = floorW - GLASS * 2 - PAD * 2
  const seatCount = (floor) => floor.desks.reduce((n, d) => n + d.staff.length, 0)
  const coordBot = shownBots.find((b) => b.id === coordinatorId()) ?? null
  const planOf = (floor, bot = null, head = 0) => {
    let plan = { ...planRoom(floor, innerW - head), w: roomW, inner: innerW, wide: false }
    if (cols > 1 && plan.lines.length >= 3) plan = { ...planRoom(floor, fullInner - head), w: floorW, inner: fullInner, wide: true }
    // a bot's room keeps its row while none of its desks is awake, for the bot at its head, and
    // has a little more floor for the project tags under its nameplates
    return { floor, ...plan, h: TOP + Math.max(bot ? 1 : 0, plan.lines.length) * LINE_H + PAD + (bot ? 4 : 0), bot, head }
  }
  // the bots' rooms first, one each; the coordinator's only when it runs desks, as in the loft
  const botPlans = shownBots
    .filter((bot) => bot !== coordBot || bot.desks.length > 0)
    .map((bot) => planOf({ repo: bot.name, desks: bot.desks }, bot, bot === coordBot ? 0 : BRICK_HEAD))
  const plans = [
    ...botPlans,
    ...(snapshot?.floors ?? [])
      .map((floor) => planOf(floor))
      .sort((a, b) => seatCount(b.floor) - seatCount(a.floor) || a.floor.repo.localeCompare(b.floor.repo))
  ]
  // Open areas need not line up: each one goes into the column that is shortest so far, and a
  // full-width team starts below everything placed before it.
  const pack = (list, top) => {
    const colY = Array.from({ length: cols }, () => top)
    const placed = list.map((plan) => {
      if (plan.wide) {
        const y = Math.max(...colY)
        colY.fill(y + plan.h + corridor)
        return { plan, x: OUTER + MARGIN, y }
      }
      const col = colY.indexOf(Math.min(...colY))
      const at = { plan, x: OUTER + MARGIN + col * (roomW + GAP), y: colY[col] }
      colY[col] += plan.h + corridor
      return at
    })
    return { placed, bottom: Math.max(...colY) }
  }
  // Split the areas so the band lands as close to the middle as it can.
  let split = plans.length
  let best = Infinity
  for (let k = 1; k <= plans.length; k++) {
    const above = pack(plans.slice(0, k), 0).bottom
    const below = pack(plans.slice(k), 0).bottom
    if (Math.abs(above - below) < best) {
      best = Math.abs(above - below)
      split = k
    }
  }
  const top = pack(plans.slice(0, split), OUTER + MARGIN)

  // The commons band across the middle: lounge, coffee corner (water dispenser, coffee machine)
  // and kitchen. Wide floors put them side by side; narrow ones stack the lounge above.
  // The coordinator's room stands beside the commons at its right end, when the floor is wide
  // enough for both; the commons lays itself out in what is left.
  const coordBeside = Boolean(coordBot) && floorW - COORD_ROOM_W - GAP >= MIN_ROOM_W
  const cw = coordBeside ? floorW - COORD_ROOM_W - GAP : floorW
  const wide = cw >= 150
  const bandY = plans.length ? top.bottom : OUTER + MARGIN
  const rows = wide ? 2 : 3
  const bandH = COMMON_H * rows
  const gamesY = bandY + COMMON_H * (rows - 1)
  const entry = 10 // a clear strip by the door
  const common = { x: OUTER + MARGIN, y: bandY, w: cw, h: bandH }
  const loungeW = wide ? Math.floor((cw - GAP) / 2) - entry : cw - entry
  const cornerX = wide ? common.x + entry + loungeW + GAP : common.x + entry
  const cornerY = wide ? bandY : bandY + COMMON_H
  common.lounge = { x: common.x + entry, y: bandY + 4, w: loungeW }
  common.cooler = { x: cornerX + 2, y: cornerY + 2 }
  common.coffee = { x: cornerX + 12, y: cornerY + 4 }
  common.kitchen = { x: cornerX + 24, y: cornerY + 6, w: Math.max(30, common.x + cw - cornerX - 24) }
  common.laneTop = bandY - 4
  common.laneBottom = bandY + bandH - 8
  common.spots = []
  for (let sx = cornerX; sx + 8 <= common.x + cw; sx += 9) common.spots.push({ x: sx, y: cornerY + 17, kind: 'coffee' })
  // the games row: a foosball table, and calling booths along the right
  const fx = common.x + entry + 12
  common.foosball = { x: fx, y: gamesY + 7 }
  // players stand on the long sides, where the rods stick out: one behind the table facing you,
  // one in front with their back to you
  common.foos = [
    { x: fx + 5, y: gamesY + 7 - 15, kind: 'foosball', left: false, back: false },
    { x: fx + 15, y: gamesY + 7 + 12, kind: 'foosball', left: false, back: true }
  ]
  common.booths = []
  const boothCount = wide ? 3 : 2
  for (let i = 0; i < boothCount; i++) {
    const bx = common.x + cw - (i + 1) * 16
    common.booths.push({ x: bx + 2, y: gamesY + 9, kind: 'booth', left: true, bx, by: gamesY + 5 })
  }
  common.sofa = []
  const sofaSeats = Math.min(6, Math.floor((loungeW - 12) / 9))
  for (let i = 0; i < sofaSeats; i++) common.sofa.push({ x: common.lounge.x + 6 + i * 9, y: common.lounge.y + 1, kind: 'lounge' })
  // The front door is in the left wall, level with the band.
  const doorY = bandY + 8
  // Palú's bed: in the games row between the foosball table and the booths when it fits, else in
  // a corner of the lounge rug. His bowls go beside the bed when there is room for both, else in
  // the lounge's front corner by the door.
  const gapStart = fx + 34
  const gapEnd = common.x + cw - boothCount * 16
  const gap = gapEnd - gapStart
  if (gap >= 48) {
    // bowls first, with room on their left to stand clear of the foosball table, then the bed
    common.bowls = { x: gapStart + 8 + Math.floor((gap - 48) / 2), y: gamesY + 18 }
    common.bed = { x: common.bowls.x + 16, y: gamesY + 14 }
  } else {
    common.bed =
      gap >= 30
        ? { x: gapStart + Math.floor((gap - 24) / 2), y: gamesY + 14 }
        : { x: common.lounge.x + common.lounge.w - 27, y: common.lounge.y + 16 }
    common.bowls = { x: common.lounge.x + 3, y: common.lounge.y + 19 }
  }

  // on a floor too narrow for both side by side, the coordinator's room stands under the commons
  const coordBox = !coordBot
    ? null
    : coordBeside
      ? { x: common.x + cw + GAP, y: bandY, w: COORD_ROOM_W, h: bandH }
      : { x: OUTER + MARGIN, y: bandY + bandH + corridor, w: floorW, h: COORD_ROOM_H }
  const below = coordBox && !coordBeside ? COORD_ROOM_H + corridor : 0
  const bottom = pack(plans.slice(split), bandY + bandH + corridor + below)
  const rooms = []
  const seats = []
  for (const { plan, x, y: ry } of [...top.placed, ...bottom.placed]) {
    const { floor, lines, tableW, h } = plan
    const room = { x, y: ry, w: plan.w, h, name: floor.repo, carpet: plan.bot ? BOT_CARPET : pick(CARPETS, floor.repo), notes: [] }
    if (plan.bot) room.bot = plan.bot
    // a bot with no desk awake sits at a little desk of its own, its station, in the middle
    if (plan.head && !lines.length) room.head = { bot: plan.bot, x: room.x + GLASS + PAD + Math.floor((plan.inner - DESK_W) / 2) + 2, y: room.y + TOP, station: true }
    lines.forEach((line, li) => {
      const lineW = line.reduce((n, t) => n + tableW(t), 0) + TABLE_GAP * (line.length - 1)
      let tx = room.x + GLASS + PAD + plan.head + Math.floor((plan.inner - plan.head - lineW) / 2)
      const ty = room.y + TOP + li * LINE_H
      if (li === 0 && plan.head) room.head = { bot: plan.bot, x: tx - plan.head, y: ty }
      for (const table of line) {
        for (const { desk: d, staff } of table) {
          const n = stoolCount(staff)
          const stools = Array.from({ length: n }, (_, i) => ({ x: tx + DESK_W + 1 + i * STOOL_W, y: ty + 19 }))
          const overflow = Math.max(0, activeSpecialists(staff).length - MAX_STOOLS)
          seats.push({ key: `${d.id}|${staff.id}`, x: tx + 2, y: ty, desk: d, staff, room, stools, overflow })
          room.notes.push(STATE_NOTE[staff.state])
          tx += DESK_W + n * STOOL_W + 1
        }
        tx += TABLE_GAP
      }
    })
    rooms.push(room)
  }
  let coordinator = null
  if (coordBox) {
    const room = { ...coordBox, name: coordBot.name, carpet: BOT_CARPET, notes: [...botPalette.values()].map((c) => c.body), bot: coordBot, coord: true }
    rooms.push(room)
    // its desk by the sign, its door in the top edge onto the hallway
    const seat = { x: room.x + 8, y: room.y + 12 }
    coordinator = {
      bot: coordBot,
      room,
      seat,
      home: { x: seat.x + 6, y: seat.y + SEAT_H + LABEL_H - 4 },
      entrance: { x: room.x + COORD_DOOR_X + 4, y: room.y + 2 },
      door: { x: room.x + COORD_DOOR_X, w: COORD_DOOR_W },
      stops: rooms
        .filter((r) => r.head)
        .map((r) => ({ at: { x: r.head.x + 2, y: r.head.y + SEAT_H + LABEL_H - 4 }, say: `Checking on ${r.head.bot.name}` }))
    }
  }
  const y = Math.max(bottom.bottom, bandY + bandH + corridor + below) - corridor + MARGIN
  const building = { w: artW, h: y + OUTER, doorY }
  const teamCount = plans.filter((plan) => !plan.bot).length
  return { artW, artH: building.h, scale, building, rooms, seats, common, coordinator, teamCount }
}

/**
 * Lays the office out at the biggest scale that fits the panel, then stretches the building to the
 * panel's bottom edge: first by widening the corridors between rooms, then with floor above the
 * bottom wall. Scales step by whole CSS pixels, or by whole device pixels on a display with an
 * integer pixel ratio, so the art stays crisp.
 */
function fitLayout() {
  // The box's exact size, floored: clientWidth and clientHeight round, and a canvas half a pixel
  // taller than the box would summon a scrollbar.
  const box = office.getBoundingClientRect()
  const cssW = Math.max(180, Math.floor(box.width))
  const cssH = Math.floor(box.height)
  const perPx = Number.isInteger(dpr()) ? dpr() : 1 // scale steps per CSS pixel
  if (loft()) return fitLoft(cssW, cssH, perPx)
  const minScale = cssW >= 300 ? 3 : 2
  // The building at this scale, stretched to the panel's bottom; null when it is too tall as it is.
  const fill = (scale) => {
    const rows = Math.floor(cssH / scale)
    let fit = null
    for (let corridor = GAP; corridor <= MAX_CORRIDOR; corridor++) {
      const wider = computeLayout(cssW, scale, corridor)
      if (wider.artH > rows) break
      fit = wider
    }
    if (fit) fit.artH = fit.building.h = rows
    return fit
  }
  // the coordinator's room stands beside the commons, which needs the floor for both
  const minW = coordinatorId() && shownBots.some((b) => b.id === coordinatorId()) ? MIN_ART_W + COORD_ROOM_W + GAP : MIN_ART_W
  for (let n = MAX_SCALE * perPx; n / perPx > minScale; n--) {
    const scale = n / perPx
    if (Math.floor(cssW / scale) < minW) continue
    const filled = fill(scale)
    if (filled) return filled
  }
  return fill(minScale) ?? computeLayout(cssW, minScale)
}

/** The loft at the biggest scale at which it fits, its floor stretched to the panel's bottom. */
function fitLoft(cssW, cssH, perPx) {
  const helpers = { families, familySeats, activeSpecialists }
  const bots = { list: shownBots, coordinator: coordinatorId() }
  const coord = shownBots.some((b) => b.id === bots.coordinator)
  const minW = loftMinW({ heads: shownBots.some((b) => b.id !== bots.coordinator), coordinator: coord })
  const minScale = 2
  for (let n = MAX_SCALE * perPx; n / perPx >= minScale; n--) {
    const scale = n / perPx
    if (Math.floor(cssW / scale) < minW && scale > minScale) continue
    const rows = Math.floor(cssH / scale)
    const fit = layoutLoft(snapshot, cssW, scale, helpers, rows, bots)
    if (fit.artH <= rows) {
      fit.artH = fit.building.h = rows
      return fit
    }
  }
  // too tall for the panel at any scale: it scrolls, so leave room for the scrollbar across
  return layoutLoft(snapshot, cssW - SCROLLBAR, minScale, helpers, Math.floor(cssH / minScale), bots)
}

/**
 * Device rows for a canvas as tall as the panel. Its CSS height has to be a whole number of CSS
 * pixels: otherwise, at some pixel ratios (1.1, 1.25, 1.75), the browser shows it a hair short and
 * one row of the picture is lost. So the first such number of rows at or above the panel's height;
 * the few over sit below the panel's edge.
 */
function canvasRows(cssH) {
  const rows = Math.round(cssH * dpr())
  for (let n = rows; n < rows + 64; n++) if (wholeCss(n) !== null) return n
  return rows
}

/** `rows` device pixels as a whole number of CSS pixels, or null if they are not one. */
function wholeCss(rows) {
  const css = rows / dpr()
  return Math.abs(css - Math.round(css)) < 1e-3 ? Math.round(css) : null
}

function resize(paint = true) {
  layout = fitLayout()
  layout.dark = dark
  const w = Math.round(layout.artW * layout.scale * dpr())
  const h = Math.round(layout.artH * layout.scale * dpr())
  // The floor takes the whole office's size, so the panel scrolls over it; the canvas is only as
  // tall as the panel shows, below any scrollbar across it, in whole device pixels so the picture
  // is never stretched. A big team's office is many times taller than the panel, and a canvas that
  // size is slow for the browser to put on screen every frame.
  floor.style.width = `${w / dpr()}px`
  floor.style.height = `${h / dpr()}px`
  const shown = Math.min(h, canvasRows(office.clientHeight))
  const shownCss = wholeCss(shown) ?? shown / dpr()
  // Only touch the backing size when it changes: assigning it clears the canvas.
  if (canvas.width !== w || canvas.height !== shown) {
    canvas.width = w
    canvas.height = shown
  }
  canvas.style.width = `${w / dpr()}px`
  canvas.style.height = `${shownCss}px`
  // the rows below the panel's edge must not hold the canvas off the top at the end of the scroll
  canvas.style.marginBottom = `${-Math.max(0, shownCss - office.clientHeight)}px`
  if (paint) draw()
}

/** How far the floor has scrolled under the canvas, in device pixels. */
const scrolled = () => Math.round(office.scrollTop * dpr())

// ---- drawing ---------------------------------------------------------------------------------

function artTransform() {
  const k = layout.scale * dpr()
  ctx.setTransform(k, 0, 0, k, 0, -scrolled())
  ctx.imageSmoothingEnabled = false
  ctx.filter = 'none'
}

function cssTransform() {
  const d = dpr()
  ctx.setTransform(d, 0, 0, d, 0, -scrolled())
  ctx.filter = 'none'
}

function drawBuilding(p) {
  const { w, h } = layout.building
  p(0, 0, w, h, BRICK.wall)
  p(0, 0, w, 1, BRICK.top)
  p(0, h - 1, w, 1, BRICK.dark)
  // floorboards
  p(OUTER, OUTER, w - OUTER * 2, h - OUTER * 2, FLOOR.plank)
  for (let y = OUTER + 3; y < h - OUTER; y += 4) {
    p(OUTER, y, w - OUTER * 2, 1, FLOOR.seam)
    const offset = ((y >> 2) * 13) % 24
    for (let x = OUTER + offset; x < w - OUTER; x += 24) p(x, y - 3, 1, 3, FLOOR.joint)
  }
  // front door in the left wall, level with the commons band, with a doormat
  const dy = layout.building.doorY
  const isXmas = festive()
  p(0, dy - 2, OUTER, 19, FLOOR.plank)
  p(0, dy - 3, OUTER, 1, BRICK.dark)
  p(0, dy + 17, OUTER, 1, BRICK.dark)
  p(OUTER, dy + 1, 3, 14, isXmas ? '#b4202a' : '#7a4f3a')
  if (isXmas) p(OUTER + 1, dy + 3, 1, 10, '#238547')
  // windows in the top wall, light falling in
  for (let x = 14; x + 12 < w - 8; x += 40) {
    p(x, 0, 12, 3, isXmas ? '#3b5878' : BRICK.window)
    p(x + 5, 0, 1, 3, '#dceff7')
    if (isXmas) {
      const snowX = x + 1 + ((tick + x) % 4) * 2
      const snowY = (tick >> 1) % 3
      p(snowX, snowY, 1, 1, C.white)
      p(x + 8, (snowY + 1) % 3, 1, 1, C.white)
    }
  }
  if (isXmas) {
    holidayLights(painter(ctx, OUTER, OUTER), w - OUTER * 2, tick)
  }
}

function drawRoom(p, room) {
  const { x, y, w, h } = room
  // An area rug with rounded corners and a darker rim, so the zone reads without walls.
  p(x + 2, y, w - 4, h, room.carpet)
  p(x, y + 2, w, h - 4, room.carpet)
  p(x + 1, y + 1, w - 2, h - 2, room.carpet)
  p(x + 3, y + 2, w - 6, 1, 'rgba(255,255,255,0.10)')
  p(x + 2, y + h - 1, w - 4, 1, 'rgba(0,0,0,0.18)')
  p(x + w - 1, y + 2, 1, h - 4, 'rgba(0,0,0,0.12)')
  // speckle so the carpet reads as fabric
  for (let i = 0; i < (w * h) / 40; i++) {
    const sx = x + 2 + ((i * 37) % (w - 4))
    const sy = y + 2 + ((i * 53) % (h - 4))
    p(sx, sy, 1, 1, 'rgba(255,255,255,0.08)')
  }
  // name plaque and a whiteboard of sticky notes; the plant and bookshelf stand on the floor and
  // are drawn with the scenery, in depth order. In the coordinator's room the whiteboard is the
  // floor map: a note in each bot's colour.
  p(x + 3, y + 3, plaqueW(room), 7, '#2a2633')
  const boardW = boardWOf(room)
  if (boardW > 8) whiteboard(painter(ctx, x + w - boardW - 4, y + 3), boardW, room.notes)
  // the coordinator's door: a wooden strip in its top edge, onto the hallway
  if (room.coord && layout.coordinator) {
    const { door } = layout.coordinator
    p(door.x, y - 1, door.w, 3, '#6b4226')
    p(door.x, y - 1, door.w, 1, '#8a5a3a')
  }
  if (festive()) {
    holidayLights(painter(ctx, x + 2, y), w - 4, tick)
  }
}

/** Where an area's plant (7 x 9) and bookshelf (12 x 9, roomy areas and the coordinator's) stand. */
function roomDecor(room) {
  const { x, y, w, h } = room
  const decor = [{ kind: 'plant', x: x + 3, y: y + h - 11 }]
  if ((w > 90 && h > 50) || room.coord) decor.push({ kind: 'bookshelf', x: x + w - 15, y: y + h - 12 })
  return decor
}

/** An area's name plaque, and its whiteboard (none in a narrow area). */
const plaqueW = (room) => (room.coord ? COORD_DOOR_X - 6 : Math.min(room.w - 40, 56))
const boardWOf = (room) => (room.coord ? 26 : Math.min(26, room.w - 70))

/** Everything standing on the floor, each with the box it covers and the row its base is on. */
function commonItems(c) {
  const decor = layout.rooms.flatMap(roomDecor).map((d) =>
    d.kind === 'plant'
      ? { box: [d.x, d.y, 7, 9], base: d.y + 9, draw: () => plant(painter(ctx, d.x, d.y), tick) }
      : { box: [d.x, d.y, 12, 9], base: d.y + 9, draw: () => bookshelf(painter(ctx, d.x, d.y)) }
  )
  if (!c) return decor.sort((a, b) => a.base - b.base)
  const playing = [...walkers.values()].filter((w) => w.mode === 'away' && w.activity?.kind === 'foosball').length >= 2
  const { lounge: l, kitchen: k, foosball: f, cooler, coffee, bowls } = c
  const items = [
    { box: [bowls.x, bowls.y, 13, 4], base: bowls.y + 4, draw: () => dogBowls(painter(ctx, bowls.x, bowls.y), tick) },
    { box: [l.x, l.y, l.w, 26], base: l.y + 14, draw: () => lounge(painter(ctx, l.x, l.y), l.w) },
    { box: [k.x, k.y - 6, k.w, 18], base: k.y + 12, draw: () => kitchen(painter(ctx, k.x, k.y), k.w) },
    ...c.booths.map((b) => ({ box: [b.bx, b.by, 13, 24], base: b.by + 24, draw: () => booth(painter(ctx, b.bx, b.by)) })),
    { box: [f.x - 2, f.y - 2, 32, 18], base: f.y + 14, draw: () => foosball(painter(ctx, f.x, f.y), tick, playing) },
    { box: [cooler.x, cooler.y, 7, 16], base: cooler.y + 16, draw: () => waterCooler(painter(ctx, cooler.x, cooler.y), tick) },
    { box: [coffee.x, coffee.y, 9, 14], base: coffee.y + 14, draw: () => coffeeMachine(painter(ctx, coffee.x, coffee.y), tick) },
    ...decor
  ]
  if (festive()) {
    const tx = l.x - 11
    const ty = l.y + 3
    items.push({
      box: [tx, ty, 15, 21],
      base: ty + 20,
      draw: () => christmasTree(painter(ctx, tx, ty), tick)
    })
    const lastBoothX = c.booths[c.booths.length - 1]?.bx ?? 0
    if (lastBoothX - (c.bed.x + 24) >= 18) {
      const tx2 = c.bed.x + 26
      const ty2 = c.bed.y - 8
      items.push({
        box: [tx2, ty2, 15, 21],
        base: ty2 + 20,
        draw: () => christmasTree(painter(ctx, tx2, ty2), tick)
      })
    }
  }
  return items.sort((a, b) => a.base - b.base)
}

const overlaps = ([ax, ay, aw, ah], [bx, by, bw, bh]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah

/** Palú and everyone walking, each with the box they cover and the row their feet are on. */
function movers() {
  const list = []
  const person = (id, x, y, draw) => {
    const at = painter(ctx, Math.round(x), Math.round(y))
    list.push({ id, box: [Math.round(x), Math.round(y) - 1, 8, 16], base: Math.round(y) + 15, draw: () => draw(at) })
  }
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    if (w && (w.path.length || w.mode.startsWith('teleport'))) {
      person(seat.key, w.x, w.y, (at) => {
        walker(at, seat.staff, tick, onTheMove(w), w.left)
        if (w.mode.startsWith('teleport')) teleportEffect(at, 0, 0, w.warp, w.mode)
      })
    }
  }
  for (const [key, v] of visitors) {
    if (v.mode !== 'seated' && !(v.wait > 0)) person(key, v.x, v.y, (at) => walker(at, v.spec, tick, onTheMove(v), v.left, roleColor(v.spec.role)))
  }
  const dog = paluBox()
  if (dog) list.push({ id: 'palu', ...dog, draw: drawPalu })
  return list.sort((a, b) => a.base - b.base)
}

/** Draws the commons; returns who was drawn among the furniture, behind something. */
function drawCommon() {
  const c = layout.common
  // his bed is on the floor, under everything
  if (c) dogBed(painter(ctx, c.bed.x, c.bed.y))
  const items = commonItems(c)
  const before = new Map() // item -> who passes just behind it
  for (const m of movers()) {
    const inFront = items.find((i) => i.base > m.base && overlaps(i.box, m.box))
    if (inFront) before.set(inFront, [...(before.get(inFront) ?? []), m])
  }
  const behind = new Set()
  for (const item of items) {
    for (const m of before.get(item) ?? []) {
      m.draw()
      behind.add(m.id)
    }
    item.draw()
  }
  return behind
}

// ---- walking to the coffee corner ------------------------------------------------------------

/** Where an agent stands when it gets up: the aisle in front of its seat. */
function homeOf(seat) {
  if (loft()) return loftGeometry.homeOf(seat)
  return { x: seat.x + 6, y: seat.y + SEAT_H + LABEL_H - 4 }
}

/** From where someone is to `to`, around the desks and furniture in the way; null while planning. */
function walkPath(key, from, to) {
  const route = floorRoute(key, from, to, 'people')
  return route === undefined ? null : route ?? [{ x: to.x, y: to.y }]
}

function hashOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  // FNV alone barely moves when only the last character differs; mix the bits so draws are independent
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const activityOf = new Map() // seat key -> activity id, for drawing the right pose

// Each agent on a break keeps its activity for its own period (45 to 90 s, from its own offset),
// so they change one at a time, and keeps its spot until then, so nobody else is shuffled.
const assigned = new Map() // seat key -> { slot, a, kind, index }

function slotOf(key, now) {
  const period = ACTIVITY_MS * (0.75 + 0.75 * hashOf(`${key}|period`))
  const offset = hashOf(`${key}|offset`) * period
  return Math.floor((now + offset) / period)
}

/** The spot for every agent on a break; full places pass on, nobody plays foosball alone. */
function assignBreaks(common) {
  const now = Date.now()
  const pools = { lounge: common.sofa, coffee: common.spots, foosball: common.foos, booth: common.booths, table: common.table ?? [] }
  // one that just finished stays at its desk a while first
  const onBreak = layout.seats.filter(
    (s) => (AWAY_STATES.has(s.staff.state) || LOUNGE_STATES.has(s.staff.state)) && !staysAtDesk(doneAt.get(s.key), now, deskStay)
  )
  const onKeys = new Set(onBreak.map((s) => s.key))
  for (const key of assigned.keys()) if (!onKeys.has(key)) assigned.delete(key)

  const taken = { lounge: new Set(), coffee: new Set(), foosball: new Set(), booth: new Set(), table: new Set() }
  const pending = []
  for (const seat of onBreak) {
    const slot = slotOf(seat.key, now)
    const sleepy = LOUNGE_STATES.has(seat.staff.state)
    const e = assigned.get(seat.key)
    const keep = e && e.slot === slot && e.index < pools[e.kind].length && (sleepy || !e.a.sleepyOnly) && !taken[e.kind].has(e.index)
    if (keep) taken[e.kind].add(e.index)
    else {
      assigned.delete(seat.key)
      pending.push({ seat, slot, sleepy })
    }
  }
  const ranked = ({ seat, slot, sleepy }) =>
    ACTIVITIES.filter((a) => sleepy || !a.sleepyOnly)
      .map((a, i) => ({ a, score: -Math.log(1e-9 + hashOf(`${seat.key}|${slot}|${i}`)) / a.weight }))
      .sort((x, y) => x.score - y.score)
      .map((r) => r.a)
  const place = (p, skip = []) => {
    for (const a of ranked(p)) {
      if (skip.includes(a.kind)) continue
      const index = pools[a.kind].findIndex((_, i) => !taken[a.kind].has(i))
      if (index >= 0) {
        taken[a.kind].add(index)
        assigned.set(p.seat.key, { slot: p.slot, a, kind: a.kind, index })
        return
      }
    }
  }
  pending.sort((x, y) => hashOf(`${x.seat.key}|${x.slot}|turn`) - hashOf(`${y.seat.key}|${y.slot}|turn`))
  for (const p of pending) place(p)
  // Nobody plays foosball alone, and nobody chats alone: a lone one picks something else.
  // Re-placed away from both, so nobody bounces from one lonely game into the other.
  const TOGETHER = ['foosball', 'table']
  for (const kind of TOGETHER) {
    const players = [...assigned].filter(([, e]) => e.kind === kind)
    if (players.length !== 1) continue
    const [key, e] = players[0]
    assigned.delete(key)
    taken[kind].delete(e.index)
    const seat = onBreak.find((s) => s.key === key)
    place({ seat, slot: e.slot, sleepy: LOUNGE_STATES.has(seat.staff.state) }, TOGETHER)
  }

  activityOf.clear()
  const spotOf = new Map()
  for (const [key, e] of assigned) {
    spotOf.set(key, pools[e.kind][e.index])
    activityOf.set(key, e.a)
  }
  return spotOf
}

/** Whether someone at `at` (the top left of its 9 x 16 figure) has its feet in the commons. */
function inCommons(common, at) {
  const x = at.x + 4
  const feet = at.y + 15
  return x >= common.x && x <= common.x + common.w && feet >= common.y && feet <= common.y + common.h
}

function stepWalkers() {
  const common = layout.common
  if (!common) return
  const spotOf = assignBreaks(common)
  const live = new Set(layout.seats.map((s) => s.key))
  for (const key of walkers.keys()) if (!live.has(key)) walkers.delete(key)

  for (const seat of layout.seats) {
    const w = breakWalk(
      walkers.get(seat.key),
      { spot: spotOf.get(seat.key), activity: activityOf.get(seat.key) ?? null, home: homeOf(seat), primed: scenePrimed },
      (from, to) => walkPath(`walk:${seat.key}`, from, to),
      WALK_SPEED,
      { out: TELEPORT_OUT_FRAMES, in: TELEPORT_IN_FRAMES, inCommons: (at) => inCommons(common, at) }
    )
    if (w) walkers.set(seat.key, w)
    else walkers.delete(seat.key)
  }
}

/** A hard-edged pixel portal that makes a break-to-desk return read as a teleport, not a walk. */
function teleportEffect(p, x, y, frame, mode) {
  const departure = mode === 'teleport-out'
  const progress = departure ? frame : TELEPORT_IN_FRAMES - 1 - frame
  const radius = 4 + Math.min(8, progress)
  const span = 2 + Math.min(4, Math.floor(progress / 2))
  const cx = x + 4
  const cy = y + 7
  const color = departure ? C.blue : C.green
  const highlight = C.white
  const left = cx - radius
  const right = cx + radius
  const top = cy - radius
  const bottom = cy + radius

  // Four opaque corner brackets expand on departure and contract on arrival. No alpha or blur is
  // used, so this stays crisp at the panel's pixel scale and cannot flash the whole canvas.
  p(left, top, span, 1, color)
  p(right - span + 1, top, span, 1, color)
  p(left, bottom, span, 1, color)
  p(right - span + 1, bottom, span, 1, color)
  p(left, top, 1, span, color)
  p(right, top, 1, span, color)
  p(left, bottom - span + 1, 1, span, color)
  p(right, bottom - span + 1, 1, span, color)

  // A square pulse makes the midpoint legible even when the worker is small on a tall panel.
  if (progress % 3 === 1) {
    p(cx - 1, top + 2, 2, radius * 2 - 3, highlight)
    p(left + 2, cy - 1, radius * 2 - 3, 2, highlight)
  }

  // Fixed, opaque fragments give the effect a discrete pixel-art rhythm rather than a fade.
  if (progress % 2 === 0) {
    p(left - 2, cy - 1, 2, 2, highlight)
    p(right + 1, cy + 2, 2, 1, highlight)
  } else {
    p(cx - 1, top - 2, 2, 1, highlight)
    p(cx + 3, bottom + 1, 1, 2, highlight)
  }
}

// ---- specialists coming and going -------------------------------------------------------------

const DOOR_LANE_X = OUTER + 1

/** Where a specialist waits in the aisle before stepping onto the stool, and the stool itself. */
function stoolStops(seat, stoolAt) {
  if (loft()) return loftGeometry.stoolStops(seat, stoolAt)
  return { aisle: { x: stoolAt.x - 1, y: seat.y + SEAT_H + LABEL_H - 8 }, on: { x: stoolAt.x - 1, y: seat.y + 6 } }
}

const doorStep = () => ({ x: DOOR_LANE_X, y: layout.building.doorY })

/** To the stool, from wherever they are; from outside, through the front door first. */
function routeIn(key, v, seat, stoolAt) {
  const { aisle, on } = stoolStops(seat, stoolAt)
  const from = v.x < DOOR_LANE_X ? doorStep() : v
  const path = walkPath(`visit:${key}`, from, aisle)
  return path && [...(from === v ? [] : [from]), ...path, on]
}

/** Off the stool into the aisle, across the floor to the front door, and out. */
function routeOut(key, v) {
  const door = doorStep()
  const from = v.mode === 'seated' ? v.aisle : v
  const path = walkPath(`visit:${key}`, from, door)
  return path && [...(from === v ? [] : [from]), ...path, { x: -10, y: door.y }]
}

function stepVisitors() {
  if (!layout.common || !layout.building) return
  const wanted = new Map()
  for (const seat of layout.seats) {
    activeSpecialists(seat.staff)
      .slice(0, Math.min(MAX_STOOLS, seat.stools.length))
      .forEach((spec, i) => wanted.set(`${seat.key}|${spec.id}`, { seat, spec, stoolAt: seat.stools[i] }))
  }
  for (const [key, { seat, spec, stoolAt }] of wanted) {
    let v = visitors.get(key)
    const stops = stoolStops(seat, stoolAt)
    if (!v) {
      // Already here when the panel opened: seated straight away. Later arrivals walk in.
      // Several arriving together come through the door one after another.
      // A walk in starts once its route is planned; until then they are not here yet.
      const queued = [...visitors.values()].filter((o) => o.mode === 'in' && o.x < DOOR_LANE_X).length
      const outside = { x: -8, y: layout.building.doorY }
      const path = scenePrimed ? routeIn(key, outside, seat, stoolAt) : []
      if (!path) continue
      v = scenePrimed
        ? { spec, ...outside, path, mode: 'in', aisle: stops.aisle, stoolAt, wait: queued * 10 }
        : { spec, ...stops.on, path, mode: 'seated', aisle: stops.aisle, stoolAt }
      visitors.set(key, v)
      continue
    }
    v.spec = spec
    v.aisle = stops.aisle
  }
  for (const [key, v] of visitors) {
    const want = wanted.get(key)
    const stool = want ? { at: want.stoolAt, on: stoolStops(want.seat, want.stoolAt).on } : null
    const here = visitorWalk(
      v,
      stool,
      (from) => routeIn(key, from, want.seat, want.stoolAt),
      (from) => routeOut(key, from),
      WALK_SPEED
    )
    if (here) continue
    visitors.delete(key)
    if (selected === key) selected = null
  }
}

// ---- Palú, the office dog ----------------------------------------------------------------------
// Purely for company: he never takes a seat or changes what anyone does. Mostly he wanders the
// floor; now and then he naps in his bed, or lies down at someone's desk and naps there a while,
// more often beside someone who is dozing too.

const PALU_SPEED = 1
const PALU_AISLE = 3
let palu = null

const between = (lo, hi) => lo + Math.random() * (hi - lo)

function paluBedSpot() {
  const b = layout.common.bed
  return { x: b.x + 3, y: b.y + 1 }
}

/** Where he lies when visiting a desk: on the floor in front of it, below the nameplate. */
function paluDeskSpot(seat) {
  if (loft()) return loftGeometry.paluDeskSpot(seat)
  return { x: seat.x + 1, y: seat.y + SEAT_H + LABEL_H }
}

/** His two lanes: the top one runs just behind the commons furniture, the bottom one in front. */
function paluLanes() {
  const c = layout.common
  return [c.laneTop, c.laneBottom + 6]
}

// ---- finding the way across the floor ---------------------------------------------------------
// Everyone walks the open floor: a grid search over where their feet may go, around the floor
// space each desk and piece of furniture stands on. They may pass behind things (depth order
// draws them behind), never through them.

const GRID = 2
// Search steps a frame for every route together (see walking.js): an ordinary floor finds a route
// in a few thousand, a hall of hundreds of desks can take a few hundred thousand. ROUTE_MS is what
// the search aims to stay within each frame, however dear a step gets on a big floor; it looks at
// the clock between slices of steps, so a frame can run a slice over.
const ROUTE_STEPS = 100000
const ROUTE_MS = 16
const planner = routePlanner(ROUTE_STEPS, { ms: ROUTE_MS })

/** Where the feet are at (x, y): Palú side-on or up and down (narrower), and a person. */
const FEET = {
  palu: { side: (x, y) => [x + 1, y + 6, 16, 3], upright: (x, y) => [x + 5, y + 6, 8, 3] },
  people: { side: (x, y) => [x + 1, y + 12, 6, 3], upright: (x, y) => [x + 1, y + 12, 6, 3] }
}

/** The floor each obstacle stands on: [x, y, w, h], in art pixels. */
function floorObstacles(who) {
  if (loft()) return loftGeometry.obstacles(layout)
  const c = layout.common
  // a person in the aisle stands tall, feet level with the heads of the next row down: for them
  // a desk starts a little lower
  const top = who === 'people' ? 5 : 0
  const boxes = layout.seats.map((s) => [s.x - 2, s.y + top, DESK_W + s.stools.length * STOOL_W + 2, SEAT_H + LABEL_H - top])
  for (const d of layout.rooms.flatMap(roomDecor)) {
    boxes.push(d.kind === 'plant' ? [d.x + 1, d.y + 5, 5, 4] : [d.x, d.y + 4, 12, 5])
  }
  // each area's name plaque and whiteboard: walk in front of them, not over them
  for (const room of layout.rooms) {
    const { x, y, w } = room
    const boardW = boardWOf(room)
    boxes.push([x + 3, y + 3, plaqueW(room), 7])
    if (boardW > 8) boxes.push([x + w - boardW - 4, y + 3, boardW, 7])
    // a bot at the head of its row, at its desk turned toward the row, or at its station
    if (room.head?.station) boxes.push([room.head.x - 2, room.head.y + top, DESK_W + 2, SEAT_H + LABEL_H - top])
    else if (room.head) boxes.push([room.head.x, room.head.y + 3, BRICK_HEAD - 2, SEAT_H + LABEL_H - 3])
  }
  // the coordinator's desk, and its room's edges: Brick has no walls, but its only way in or out
  // is the door in its top edge
  const chiefDesk = layout.coordinator
  if (chiefDesk) {
    boxes.push([chiefDesk.seat.x - 2, chiefDesk.seat.y + top, DESK_W + 2, SEAT_H + LABEL_H - top])
    const { room, door } = chiefDesk
    boxes.push(
      [room.x, room.y - 1, door.x - room.x, 2],
      [door.x + door.w, room.y - 1, room.x + room.w - door.x - door.w, 2],
      [room.x - 1, room.y, 2, room.h],
      [room.x + room.w - 1, room.y, 2, room.h],
      [room.x, room.y + room.h - 1, room.w, 2]
    )
  }
  if (!c) return boxes
  const { lounge: l, kitchen: k, foosball: f, cooler, coffee } = c
  const mid = l.x + Math.floor(l.w / 2)
  boxes.push(
    [l.x + 2, l.y + 3, l.w - 4, 11], // the sofa
    [mid - 8, l.y + 17, 16, 4], // the coffee table
    [k.x, k.y + 4, k.w, 8], // the counter and the fridge
    [cooler.x, cooler.y + 10, 7, 6],
    [coffee.x, coffee.y + 8, 9, 6],
    [f.x, f.y, 28, 14],
    [c.bowls.x, c.bowls.y + 1, 13, 3],
    ...c.booths.map((b) => [b.bx, b.by + 6, 13, 18])
  )
  return boxes
}

function floorClear(box, blocks) {
  const [x, y, w, h] = box
  const inside = x >= OUTER && y >= OUTER && x + w <= layout.artW - OUTER && y + h <= layout.building.h - OUTER
  return inside && !blocks.some((b) => overlaps(b, box))
}

/**
 * Places worth a sniff: beside each plant and bookshelf, and at the ends and corners of the commons
 * furniture. Each is where he stands, side-on, with his nose just touching the thing.
 */
function paluSniffSpots() {
  if (loft()) {
    const blocks = floorObstacles('palu')
    return loftGeometry.sniffSpots(layout).filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
  }
  const c = layout.common
  // nose to the left of him touching x (facing left), or to the right (facing right); paws on row y
  const fromRight = (x, base) => ({ x, y: base - 9, left: true })
  const fromLeft = (x, base) => ({ x: x - 18, y: base - 9, left: false })
  const spots = []
  for (const d of layout.rooms.flatMap(roomDecor)) {
    if (d.kind === 'plant') spots.push(fromRight(d.x + 7, d.y + 9))
    else spots.push(fromLeft(d.x, d.y + 9))
  }
  if (c) {
    const { lounge: l, kitchen: k, foosball: f, cooler, coffee } = c
    spots.push(
      fromLeft(l.x + 2, l.y + 14), // the sofa's arms
      fromRight(l.x + l.w - 2, l.y + 14),
      fromLeft(cooler.x, cooler.y + 16),
      fromRight(coffee.x + 9, coffee.y + 14),
      fromLeft(k.x, k.y + 12), // the end of the kitchen counter
      fromLeft(f.x, f.y + 14), // the foosball table's legs
      fromRight(f.x + 28, f.y + 14),
      ...c.booths.slice(-1).map((b) => fromLeft(b.bx, b.by + 24))
    )
  }
  const blocks = floorObstacles('palu')
  return spots.filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
}

const grids = new Map() // floor geometry -> where Palú's and people's feet may go, side-on and upright
let gridNow = { layout: null, tick: -1 } // this frame's grids, so asking again costs nothing

/** The grid for the floor as it is; a poll that moved nothing finds the one it already built. */
function floorGrid(who) {
  if (gridNow.layout !== layout || gridNow.tick !== tick) gridNow = { layout, tick }
  if (gridNow[who]) return gridNow[who]
  const blocks = floorObstacles(who)
  const key = `${who}|${layout.artW}|${layout.building.h}|${JSON.stringify(blocks)}`
  let grid = grids.get(key)
  if (!grid) {
    if (grids.size > 8) grids.clear()
    const feet = { side: FEET[who].side(0, 0), upright: FEET[who].upright(0, 0) }
    grid = walkGrid({ w: layout.artW, h: layout.building.h, wall: OUTER, size: GRID, feet, blocks })
    grids.set(key, grid)
  }
  gridNow[who] = grid
  return grid
}

/**
 * Waypoints from `from` to `to`, around everything in the way, for whoever `key` is: undefined
 * while the route is still being planned, null when there is no way there.
 */
function floorRoute(key, from, to, who) {
  const grid = floorGrid(who)
  const { W, H, side, upright } = grid
  const G = GRID
  const snap = (v, n) => Math.max(0, Math.min(n - 1, Math.round(v / G)))
  const found = planner.route(key, grid, snap(from.y, H) * W + snap(from.x, W), snap(to.y, H) * W + snap(to.x, W))
  if (!found) return undefined
  const { cells } = found
  if (!cells) return null
  // Pull the route straight: from each corner, head for the farthest cell further on that can be
  // reached in a straight line over open floor. People cut across the room and go round things,
  // instead of walking the grid's right angles.
  const open = (cell) => side[cell] && upright[cell]
  const inSight = (a, b) => {
    const ax = a % W
    const ay = Math.floor(a / W)
    const dx = (b % W) - ax
    const dy = Math.floor(b / W) - ay
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2
    for (let i = 1; i < steps; i++) {
      const cx = Math.round(ax + (dx * i) / steps)
      const cy = Math.round(ay + (dy * i) / steps)
      if (!open(cy * W + cx)) return false
    }
    return true
  }
  const kept = [cells[0]]
  for (let i = 0; i < cells.length - 1; ) {
    // looking at most 64 cells ahead keeps a long route along furniture cheap
    let j = Math.min(cells.length - 1, i + 64)
    while (j > i + 1 && !inSight(cells[i], cells[j])) j--
    kept.push(cells[j])
    i = j
  }
  const corners = kept.map((cell) => ({ x: (cell % W) * G, y: Math.floor(cell / W) * G }))
  corners.push({ x: to.x, y: to.y })
  return corners
}

/** To `to`; desk visits come along the aisle and shuffle the last pixels into the spot. */
function paluPath(to, viaAisle = false) {
  if (!viaAisle) return floorRoute('palu', palu, to, 'palu')
  const path = floorRoute('palu', palu, { x: to.x, y: to.y - PALU_AISLE }, 'palu')
  return path && [...path, { x: to.x, y: to.y }]
}

const paluWanderSpot = () => ({
  x: Math.round(between(OUTER + 4, layout.artW - OUTER - 22)),
  y: paluLanes()[Math.random() < 0.5 ? 0 : 1]
})

/** Where he stands to eat (nose in the kibble, from the left) or drink (from the right). */
function paluBowlSpots() {
  const b = layout.common.bowls
  const spots = [
    { x: b.x + 2 - 17, y: b.y + 3 - 9, left: false },
    { x: b.x + 10, y: b.y + 3 - 9, left: true }
  ]
  const blocks = floorObstacles('palu').filter((o) => !(o[0] === b.x && o[1] === b.y + 1))
  const clear = spots.filter((s) => floorClear(FEET.palu.side(s.x, s.y), blocks))
  return clear.length ? clear : spots.slice(0, 1)
}

function paluNext() {
  const atDesk = layout.seats.filter((s) => !walkers.has(s.key) && (!loft() || loftGeometry.visitable(s)))
  const sniffs = paluSniffSpots()
  const options = [{ act: 'wander', w: 2 }, { act: 'bed', w: 1 }, { act: 'eat', w: 1 }]
  if (sniffs.length) options.push({ act: 'sniff', w: 3 })
  if (atDesk.length) options.push({ act: 'visit', w: 2 })
  let r = Math.random() * options.reduce((n, o) => n + o.w, 0)
  const act = options.find((o) => (r -= o.w) < 0)?.act ?? 'wander'
  // what he does next takes over once the way there is planned; until then he stays as he is
  const plan = { act, seatKey: null, restLeft: Math.random() < 0.5, viaAisle: false, tries: 0 }
  if (act === 'bed') {
    plan.to = paluBedSpot()
    plan.restFor = between(40000, 90000)
  } else if (act === 'sniff') {
    const spot = sniffs[Math.floor(Math.random() * sniffs.length)]
    plan.to = spot
    plan.restLeft = spot.left
    plan.restFor = between(2500, 6000)
  } else if (act === 'eat') {
    const bowls = paluBowlSpots()
    const spot = bowls[Math.floor(Math.random() * bowls.length)]
    plan.to = spot
    plan.restLeft = spot.left
    plan.restFor = between(3000, 7000)
  } else if (act === 'visit') {
    // more often beside someone dozing
    const weights = atDesk.map((s) => (LOUNGE_STATES.has(s.staff.state) ? 3 : 1))
    let q = Math.random() * weights.reduce((n, w) => n + w, 0)
    const seat = atDesk.find((_, i) => (q -= weights[i]) < 0) ?? atDesk[0]
    plan.seatKey = seat.key
    plan.to = paluDeskSpot(seat)
    plan.viaAisle = true
    plan.restFor = between(60000, 120000)
  } else {
    plan.to = paluWanderSpot()
    plan.restFor = between(3000, 8000)
  }
  palu.plan = plan
  paluSetOff()
}

/** Off on his next walk once its route is planned; a wander tries six places before giving up. */
function paluSetOff() {
  const plan = palu.plan
  let path
  for (;;) {
    path = paluPath(plan.to, plan.viaAisle)
    if (path === undefined) return
    if (path || plan.act !== 'wander' || ++plan.tries >= 6) break
    plan.to = paluWanderSpot()
  }
  palu.plan = null
  // nowhere he can get to: a short sit where he is, then he thinks again
  if (path) Object.assign(palu, { act: plan.act, seatKey: plan.seatKey, restLeft: plan.restLeft, restFor: plan.restFor })
  else Object.assign(palu, { act: 'wander', seatKey: null, restLeft: plan.restLeft, restFor: between(3000, 8000) })
  palu.path = path ?? []
  palu.until = null
}

function stepPalu() {
  if (!layout.common) return
  const now = Date.now()
  if (!palu) {
    // the panel opens with him asleep in his bed
    const spot = paluBedSpot()
    palu = { ...spot, path: [], act: 'bed', until: now + between(20000, 60000), restLeft: false, plan: null }
  }
  const next = palu.path[0]
  if (next) {
    const dx = next.x - palu.x
    const dy = next.y - palu.y
    // side-on when he goes more across than up or down; the little step between the aisle and
    // his spot is a shuffle, not a turn
    if (Math.abs(dx) >= 0.5 && Math.abs(dx) >= Math.abs(dy)) {
      palu.left = dx < 0
      palu.dir = 'side'
    } else if (Math.abs(dy) > PALU_AISLE) palu.dir = dy > 0 ? 'down' : 'up'
    if (stepToward(palu, next, PALU_SPEED)) palu.path.shift()
    return
  }
  if (palu.plan) return paluSetOff()
  if (palu.until === null) palu.until = now + palu.restFor
  // stay put on his spot even if the floor shifted under him
  const seat = palu.seatKey ? layout.seats.find((s) => s.key === palu.seatKey) : null
  if (palu.act === 'bed') Object.assign(palu, paluBedSpot())
  else if (seat) Object.assign(palu, paluDeskSpot(seat))
  // time to move on, or the person he was napping beside got up
  const leftDesk = palu.act === 'visit' && (!seat || walkers.has(seat.key))
  if (now >= palu.until || leftDesk) paluNext()
}

/** The box Palú covers and the row his paws are on, for drawing him behind furniture. */
function paluBox() {
  if (!palu) return null
  const x = Math.round(palu.x)
  const y = Math.round(palu.y)
  if (palu.path.length && palu.dir !== 'side') return { box: [x + 5, y - 2, 8, 11], base: y + 9 }
  if (palu.path.length) return { box: [x, y - 1, 18, 10], base: y + 9 }
  if (palu.act === 'sniff' || palu.act === 'eat') return { box: [x, y - 1, 18, 10], base: y + 9 }
  if (palu.act === 'wander') return { box: [x + 5, y - 3, 8, 10], base: y + 7 }
  return { box: [x, y, 18, 6], base: y + 6 }
}

function drawPalu(base = painter(ctx)) {
  if (!palu) return
  const off = (ox, oy) => (x, y, w, h, c) => base(Math.round(palu.x) + ox + x, Math.round(palu.y) + oy + y, w, h, c)
  const at = off(0, 0)
  const upright = off(4, -1)
  if (palu.path.length && palu.dir === 'down') paluWalkFront(upright, tick)
  else if (palu.path.length && palu.dir === 'up') paluWalkBack(upright, tick)
  else if (palu.path.length) paluWalk(at, tick, palu.left)
  else if (palu.act === 'sniff' || palu.act === 'eat') paluSniff(at, tick, palu.restLeft)
  else if (palu.act === 'wander') paluSit(off(4, -2), tick)
  else paluLie(at, tick, true, palu.restLeft)
}

// ---- the coordinator's round -------------------------------------------------------------------
// While it works or keeps an eye on its desks, the coordinator walks a round: out through the way
// into its room, to the head of every other bot's island and to each desk that needs you, a
// moment at each with a word about what it is checking, then back to its desk. When it waits for
// you it goes and waits at its way in, where you find it; otherwise it sits at its desk.

const CHIEF_DWELL = 40 // frames at each stop on the round, long enough to read what it says
const CHIEF_REST = 64 // frames at its desk between rounds
const CHIEF_STOPS = 6 // stops on one round at most
const CHIEF_SPEED = 3 // art pixels a frame: a bot scoots, twice a walk
let chief = null

/** The stops of one round, from the layout on screen: desks that need you first, then the other bots. */
function chiefRound(plan) {
  const needYou = layout.seats
    .filter((s) => (s.staff.state === 'waiting' || s.staff.state === 'blocked') && !walkers.has(s.key))
    .map((s) => ({ at: homeOf(s), say: `How is ${nameplate(s)} doing?` }))
  return [...needYou, ...plan.stops].slice(0, CHIEF_STOPS)
}

function stepChief() {
  const plan = layout.coordinator
  if (!plan) {
    chief = null
    return
  }
  chief = coordinatorWalk(chief, plan, {
    round: () => chiefRound(plan),
    route: (from, to) => walkPath('chief', from, to),
    speed: CHIEF_SPEED,
    rest: CHIEF_REST,
    dwell: CHIEF_DWELL
  })
}

/** Whether the coordinator sits at its desk: at home with nowhere to go. */
const chiefSeated = () => coordinatorSeated(chief, layout.coordinator)

/** Whether the seat's agent just finished and sits up at its desk, ready for the next task. */
function awaitingTask(seat) {
  return seat.staff.state === 'done' && staysAtDesk(doneAt.get(seat.key), Date.now(), deskStay)
}

/** The ? over a Brick bot that waits for you, the ! over a stuck one, the z over one asleep. */
function brickMarks(p, state) {
  if (state === 'waiting' && (tick >> 2) % 2) glyph(p, '?', 4, -6, C.amber)
  if (state === 'blocked') glyph(p, '!', 4, -6, C.red)
  if (state === 'asleep') {
    const z = tick % 16
    if (z < 12) glyph(p, 'z', 10 + (z >> 2), -2 - (z >> 2), C.white)
  }
}

/**
 * A bot at the head of its row in Brick: in its chair at the left end, behind a desk of its own
 * turned toward the row, its terminal facing it; one with no desks on the floor, at its station.
 */
function drawBrickHead(head) {
  const { bot } = head
  if (head.station) return drawBrickStation(head, bot, true)
  const p = painter(ctx, head.x, head.y)
  const bob = bot.state === 'working' ? tick % 2 : 0
  p(0, 4, 10, 12, C.chair)
  p(0, 4, 2, 12, C.chairDark)
  const at = painter(ctx, head.x, head.y + 5 - bob)
  brickBot(at, colorsOf(bot), bot.state, tick)
  brickMarks(at, bot.state)
  // the desk, long side down beside the row
  p(12, 2, 8, 17, C.woodDark)
  p(12, 2, 7, 16, C.woodTop)
  p(13, 3, 5, 14, C.wood)
  // the terminal, its screen toward the bot
  p(14, 6, 3, 9, C.frame)
  p(14, 7, 1, 7, bot.state === 'blocked' ? C.red : bot.state === 'waiting' ? C.amber : bot.state === 'asleep' ? C.chairDark : C.screen)
}

/** The coordinator's desk in Brick: its chair, itself when it sits there, the monitor and the desk. */
function drawBrickChiefDesk(k) {
  drawBrickStation(k.seat, k.bot, chiefSeated())
}

/** A bot's own desk in Brick, at `seat`: its chair, itself when it sits there, the monitor and the desk. */
function drawBrickStation(seat, bot, seated) {
  const p = painter(ctx, seat.x, seat.y)
  const state = bot.state
  p(4, 4, 12, 9, C.chair)
  p(4, 4, 12, 1, C.chairDark)
  if (seated) {
    const at = painter(ctx, seat.x + 5, seat.y - 1 + (state === 'working' ? tick % 2 : 0))
    brickBot(at, colorsOf(bot), state, tick)
    brickMarks(at, state)
  }
  desk(painter(ctx, seat.x - 2, seat.y), DESK_W)
  p(5, 9, 10, 7, C.frame)
  p(6, 10, 8, 5, C.screen)
  if (state === 'working') {
    for (let line = 0; line < 3; line++) p(7, 10 + Math.floor(line * 1.5), Math.min(2 + ((tick + line * 5) % 6), 6), 1, [C.green, C.blue, C.amber][(line + (tick >> 2)) % 3])
  } else if (state === 'watching' || state === 'monitoring') {
    p(7, 12, 6, 1, C.chairDark)
    p(7, 12, tick % 7, 1, C.green)
  } else if (state === 'waiting') {
    p(6, 10, 8, 5, '#3a2a10')
    if ((tick >> 2) % 2) glyph(p, '?', 9, 10, C.amber)
  } else if (state === 'blocked') {
    p(6, 10, 8, 5, (tick >> 1) % 2 ? C.red : '#8a2232')
    glyph(p, '!', 9, 10, C.white)
  }
  p(6, 16, 8, 1, '#c8c6d4')
}

function drawSeat(seat) {
  const p = painter(ctx, seat.x, seat.y)
  person(p, seat.staff, tick, walkers.has(seat.key), awaitingTask(seat))
}

function drawText(text, cssX, cssY, maxW, color, { weight = 600, align = 'left', size = 12, chip = null } = {}) {
  cssTransform()
  ctx.font = `${weight} ${size}px ui-monospace, 'SF Mono', Menlo, monospace`
  ctx.textBaseline = 'middle'
  ctx.textAlign = align
  ctx.fillStyle = color
  let label = text
  if (ctx.measureText(label).width > maxW) {
    while (label.length > 1 && ctx.measureText(label + '...').width > maxW) label = label.slice(0, -1)
    label += '...'
  }
  if (chip) {
    // a little plate behind the text, as wide as the text
    const w = Math.ceil(ctx.measureText(label).width) + 6
    const left = align === 'center' ? cssX - w / 2 : cssX - 3
    ctx.fillStyle = chip
    ctx.fillRect(Math.round(left), Math.round(cssY - size / 2 - 2), w, size + 3)
    ctx.fillStyle = color
  }
  ctx.fillText(label, cssX, cssY)
  ctx.textAlign = 'left'
  artTransform()
}

/** Where a bubble points for this key: the person, wherever they are, or the desk. */
function bubbleAnchor(key) {
  const bot = botOf(key)
  if (bot) {
    const box = botBox(bot)
    return box && { x: box[0] + box[2] / 2, y: box[1] }
  }
  const v = visitors.get(key)
  if (v) return { x: v.x + 4, y: v.mode === 'seated' ? v.y + 2 : v.y - 1 }
  const seat = layout.seats.find((u) => u.key === key)
  if (!seat) return null
  const w = walkers.get(seat.key)
  if (w) return { x: w.x + 4, y: w.y - 1 }
  return loft() ? loftGeometry.seatAnchor(seat) : { x: seat.x + SEAT_W / 2, y: seat.y }
}

function drawBubble(anchor, text, kind = 'speech') {
  const s = layout.scale
  cssTransform()
  ctx.font = `500 12px ui-monospace, 'SF Mono', Menlo, monospace`
  const maxW = Math.min(220, layout.artW * s - 12)
  let label = text
  while (label.length > 1 && ctx.measureText(label).width > maxW - 14) label = label.slice(0, -2) + '.'
  const w = Math.ceil(ctx.measureText(label).width) + 14
  const h = 20
  const cx = anchor.x * s
  let x = Math.round(cx - w / 2)
  x = Math.max(6, Math.min(x, layout.artW * s - w - 6))
  const y = Math.max(4, Math.round(anchor.y * s - h - 2))

  if (kind === 'waiting') {
    ctx.fillStyle = '#fff9e6'
    ctx.strokeStyle = C.amber
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 8)
    ctx.fill()
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, y + h + 3, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx - 2, y + h + 7, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.fillStyle = '#e9fbef'
    ctx.strokeStyle = '#3a8f5c'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 7)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 4, y + h)
    ctx.lineTo(cx, y + h + 6)
    ctx.lineTo(cx + 4, y + h)
    ctx.fill()
  }

  ctx.fillStyle = C.ink
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 7, y + h / 2 + 1)
  artTransform()
}

/** Everyone up and about, in the loft: each with where to draw them and the row of their feet. */
function loftPeople() {
  const people = []
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    if (!w) continue
    const x = Math.round(w.x)
    const y = Math.round(w.y)
    const kind = w.mode === 'away' ? w.activity?.kind ?? null : null
    const m = {
      key: seat.key,
      kind,
      spot: w.spot,
      base: y + 15,
      // Keep a worker visible while crossing room furniture and curtain lines. Once it reaches
      // the commons, normal depth sorting resumes so furniture can occlude it naturally.
      moving: w.path.length > 0 || w.mode.startsWith('teleport')
    }
    if (kind === 'lounge') {
      m.base = (w.spot.sofa ? w.spot.sofa.y + 13 : y + 13) + 0.5
      m.paint = (p) => lounging(p, x, y, seat.staff, tick, w.activity.pose)
    } else if (kind === 'booth') m.paint = (p) => standing(p, x, y, seat.staff, tick, false, w.left, null, 'phone')
    else if (kind === 'foosball') m.paint = (p) => standing(p, x, y, seat.staff, tick, false, w.left, null, w.spot.back ? 'playBack' : 'play')
    else if (kind === 'table') {
      // the one who has the word changes every few seconds, round the table; the chair comes
      // from the layout on screen, which may be newer than the spot the walker set out for
      const chair = layout.common.table?.[assigned.get(seat.key)?.index]?.chair ?? w.spot.chair
      const seated = layout.seats.filter((s) => walkers.get(s.key)?.mode === 'away' && walkers.get(s.key)?.activity?.kind === 'table')
      const talking = seated.length > 0 && seated[Math.floor(tick / 24) % seated.length] === seat
      m.chair = chair
      m.base = chair.y + 11 + (chair.facing ? 0.5 : -0.5)
      m.paint = (p) => sitting(p, chair, seat.staff, tick, talking)
    }
    else m.paint = (p) => {
      // Let the portal own the last departure frames and first arrival frames. The hard cut makes
      // the disappearance/reappearance readable without introducing opacity or a screen-wide flash.
      if (walkerShown(w)) standing(p, x, y, seat.staff, tick, onTheMove(w), w.left)
      if (w.mode.startsWith('teleport')) teleportEffect(p, x, y, w.warp, w.mode)
    }
    people.push(m)
  }
  for (const [key, v] of visitors) {
    if (v.mode === 'seated' || v.wait > 0) continue
    const x = Math.round(v.x)
    const y = Math.round(v.y)
    people.push({
      key,
      kind: null,
      base: y + 15,
      moving: onTheMove(v),
      paint: (p) => standing(p, x, y, v.spec, tick, onTheMove(v), v.left, roleColor(v.spec.role))
    })
  }
  // the coordinator, out on its round or waiting at its way in
  if (chief && layout.coordinator && !chiefSeated()) {
    const { bot } = layout.coordinator
    const x = Math.round(chief.x)
    const y = Math.round(chief.y)
    const moving = chief.path.length > 0
    people.push({ key: botKey(bot), kind: null, base: y + 15, moving, paint: (p) => standingBot(p, x, y, colorsOf(bot), bot.state, tick, moving) })
  }
  return people
}

function drawLoftScene() {
  artTransform()
  // Only the part of the office the panel shows: a big team's loft is many times taller than the
  // panel, and painting all of it eight times a second froze the panel.
  const top = office.scrollTop / layout.scale
  const view = { y0: top, y1: top + office.clientHeight / layout.scale }
  const dog = paluBox()
  const people = loftPeople()
  drawLoft(ctx, layout, {
    tick,
    away: (seat) => walkers.has(seat.key),
    awake: awaitingTask,
    seatedAt: (seat) =>
      [...visitors]
        .filter(([key, v]) => v.mode === 'seated' && key.startsWith(`${seat.key}|`))
        .map(([, v]) => ({ spec: v.spec, index: seat.stools.findIndex((st) => st.x === v.stoolAt.x && st.y === v.stoolAt.y) }))
        .filter((s) => s.index >= 0),
    people,
    sittersAt: new Set(people.filter((m) => m.kind === 'table').map((m) => m.chair)),
    palu: dog && { base: dog.base, paint: (p) => outlinedAt(p, 0, 0, (q) => drawPalu(q)) },
    bowls: (p, b) => outlinedAt(p, b.x, b.y, (q) => dogBowls(q, tick)),
    nameplate,
    drawText: (...args) => {
      drawText(...args)
      artTransform()
    },
    bots: { colors: botPalette, chiefSeated: chiefSeated() },
    view
  })
}

function draw() {
  // The animation timer can run before the first worker snapshot and before ResizeObserver has
  // established a layout. Keep that startup frame blank instead of throwing every 125 ms and
  // leaving the renderer with a black canvas.
  if (!snapshot || !layout.building) return
  if (loft()) {
    drawLoftScene()
    drawChiefName()
    drawSelection()
    return
  }
  artTransform()
  const p = painter(ctx)
  drawBuilding(p)
  for (const room of layout.rooms) drawRoom(p, room)
  const behind = drawCommon()

  // desks: people first, then the desk over their laps, then monitors and hands
  for (const seat of layout.seats) drawSeat(seat)
  for (const seat of layout.seats) desk(painter(ctx, seat.x - 2, seat.y), DESK_W)
  for (const seat of layout.seats) workstation(painter(ctx, seat.x, seat.y), seat.staff, tick, walkers.has(seat.key), Boolean(seat.desk.environment), awaitingTask(seat))
  // stools at the end of each desk, then whoever is sitting on them
  for (const seat of layout.seats) for (const at of seat.stools) stool(painter(ctx, at.x, at.y))
  for (const v of visitors.values()) {
    if (v.mode === 'seated') specialist(painter(ctx, Math.round(v.x) + 1, Math.round(v.y) + 2), v.spec, tick)
  }
  // more specialists than stools: a + beside the last sitter's head, in the gap before the next desk
  for (const seat of layout.seats) {
    if (!seat.overflow) continue
    const last = seat.stools[seat.stools.length - 1]
    glyph(p, '+', last.x + 7, last.y - 10, C.white)
  }
  // the bots: each at the head of its row, the coordinator at its desk
  for (const room of layout.rooms) if (room.head) drawBrickHead(room.head)
  if (layout.coordinator) drawBrickChiefDesk(layout.coordinator)

  // people up and about, Palú and specialists on their way, nearest the bottom drawn last, so
  // whoever stands in front covers whoever is behind. Callers in a booth go first, under its glass.
  const scene = []
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    if (!w || behind.has(seat.key)) continue
    const at = painter(ctx, Math.round(w.x), Math.round(w.y))
    const kind = w.mode === 'away' ? w.activity?.kind : null
    let paint
    if (kind === 'lounge') paint = () => lounger(at, seat.staff, tick, w.activity.pose)
    else if (kind === 'booth') paint = () => walker(at, seat.staff, tick, false, w.left, null, 'phone')
    else if (kind === 'foosball') paint = () => walker(at, seat.staff, tick, false, w.left, null, w.spot.back ? 'playBack' : 'play')
    else {
      paint = () => {
        walker(at, seat.staff, tick, onTheMove(w), w.left)
        if (w.mode.startsWith('teleport')) teleportEffect(at, 0, 0, w.warp, w.mode)
      }
    }
    scene.push({ base: Math.round(w.y) + 15, inBooth: kind === 'booth', paint })
  }
  for (const [key, v] of visitors) {
    if (v.mode === 'seated' || v.wait > 0 || behind.has(key)) continue
    const at = painter(ctx, Math.round(v.x), Math.round(v.y))
    scene.push({ base: Math.round(v.y) + 15, paint: () => walker(at, v.spec, tick, onTheMove(v), v.left, roleColor(v.spec.role)) })
  }
  if (chief && layout.coordinator && !chiefSeated()) {
    const x = Math.round(chief.x)
    const y = Math.round(chief.y)
    const { bot } = layout.coordinator
    const bob = chief.path.length ? tick % 2 : 0
    scene.push({
      base: y + 15,
      paint: () => {
        brickBot(painter(ctx, x - 1, y + 6 - bob), colorsOf(bot), bot.state, tick)
        brickMarks(painter(ctx, x - 1, y + 6 - bob), bot.state)
      }
    })
  }
  const dog = behind.has('palu') ? null : paluBox()
  // on a tie Palú goes first: he is low to the ground, so the person's legs cover him
  if (dog) scene.push({ base: dog.base - 0.5, paint: drawPalu })
  scene.sort((a, b) => a.base - b.base)
  for (const it of scene) if (it.inBooth) it.paint()
  if (layout.common) for (const b of layout.common.booths) boothGlass(painter(ctx, b.bx, b.by))
  for (const it of scene) if (!it.inBooth) it.paint()

  const s = layout.scale
  for (const room of layout.rooms) {
    drawText(room.name, (room.x + 5) * s, (room.y + 6.5) * s, (plaqueW(room) - 4) * s, C.white, { weight: 700 })
  }
  for (const seat of layout.seats) {
    const color = seat === seatOf(selected) ? '#2a1f6b' : '#2a2633'
    // as wide as the desk itself (DESK_W), less a margin, so neighbouring nameplates never touch
    drawText(nameplate(seat), (seat.x + SEAT_W / 2) * s, (seat.y + SEAT_H + 2.5) * s, DESK_W * s - 2, color, { align: 'center' })
    // in a bot's room, the project each desk works in, small, under its nameplate
    if (seat.room.bot) drawText(projectOf(seat.desk), (seat.x + SEAT_W / 2) * s, (seat.y + SEAT_H + 7.5) * s, DESK_W * s - 2, '#23212b', { align: 'center', size: 9, chip: '#f1efe8' })
  }

  drawChiefName()
  drawSelection()
}

/** The coordinator's name under it while it is out on the floor, so you can tell who it is. */
function drawChiefName() {
  if (!chief || !layout.coordinator || chiefSeated()) return
  const s = layout.scale
  const size = Math.max(9, Math.min(11, Math.round(s * 3)))
  drawText(layout.coordinator.bot.name, (chief.x + 4) * s, (chief.y + 19) * s, 90, '#e4e8f2', { align: 'center', size, chip: '#2f3a52' })
}

/** Where a bot is on screen, for clicks, its bubble and the selection frame: [x, y, w, h]. */
function botBox(bot) {
  const k = layout.coordinator
  if (k && k.bot.id === bot.id) {
    if (chief && !chiefSeated()) return loft() ? [chief.x - 3, chief.y + 1, 14, 15] : [chief.x - 2, chief.y + 4, 12, 12]
    return loft() ? [k.room.seat.x - 1, k.room.seat.y - 1, 14, 14] : [k.seat.x + 4, k.seat.y - 2, 12, 12]
  }
  const room = layout.rooms.find((r) => r.head?.bot.id === bot.id)
  if (!room) return null
  const { x, y, station } = room.head
  if (station && !loft()) return [x + 4, y - 2, 12, 12]
  if (loft()) return station ? [x + 1, y - 13, 14, 18] : [x, room.head.by - 15, 14, 18]
  return [x, y + 3, 12, 16]
}

/** The frame around the selected seat, and the speech bubbles. */
function drawSelection() {
  const pickSeat = selected && seatOf(selected)
  const pickBot = selected && botOf(selected)
  const frame = pickSeat ? seatBoxOf(pickSeat) : pickBot ? botBox(pickBot) : null
  if (frame) {
    artTransform()
    const [x, y, w, h] = frame
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.5
    ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5)
  }

  const now = Date.now()
  for (const seat of layout.seats) {
    const b = bubbles.get(seat.key)
    if (seat.key !== selected && b && b.until > now) drawBubble(bubbleAnchor(seat.key), b.text, b.kind)
  }
  for (const bot of shownBots) {
    const key = botKey(bot)
    const anchor = key !== selected && bubbleAnchor(key)
    if (!anchor) continue
    const b = bubbles.get(key)
    // out on its round it says what it is checking; else a bubble when it finished or needs you
    const k = layout.coordinator
    if (k && k.bot.id === bot.id && chief?.say) drawBubble(anchor, chief.say)
    else if (b && b.until > now) drawBubble(anchor, b.text, b.kind)
  }
  const anchor = selected && bubbleAnchor(selected)
  const waiting = pickBot ? pickBot.state === 'waiting' : !visitors.has(selected) && seatOf(selected)?.staff?.state === 'waiting'
  if (anchor) drawBubble(anchor, sayingOf(selected), waiting ? 'waiting' : 'speech')
}

// ---- side text ---------------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function renderStats() {
  let busy = 0
  let specialists = 0
  let needYou = 0
  for (const u of layout.seats) {
    if (u.staff.state === 'working' || u.staff.state === 'monitoring') busy++
    if (u.staff.state === 'waiting' || u.staff.state === 'blocked') needYou++
    specialists += activeSpecialists(u.staff).length
  }
  // a bot that waits for you, or is stuck, needs you like anyone
  for (const bot of shownBots) if (bot.state === 'waiting' || bot.state === 'blocked') needYou++
  const parts = [plural(layout.teamCount ?? layout.rooms.length, 'team')]
  if (shownBots.length) parts.push(plural(shownBots.length, 'bot'))
  parts.push(`${layout.seats.length} staff`, `${busy} busy`)
  if (specialists) parts.push(plural(specialists, 'specialist'))
  if (needYou) parts.push(`${needYou} need you`)
  const text = parts.join(' · ')
  const stats = document.getElementById('stats')
  if (stats.textContent !== text) stats.textContent = text
}

// How the last "Open in Orca" went for the selected seat: 'opening', or the reason it failed.
// Kept across polls (renderDetail runs on each) and dropped when the selection changes.
let opening = null

/** Asks the worker to bring the agent's tab to the front; the panel itself never moves Orca's focus. */
async function openInOrca(seat) {
  opening = { key: seat.key, text: null, busy: true }
  renderDetail()
  let outcome
  try {
    outcome = await orca.plugin.request('office.switch', { paneKey: seat.staff.id, environment: seat.desk.environment ?? null }, { timeoutMs: 20000 })
  } catch (error) {
    outcome = { ok: false, error: error?.message ?? String(error) }
  }
  if (opening?.key !== seat.key) return
  opening = outcome.ok ? null : { key: seat.key, text: `Could not open it in Orca: ${outcome.error}`, busy: false }
  renderDetail()
}

function stateLabel(state) {
  return STATE_LABEL[state] ?? state ?? 'unknown'
}

/** An agent's state and how long it has been in it, when the worker knows. */
function stateFor(staff) {
  const label = stateLabel(staff.state)
  const how = since(staff.since)
  return how ? `${label} for ${how}` : label
}

/** What a seat's agent is up to, line by line: shared by the detail panel and the hover card. */
function seatFacts(seat) {
  const { desk: d, staff } = seat
  const facts = [`${staff.agent ?? 'agent'} · ${stateFor(staff)}`]
  if (staff.task && staff.task !== d.name) facts.push(staff.task)
  if (staff.tool && staff.state === 'working') facts.push(`using ${staff.tool}`)
  for (const sp of activeSpecialists(staff)) {
    facts.push(`${sp.role ?? 'specialist'}: ${sp.task ?? ''} (${stateLabel(sp.state)})`)
  }
  return facts
}

/** "Bot", or "Coordinator" for the one picked in the header. */
const botRole = (bot) => (bot.id === coordinatorId() ? 'Coordinator' : 'Bot')

/** A bot's state and how long it has been in it. */
function botStateFor(bot) {
  const label = stateLabel(bot.state)
  const how = bot.state === 'asleep' || bot.state === 'watching' ? '' : since(bot.since)
  return how ? `${label} for ${how}` : label
}

/** Who made a desk, when a bot runs it or an automation made it. */
function deskOrigin(d) {
  const out = []
  if (d.bot) out.push(`Run by ${(snapshot?.bots ?? []).find((b) => b.id === d.bot)?.name ?? 'a bot'}`)
  if (d.automation) out.push(d.automation.name ? `Made by the ${d.automation.name} automation` : 'Made by an automation')
  return out
}

const BOT_DESK_ROWS = 8

/**
 * A bot in the detail box: who it is, what it does and the desks it runs. Orca cannot bring a
 * bot's home folder to the front from the CLI yet, so a bot has no Open in Orca button.
 */
function botDetail(bot) {
  const lines = [el('div', '', bot.name), el('div', 'row', botRole(bot))]
  if (bot.host) lines.push(el('div', 'row', `on ${bot.host}`))
  lines.push(el('div', 'row', botStateFor(bot)))
  if (bot.task) lines.push(el('div', 'row', bot.task))
  if (!bot.homeId) lines.push(el('div', 'row', "Its home isn't showing in Orca right now"))
  if (bot.desks.length) {
    lines.push(el('div', '', `Running ${plural(bot.desks.length, 'desk')}`))
    for (const d of bot.desks.slice(0, BOT_DESK_ROWS)) {
      const state = d.staff[0] ? stateLabel(d.staff[0].state) : 'asleep'
      lines.push(el('div', 'row', `${d.staff[0]?.label || d.label} · ${projectOf(d)} · ${state}`))
    }
    if (bot.desks.length > BOT_DESK_ROWS) lines.push(el('div', 'row', `and ${bot.desks.length - BOT_DESK_ROWS} more`))
  }
  return lines
}

function renderDetail() {
  const box = document.getElementById('detail')
  const bot = selected && botOf(selected)
  if (bot) {
    box.replaceChildren(...botDetail(bot))
    box.hidden = false
    return
  }
  const seat = selected && seatOf(selected)
  if (!seat) {
    box.hidden = true
    return
  }
  const { desk: d, staff } = seat
  const lines = [el('div', '', d.name)]
  if (d.host) lines.push(el('div', 'row', `on ${d.host}`))
  for (const fact of seatFacts(seat)) lines.push(el('div', 'row', fact))
  for (const fact of deskOrigin(d)) lines.push(el('div', 'row', fact))
  if (staff.id) {
    const state = opening?.key === seat.key ? opening : null
    const button = el('button', 'open', state?.busy ? 'Opening...' : 'Open in Orca')
    button.type = 'button'
    button.disabled = Boolean(state?.busy)
    button.addEventListener('click', () => openInOrca(seat))
    const actions = el('div', 'actions')
    actions.append(button)
    if (state?.text) actions.append(el('span', 'note', state.text))
    lines.push(actions)
  }
  box.replaceChildren(...lines)
  box.hidden = false
}

function showMessage(text) {
  const msg = document.getElementById('message')
  msg.textContent = text ?? ''
  msg.hidden = !text
}

/** Pops a bubble on a seat whose agent just finished or needs you. */
function noteChanges() {
  const now = Date.now()
  for (const seat of layout.seats) {
    const prev = lastState.get(seat.key)
    const state = seat.staff.state
    if (primed && prev && prev !== state) {
      let text = null
      if (state === 'done') text = seat.staff.said ?? 'Done!'
      else if (state === 'waiting') text = 'Need you!'
      else if (state === 'blocked') text = 'Stuck!'
      if (text) bubbles.set(seat.key, { text, until: now + BUBBLE_MS, kind: state === 'waiting' ? 'waiting' : 'speech' })
      // Finished at its desk: it stays there a while. One that finished out on a break (it was
      // waiting on a background job) is not called back to its desk only to leave again.
      if (state === 'done' && !walkers.has(seat.key)) doneAt.set(seat.key, now)
    }
    if (state !== 'done') doneAt.delete(seat.key)
    lastState.set(seat.key, state)
  }
  const seated = new Set(layout.seats.map((s) => s.key))
  for (const key of doneAt.keys()) if (!seated.has(key)) doneAt.delete(key)
  // a bot speaks up the same way when it finishes or needs you
  for (const bot of shownBots) {
    const key = botKey(bot)
    const prev = lastState.get(key)
    if (primed && prev && prev !== bot.state) {
      const text = bot.state === 'done' ? bot.said ?? 'Done!' : bot.state === 'waiting' ? 'Need you!' : bot.state === 'blocked' ? 'Stuck!' : null
      if (text) bubbles.set(key, { text, until: now + BUBBLE_MS, kind: bot.state === 'waiting' ? 'waiting' : 'speech' })
    }
    lastState.set(key, bot.state)
  }
  // a bot that left the floor takes its last state and bubble with it
  const onFloor = new Set(shownBots.map(botKey))
  for (const map of [lastState, bubbles]) for (const key of map.keys()) if (key.startsWith(BOT_KEY) && !onFloor.has(key)) map.delete(key)
  primed = true
}

function apply(next) {
  received = next
  snapshot = shown(next)
  shownBots = botsOnFloor(snapshot)
  botPalette = botColors(shownBots)
  renderCoordinator()
  // Establish the new layout before updating the sidebar text. The final resize below measures
  // the office after those DOM changes, so a snapshot cannot cause one paint at the old height and
  // another after #stats or #message changes the flex layout.
  layout = fitLayout()
  renderStats()
  renderDetail()
  if (layout.seats.length === 0 && shownBots.length === 0) {
    showMessage(next.error ? `Could not read the agents: ${next.error}` : 'The office is empty. Start an agent and it gets a desk.')
  } else showMessage(null)
  resize(false)
  noteChanges()
  draw()
  refreshCard()
}

// ---- input and loops -------------------------------------------------------------------------

function artPoint(event) {
  const rect = floor.getBoundingClientRect()
  return [(event.clientX - rect.left) / layout.scale, (event.clientY - rect.top) / layout.scale]
}

/** Palú when the point is on him (with a pixel to spare, he is small). */
function onPalu(ax, ay) {
  const dog = paluBox()
  return Boolean(dog) && overlaps(dog.box, [ax - 1, ay - 1, 2, 2])
}

/** The seat a key belongs to: its own, or the desk a specialist is visiting. */
function seatOf(key) {
  const seatKey = visitors.has(key) ? key.slice(0, key.lastIndexOf('|')) : key
  return layout.seats.find((u) => u.key === seatKey) ?? null
}

/** What someone says when clicked: an agent's line, or the job a specialist was called in for. */
function sayingOf(key) {
  const bot = botOf(key)
  if (bot) return bot.line
  const v = visitors.get(key)
  if (v) return v.spec.task ?? `${v.spec.role ?? 'specialist'}, on it`
  const staff = seatOf(key)?.staff
  return staff ? staff.line ?? staff.said ?? STATE_LABEL[staff.state] : ''
}

/** The box that is a seat on screen, for clicks and the selection frame. */
function seatBoxOf(seat) {
  return loft() ? loftGeometry.seatBox(seat) : [seat.x, seat.y, SEAT_W, SEAT_H + LABEL_H]
}

/** Who is under the point: a person first, wherever they are, then a desk. */
function whoAt(ax, ay) {
  const inBox = ([x, y, w, h]) => ax >= x && ax < x + w && ay >= y && ay < y + h
  const people = []
  for (const [key, v] of visitors) {
    if (v.wait > 0) continue
    const box = v.mode === 'seated' ? [v.x, v.y + 1, 9, 13] : [v.x - 1, v.y - 2, 10, 18]
    people.push({ key, box, base: box[1] + box[3] })
  }
  for (const seat of layout.seats) {
    const w = walkers.get(seat.key)
    // a lounger lies across the sofa, so give the box room on both sides
    if (w) people.push({ key: seat.key, box: [w.x - 3, w.y - 2, 14, 18], base: w.y + 16 })
  }
  for (const bot of shownBots) {
    const box = botBox(bot)
    if (box) people.push({ key: botKey(bot), box, base: box[1] + box[3] })
  }
  // the one drawn last (nearest the bottom) is on top
  const person = people.sort((a, b) => b.base - a.base).find((m) => inBox(m.box))
  if (person) return person.key
  return layout.seats.find((u) => inBox(seatBoxOf(u)))?.key ?? null
}

// ---- hover card --------------------------------------------------------------------------------

// Where the pointer is over the canvas, or null when it is outside. The card is refreshed from it on
// every frame and every snapshot, so it follows someone who walks away and goes when a seat closes.
let pointer = null
let cardSig = null

/** The hover card for whoever is under the pointer: a title and lines of text, or null. */
function cardAt(ax, ay) {
  const key = whoAt(ax, ay)
  const visitor = key && visitors.get(key)
  if (visitor) {
    const { spec } = visitor
    const host = seatOf(key)
    const lines = [stateLabel(spec.state)]
    if (spec.task) lines.push(spec.task)
    if (host) lines.push(`helping ${nameplate(host)}`)
    return { key, title: spec.role ?? 'specialist', lines }
  }
  const bot = key && botOf(key)
  if (bot) {
    const lines = [`${botRole(bot)} · ${botStateFor(bot)}`]
    if (bot.desks.length) lines.push(`Running ${plural(bot.desks.length, 'desk')}`)
    if (bot.host) lines.push(`On ${bot.host}`)
    lines.push(bot.line)
    return { key, title: bot.name, lines }
  }
  const seat = key && seatOf(key)
  if (seat) {
    const { desk: d, staff } = seat
    const where = [seat.room?.bot ? projectOf(d) : seat.room?.name, d.branch || d.name, d.host && `on ${d.host}`].filter(Boolean).join(' · ')
    const lines = [where, ...seatFacts(seat), ...deskOrigin(d)]
    if (staff.said) lines.push(`"${staff.said}"`)
    return { key, title: staff.name || staff.label || d.name, lines }
  }
  if (onPalu(ax, ay)) return { key: 'palu', title: 'Palú', lines: ['The office dog. A pat wakes him up.'] }
  return null
}

function hideCard() {
  if (tooltip) tooltip.style.display = 'none'
  cardSig = null
}

function refreshCard() {
  if (!tooltip) return
  if (!pointer) return hideCard()
  const card = cardAt(...pointer.art())
  canvas.style.cursor = card ? 'pointer' : ''
  if (!card) return hideCard()
  const sig = JSON.stringify(card)
  if (sig !== cardSig) {
    cardSig = sig
    const body = el('div', 'muted')
    card.lines.forEach((line, i) => {
      if (i) body.append(el('br'))
      body.append(line)
    })
    tooltip.replaceChildren(el('div', 'title', card.title), body)
    tooltip.style.display = 'block'
  }
  // clamp to the card's measured size so a tall or wide card stays inside the panel
  const margin = 10
  const x = Math.min(window.innerWidth - tooltip.offsetWidth - margin, pointer.x + 14)
  const y = Math.min(window.innerHeight - tooltip.offsetHeight - margin, pointer.y + 14)
  tooltip.style.left = `${Math.max(margin, x)}px`
  tooltip.style.top = `${Math.max(margin, y)}px`
}

canvas.addEventListener('mousemove', (event) => {
  // keep the client point: the art point is taken again on each refresh, as the canvas may scroll
  const { clientX: x, clientY: y } = event
  pointer = { x, y, art: () => artPoint({ clientX: x, clientY: y }) }
  refreshCard()
})

canvas.addEventListener('mouseleave', () => {
  pointer = null
  canvas.style.cursor = ''
  hideCard()
})

canvas.addEventListener('click', (event) => {
  // the detail panel takes over from the card until the pointer moves again
  pointer = null
  hideCard()
  const [ax, ay] = artPoint(event)
  // a pat wakes Palú: if he is resting, he gets up and goes on to whatever he does next
  if (onPalu(ax, ay)) {
    if (!palu.path.length) paluNext()
    return
  }
  const hit = whoAt(ax, ay)
  selected = hit && hit !== selected ? hit : null
  if (opening && seatOf(selected)?.key !== opening.key) opening = null
  renderDetail()
  draw()
})

/** Switches the layout: everyone is placed afresh in the new office, nobody walks across. */
function setLayout(next) {
  if (!LAYOUTS.includes(next) || next === layoutTheme) return
  layoutTheme = next
  try {
    localStorage.setItem(THEME_KEY, layoutTheme)
  } catch {
    // kept for this session only
  }
  walkers.clear()
  visitors.clear()
  assigned.clear()
  palu = null
  chief = null
  scenePrimed = false
  selected = null
  opening = null
  renderThemes()
  renderDetail()
  hideCard()
  resize()
}

function setDark(next) {
  const value = next === true || next === 'true'
  if (value === dark) return
  dark = value
  try {
    localStorage.setItem(DARK_KEY, String(dark))
  } catch {
    // kept for this session only
  }
  applyDark()
  renderThemes()
  renderDetail()
  layout.dark = dark
  draw()
}

function setHideSleeping(next) {
  hideSleeping = next
  try {
    localStorage.setItem(SLEEPING_KEY, String(hideSleeping))
  } catch {
    // kept for this session only
  }
  renderThemes()
  // every desk takes its place afresh, so the rooms close up or open out
  forgetSlots()
  if (received) apply(received)
}

function setDeskStay(next) {
  deskStay = deskStayOf(next)
  try {
    localStorage.setItem(STAY_KEY, String(deskStay))
  } catch {
    // kept for this session only
  }
  renderThemes()
}

function renderThemes() {
  for (const button of document.querySelectorAll('#themes button')) {
    button.setAttribute('aria-pressed', String(button.dataset.layout === layoutTheme))
  }
  const darkButton = document.querySelector('#dark-toggle button')
  if (darkButton) {
    darkButton.setAttribute('aria-pressed', String(dark))
    darkButton.textContent = dark ? '☾' : '☀'
    darkButton.setAttribute('aria-label', dark ? 'Use light appearance' : 'Use dark appearance')
    darkButton.setAttribute('title', dark ? 'Use light appearance' : 'Use dark appearance')
  }
  const sleepingBox = document.getElementById('hide-sleeping')
  if (sleepingBox) {
    // Brick only ever seats agents at work, so there is nothing to hide there
    sleepingBox.hidden = !loft()
    const button = sleepingBox.querySelector('button')
    const hint = hideSleeping ? 'Desks with no agent are hidden. Click to show them.' : 'Hide desks with no agent, as Orca hides sleeping workspaces.'
    button?.setAttribute('aria-pressed', String(hideSleeping))
    button?.setAttribute('title', hint)
  }
  const stayButton = document.querySelector('#desk-stay button')
  if (stayButton) {
    const label = deskStayLabel(deskStay)
    const hint =
      deskStay > 0
        ? `A finished agent stays at its desk for ${label} before its break. Click to change.`
        : 'A finished agent leaves its desk for its break at once. Click to change.'
    stayButton.textContent = `⏱ ${label}`
    stayButton.setAttribute('aria-label', hint)
    stayButton.setAttribute('title', hint)
  }
}

// The coordinator control: shown only when Orca names bots, listing them by name.
const coordinatorBox = document.getElementById('coordinator')
const coordinatorSelect = coordinatorBox?.querySelector('select')
let coordinatorSig = null

function renderCoordinator() {
  if (!coordinatorBox || !coordinatorSelect) return
  const bots = snapshot?.bots ?? []
  coordinatorBox.hidden = bots.length === 0
  const label = document.getElementById('coordinator-label')
  if (label) label.hidden = bots.length === 0
  const options = [['', 'None'], ...bots.map((b) => [b.id, b.host ? `${b.name} on ${b.host}` : b.name])]
  const sig = JSON.stringify(options)
  if (sig !== coordinatorSig) {
    coordinatorSig = sig
    coordinatorSelect.replaceChildren(
      ...options.map(([value, text]) => {
        const option = el('option', '', text)
        option.value = value
        return option
      })
    )
  }
  coordinatorSelect.value = coordinatorId() ?? ''
}

coordinatorSelect?.addEventListener('change', () => {
  coordinatorPick = coordinatorSelect.value || null
  try {
    if (coordinatorPick) localStorage.setItem(COORD_KEY, coordinatorPick)
    else localStorage.removeItem(COORD_KEY)
  } catch {
    // kept for this session only
  }
  chief = null
  if (received) apply(received)
})

for (const button of document.querySelectorAll('#themes button')) button.addEventListener('click', () => setLayout(button.dataset.layout))
document.querySelector('#dark-toggle button')?.addEventListener('click', () => setDark(!dark))
document.querySelector('#desk-stay button')?.addEventListener('click', () => setDeskStay(nextDeskStay(deskStay)))
document.querySelector('#hide-sleeping button')?.addEventListener('click', () => setHideSleeping(!hideSleeping))
renderThemes()

async function poll() {
  if (document.visibilityState !== 'hidden') {
    try {
      apply(await orca.plugin.request('office.snapshot', undefined, { timeoutMs: 15000 }))
    } catch (error) {
      if (layout.seats.length === 0) showMessage(`The worker did not answer: ${error?.message ?? error}`)
    }
  }
  setTimeout(poll, POLL_MS)
}

setInterval(() => {
  if (document.visibilityState === 'hidden') return
  tick++
  planner.frame()
  stepWalkers()
  stepVisitors()
  stepPalu()
  stepChief()
  if (snapshot) scenePrimed = true
  draw()
  refreshCard()
}, FRAME_MS)

// The office's box follows the panel, not the canvas, so a relayout cannot re-fire this. Lay out
// on the next frame, outside the observer callback.
new ResizeObserver(() => requestAnimationFrame(resize)).observe(office)
// the canvas shows only what is on screen, so scrolling draws the new part at once
let scrolling = false
office.addEventListener(
  'scroll',
  () => {
    if (scrolling) return
    scrolling = true
    requestAnimationFrame(() => {
      scrolling = false
      draw()
    })
  },
  { passive: true }
)

showMessage('Opening the office...')
poll()

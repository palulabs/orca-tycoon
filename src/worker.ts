// Reads every agent through `orca worktree ps --json`, the same rows Orca's sidebar and phone app
// draw from. The plugin API's agents.list only covers the focused workspace, so the worker asks
// the CLI instead and trims the answer to what the office draws. One call covers this machine and
// its SSH targets; each paired Orca server (a cloud VM) answers only its own `--environment` call.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import type { Bot, Desk, Floor, OfficeSnapshot, Specialist, Staff, StaffState, SwitchOutcome } from './protocol'

export function windowsCliPath(executable: string): string {
  return win32.join(win32.dirname(executable), 'resources', 'bin', 'orca.exe')
}

export function cliEnvironment(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  if (platform !== 'win32') return { ...env }
  const { ELECTRON_RUN_AS_NODE: _, ...childEnv } = env
  if (!childEnv.APPDATA) childEnv.APPDATA = win32.join(home, 'AppData', 'Roaming')
  return childEnv
}

const CLI_CANDIDATES = [
  ...(process.platform === 'win32' ? [windowsCliPath(process.execPath)] : []),
  '/Applications/Orca.app/Contents/Resources/bin/orca',
  `${process.env.HOME ?? ''}/Applications/Orca.app/Contents/Resources/bin/orca`
]
const CLI_TIMEOUT_MS = 8000
// a paired server gets less, so this machine's call plus the slowest server's stay under the
// panel's 15 s wait for a snapshot
const SERVER_TIMEOUT_MS = 5000

function cliPath(): string {
  return CLI_CANDIDATES.find((p) => existsSync(p)) ?? 'orca'
}

/** Runs the CLI with an argument array (never a shell) and parses its JSON answer. */
function runCli(args: string[], timeout = CLI_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(cliPath(), args, {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      env: cliEnvironment(process.platform, process.env, homedir())
    }, (error, stdout) => {
      if (error && !stdout) return reject(error)
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch (parseError) {
        return reject(error ?? parseError)
      }
      // `--json` answers carry ok and, when refused, error.code / error.message
      const answer = parsed as { ok?: unknown; error?: { message?: unknown; code?: unknown } } | null
      if (answer?.ok === false) {
        return reject(new Error(str(answer.error?.message) ?? str(answer.error?.code) ?? 'the Orca CLI refused'))
      }
      resolve(parsed)
    })
  })
}

type Row = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One paired Orca server's `worktree ps` answer, with the selector that reached it. */
export type ServerAnswer = { environment: string; raw: unknown }

const RUNTIME_HOST = 'runtime:'

/**
 * The paired servers a local `worktree ps` names as not covered, by environment id. Orca's own
 * selector uses the server's name, which two servers can share; the id always resolves to one.
 */
export function pairedEnvironments(raw: unknown): string[] {
  const scope = (raw as { result?: { hostScope?: { omittedHostIds?: unknown } } } | null)?.result?.hostScope
  const hostIds = Array.isArray(scope?.omittedHostIds) ? scope.omittedHostIds : []
  const ids = hostIds
    .map((h) => str(h))
    .filter((h): h is string => !!h && h.startsWith(RUNTIME_HOST))
    .map((h) => {
      try {
        return decodeURIComponent(h.slice(RUNTIME_HOST.length)).trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  return [...new Set(ids)]
}

/**
 * This machine's answer, then every paired server's in parallel. A server that is down or slow
 * costs only its own desks: `onServerError` hears about it and the rest of the office still draws.
 */
export async function readAllHosts(
  run: (args: string[], timeout?: number) => Promise<unknown>,
  onServerError: (environment: string, error: unknown) => void = () => {}
): Promise<{ local: unknown; servers: ServerAnswer[] }> {
  const local = await run(['worktree', 'ps', '--agent-wait', '--json'])
  const answers = await Promise.all(
    pairedEnvironments(local).map(async (environment) => {
      try {
        return { environment, raw: await run(['worktree', 'ps', '--agent-wait', '--json', '--environment', environment], SERVER_TIMEOUT_MS) }
      } catch (error) {
        onServerError(environment, error)
        return null
      }
    })
  )
  return { local, servers: answers.filter((a): a is ServerAnswer => a !== null) }
}

/**
 * Orca's verdict that a terminal agent sits on a prompt only a person can answer:
 * `{source: 'prompt-text', reason, since?}`, `{source: 'title'}` or `{source: 'hook', since}`.
 * Anything else (absent, null, a stray primitive) means it is not waiting on you.
 */
function waitOf(row: Row): Row | null {
  const wait = row.agentWait
  return wait !== null && typeof wait === 'object' && typeof (wait as Row).source === 'string' ? (wait as Row) : null
}

export function staffState(row: Row): StaffState {
  const state = row.state
  // Orca's own blocked and done win over a stale prompt verdict
  if (state === 'blocked' || state === 'done') return state
  if (waitOf(row)) return 'waiting'
  if (state === 'working') {
    // `programStatus` lingers from an earlier turn, so only the live activity can say a run failed
    if ((row.activity as Row | null)?.status === 'failed') return 'blocked'
    return row.workingMode === 'monitoring' ? 'monitoring' : 'working'
  }
  if (state === 'waiting') return state
  return 'idle'
}

function specialistState(state: unknown): StaffState {
  if (
    state === 'working' ||
    state === 'monitoring' ||
    state === 'waiting' ||
    state === 'blocked' ||
    state === 'done'
  ) {
    return state
  }
  return 'idle'
}

// Chat UI sessions report their helpers as `children`, which Orca treats as the canonical list
// over the older `subagents` roster, even when it is empty. Only agents and workflows are
// specialists; commands and shells stay off the floor, and settled children have gone home.
const SPECIALIST_KINDS = new Set(['agent', 'workflow'])

function specialistsOf(row: Row): Specialist[] {
  if (Array.isArray(row.children)) {
    return (row.children as Row[])
      .filter((c) => SPECIALIST_KINDS.has(String(c.kind)) && c.membership !== 'settled')
      .map((c) => ({
        id: String(c.providerId ?? c.id ?? ''),
        role: str(c.agentType) ?? str(c.name),
        task: str(c.description),
        state: specialistState(c.state)
      }))
  }
  const subs = Array.isArray(row.subagents) ? (row.subagents as Row[]) : []
  return subs.map((s) => ({
    id: String(s.id ?? ''),
    role: str(s.agentType),
    task: str(s.description),
    state: specialistState(s.state)
  }))
}

// ---- what an agent says when you click it -----------------------------------------------------
// A short first-person line from the state, the tool and its input, which Orca already sends as a
// preview (a file path, a command, a search, a URL). Rules rather than a model: it costs nothing,
// it is never stale and nothing leaves the machine.

const base = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
const clip = (text: string, max = 24): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The command that does the work, past `cd x &&`, env assignments and wrappers. */
function mainCommand(command: string): string {
  const parts = command.split(/\s*(?:&&|\|\||;|\n)\s*/).map((p) => p.trim()).filter(Boolean)
  const strip = (p: string) =>
    p.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '').replace(/^(?:sudo|time|timeout\s+\S+|npx|bunx|exec)\s+/, '')
  const real = parts.map(strip).filter((p) => !/^(?:cd|export|set|source|\.|echo|true|O=|mkdir)\b/.test(p))
  // /Applications/Orca.app/.../bin/orca reads as orca
  return (real[0] ?? strip(parts[0] ?? '')).replace(/^\S*\//, '')
}

const COMMAND_LINES: [RegExp, string][] = [
  [/^gh\s+pr\s+(?:checks|status)\b/, "I'm checking the PR's checks"],
  [/^gh\s+pr\s+create\b/, "I'm opening a PR"],
  [/^gh\s+pr\s+merge\b/, "I'm merging the PR"],
  [/^gh\s+pr\s+(?:comment|review)\b/, "I'm replying on the PR"],
  [/^gh\s+pr\b/, "I'm looking at the PR"],
  [/^gh\s+run\s+watch\b/, "I'm watching CI run"],
  [/^gh\s+run\b/, "I'm checking CI"],
  [/^gh\s+issue\b/, "I'm reading an issue"],
  [/^gh\s+release\b/, "I'm cutting a release"],
  [/^gh\b/, "I'm asking GitHub"],
  [/^git\s+push\b/, "I'm pushing my branch"],
  [/^git\s+commit\b/, "I'm committing"],
  [/^git\s+(?:rebase|merge|pull|fetch)\b/, "I'm catching up with main"],
  [/^git\s+(?:checkout|switch|branch|worktree)\b/, "I'm switching branches"],
  [/^git\s+tag\b/, "I'm tagging a release"],
  [/^git\b/, "I'm looking at the changes"],
  [/\b(?:vitest|jest|pytest|playwright|mocha)\b|\b(?:cargo|go|deno|bun)\s+test\b|\btest\b/, "I'm running the tests"],
  [/\b(?:tsc|eslint|biome|lint|type-?check|typecheck|prettier|ruff|mypy|clippy|verify)\b/, "I'm running the checks"],
  [/\b(?:npm|pnpm|yarn|bun|pip|uv|brew|cargo)\s+(?:i|install|add)\b/, "I'm installing packages"],
  [/\bbuild\b/, "I'm building it"],
  [/\b(?:dev|serve|start|http\.server)\b/, "I'm starting a server"],
  [/^(?:curl|wget|http)\b/, "I'm fetching a page"],
  [/^sleep\b/, "I'm giving it a moment"],
  [/^(?:psql|supabase|sqlite3|mysql|prisma)\b/, "I'm checking the database"],
  [/^(?:docker|kubectl|terraform|tofu|vercel|fly|render)\b/, "I'm working on the infra"],
  [/^orca\b/, "I'm talking to Orca"],
  [/^(?:rg|grep|find|fd|ls|tree|cat|head|tail|sed|awk|wc|jq|less)\b/, "I'm looking through the code"],
  [/^(?:rm|mv|cp|chmod|ln)\b/, "I'm tidying files"],
  [/^(?:python3?|node|ruby|bash|sh|zsh|deno|bun|tsx)\b/, "I'm running a script"],
  [/^(?:pkill|kill)\b/, "I'm stopping a process"]
]

function commandLine(command: string): string {
  const cmd = mainCommand(command)
  for (const [pattern, line] of COMMAND_LINES) if (pattern.test(cmd)) return line
  const name = cmd.split(/\s+/)[0]
  return name ? `I'm running ${clip(base(name), 14)}` : "I'm running a command"
}

const READ_TOOLS = /^(?:read|view|view_file|read_file|read_many_files|NotebookRead)$/i
const EDIT_TOOLS = /^(?:edit|multiedit|notebookedit|edit_file|replace|search_replace|apply_patch|patch|replace_file_content|multi_replace_file_content)$/i
const WRITE_TOOLS = /^(?:write|create|write_file|write_to_file)$/i
const SHELL_TOOLS = /^(?:bash|execute|run_shell_command|run_command|exec_command|shell_command|run_terminal_cmd|run_terminal_command|terminal|powershell|shell|execute_code)$/i
const SEARCH_TOOLS = /^(?:grep|glob|search_file_content|grep_search|find_by_name|search_files|list_dir|ls|toolsearch)$/i

function toolLine(tool: string, input: string | null): string {
  if (SHELL_TOOLS.test(tool)) return input ? commandLine(input) : "I'm running a command"
  if (READ_TOOLS.test(tool)) return input ? `I'm reading ${clip(base(input))}` : "I'm reading the code"
  if (EDIT_TOOLS.test(tool)) return input ? `I'm editing ${clip(base(input))}` : "I'm editing the code"
  if (WRITE_TOOLS.test(tool)) return input ? `I'm writing ${clip(base(input))}` : "I'm writing a file"
  if (SEARCH_TOOLS.test(tool)) return "I'm searching the code"
  if (/^(?:webfetch|fetchurl|web_fetch|fetch_content|read_url_content|browser_navigate|open_page)$/i.test(tool)) {
    const host = input?.match(/^[a-z]+:\/\/(?:www\.)?([^/:?#]+)/i)?.[1]
    return host ? `I'm reading ${clip(host)}` : "I'm reading a web page"
  }
  if (/search/i.test(tool) && /web|google/i.test(tool)) return input ? `I'm looking up ${clip(input, 18)}` : "I'm looking something up"
  if (/^(?:agent|task|spawn_subagent|delegate_task)$/i.test(tool)) return "I'm briefing a specialist"
  if (/^workflow$/i.test(tool)) return "I'm running a workflow"
  if (/^(?:todowrite|todo_write|update_plan|manage_task|exitplanmode|enterplanmode)$/i.test(tool)) return "I'm planning the next steps"
  if (/^skill$/i.test(tool)) return "I'm reading up on a skill"
  if (/^(?:monitor|schedulewakeup|taskoutput|bashoutput)$/i.test(tool)) return "I'm keeping an eye on a job"
  if (/^browser_|^mcp__claude-in-chrome__/i.test(tool)) return "I'm clicking through a page"
  // mcp__<server>__<tool>: claude_ai_Linear is Linear, plugin_figma_figma is figma
  const server = tool.match(/^mcp__(.+?)__/)?.[1].replace(/^claude_ai_/, '').replace(/^plugin_.*_/, '')
  if (server) return `I'm using ${clip(server.replace(/_/g, ' '), 16)}`
  return "I'm working on it"
}

/** What an agent says for each prompt Orca recognises on its terminal. */
const WAIT_LINES: Record<string, string> = {
  'agent-approval-prompt': 'Can I go ahead? I need your OK',
  'agent-hooks-review-prompt': 'Please review my hooks',
  'agent-startup-menu-prompt': 'Pick an option to get me started',
  'agent-update-prompt': 'I have an update to confirm'
}

/** The one line an agent says when you click it. */
export function lineOf(row: Row, state: StaffState, specialists: Specialist[]): string {
  const busy = specialists.filter((s) => s.state !== 'done' && s.state !== 'idle')
  if (state === 'waiting') {
    const reason = str(waitOf(row)?.reason)
    if (reason && WAIT_LINES[reason]) return WAIT_LINES[reason]
    return /ask/i.test(String(row.toolName ?? '')) ? 'I have a question for you' : 'I need your input'
  }
  if (state === 'blocked') return "I'm stuck, can you help?"
  if (state === 'done') return str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? 'All done!'
  if (state === 'idle') return "I'm free"
  const tool = str(row.toolName)
  // a specialist's turn: the agent is monitoring, or sits on the Agent call that launched it
  const handedOff = state === 'monitoring' || !tool || /^(?:agent|task)$/i.test(tool)
  if (handedOff && busy.length === 1) return `I'm waiting on the ${clip(busy[0].role ?? 'specialist', 18)}`
  if (handedOff && busy.length > 1) return `I'm waiting on ${busy.length} specialists`
  if (state === 'monitoring') return "I'm waiting on a background job"
  return tool ? toolLine(tool, str(row.toolInput)) : "I'm thinking"
}

// ---- the nameplate on a desk --------------------------------------------------------------------
// A ticket key or issue number wins wherever it appears. Otherwise a workspace with a name of its
// own keeps it, and only a generic one (the main checkout, `main`, or a name several desks in the
// project share) borrows the first word of the agent's conversation title instead.

const TICKET_KEY = /\b[A-Z]{2,6}-\d+\b/
const ISSUE_NUMBER = /#(\d+)\b/
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u
const TRAILING_SYMBOLS = /[^\p{L}\p{N}]+$/u

/** The first word of a title, without the symbols around it; empty when there is none. */
function firstWord(title: string): string {
  const word = title.replace(LEADING_SYMBOLS, '').split(/[\s/]+/)[0] ?? ''
  return word.replace(TRAILING_SYMBOLS, '')
}

const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk'])

/** True when a workspace name says nothing about the work: a default branch name. */
export function isGenericName(deskName: string, defaultBranch: string | null = null): boolean {
  const name = deskName.trim().toLowerCase()
  return DEFAULT_BRANCHES.has(name) || (defaultBranch !== null && name === defaultBranch.toLowerCase())
}

/** A workspace's own short name: its first word, and for a branch path its last segment. */
function ownName(deskName: string): string {
  return deskName.trim().split(/\s+/)[0].split('/').filter(Boolean).pop() ?? ''
}

/**
 * What the nameplate reads for an agent whose conversation is `name`, at the desk `deskName`.
 * `generic` says the desk's own name tells it apart from nothing, so the title gets a turn.
 */
export function labelOf(name: string | null, deskName: string, generic = isGenericName(deskName)): string {
  const title = name ?? ''
  const ticket = title.match(TICKET_KEY) ?? deskName.match(TICKET_KEY)
  if (ticket) return ticket[0]
  const issue = title.match(ISSUE_NUMBER) ?? deskName.match(ISSUE_NUMBER)
  if (issue) return `#${issue[1]}`
  if (!generic) return ownName(deskName) || firstWord(title) || 'workspace'
  return firstWord(title) || ownName(deskName) || 'workspace'
}

function toStaff(row: Row, deskName: string, generic: boolean): Staff {
  const specialists = specialistsOf(row)
  return {
    id: String(row.paneKey ?? ''),
    agent: str(row.agentType),
    name: str(row.conversationName) ?? str(row.displayName) ?? str(row.taskTitle),
    label: labelOf(str(row.conversationName), deskName, generic),
    task: str(row.taskTitle) ?? str(row.prompt)?.slice(0, 140) ?? null,
    tool: str(row.toolName),
    said: str(row.lastAssistantMessage)?.split('\n')[0]?.slice(0, 120) ?? null,
    state: staffState(row),
    line: lineOf(row, staffState(row), specialists),
    since: typeof row.stateStartedAt === 'number' ? row.stateStartedAt : 0,
    specialists
  }
}

const worktreesOf = (raw: unknown): Row[] => {
  const worktrees = (raw as { result?: { worktrees?: unknown } } | null)?.result?.worktrees
  return Array.isArray(worktrees) ? (worktrees as Row[]) : []
}

/**
 * The office from this machine's `worktree ps` answer and each paired server's. A server's desks
 * join the team of their project like any other, their ids prefixed with the server so a desk
 * there never collides with one here, and they carry the selector "Open in Orca" goes through.
 *
 * Bots take their own place. A bot's home folder (`botHome`) is the bot itself, never a desk, and
 * every workspace that names a bot (`bot`) leaves its project for that bot's desks. An Orca that
 * sends neither draws the office it always did.
 */
export function toSnapshot(raw: unknown, at: number, servers: ServerAnswer[] = []): OfficeSnapshot {
  type Placed = { w: Row; environment: string | null }
  const all: Placed[] = [
    ...worktreesOf(raw).map((w) => ({ w, environment: null })),
    ...servers.flatMap((s) => worktreesOf(s.raw).map((w) => ({ w, environment: s.environment })))
  ]
  const idOf = (id: string | null, environment: string | null) => (id && environment ? `${environment}|${id}` : id)
  const repoOf = (w: Row) => str(w.repo) ?? 'Other'
  const busy = (w: Row) => Array.isArray(w.agents) && w.agents.length > 0
  const hostOf = ({ w, environment }: Placed) => (environment ? str((w.environment as Row | null)?.name) ?? environment : null)
  const open = all.filter(({ w }) => w.isArchived !== true)
  const homes = open.filter(({ w }) => w.botHome === true && str(w.bot))
  // a bot's home is never a desk, even one that does not say which bot it is
  const rest = open.filter(({ w }) => w.botHome !== true)
  const owners = botOwners(all)
  const botOf = (placed: Placed) => owners.get(placed.w) ?? null
  const botDesks = rest.filter((placed) => botOf(placed))
  const projectDesks = rest.filter((placed) => !botOf(placed))
  // A project with a live agent brings all its worktrees that are not archived, the sleeping ones
  // too, so the loft can give each its desk; a project nobody works in stays off the floor.
  const working = new Set(projectDesks.filter(({ w }) => busy(w)).map(({ w }) => repoOf(w)))
  const live = projectDesks.filter(({ w }) => working.has(repoOf(w)))
  const nameOf = (w: Row) => str(w.displayName) ?? str(w.branch)?.replace(/^refs\/heads\//, '') ?? 'workspace'
  // names several desks in one project share tell those desks apart from nothing
  // an agent's nameplate weighs its name against the other busy desks, as it always did; a desk's
  // own nameplate, shown while it sleeps, against every desk on the floor
  const seen = new Map<string, number>()
  const seenAll = new Map<string, number>()
  // a bot's desks sit apart from their project's team, so they are told apart among the bot's own
  const nameKey = (w: Row) => {
    const owner = owners.get(w)
    return `${owner ? `\u0000bot|${owner.environment ?? ''}|${owner.name}|` : ''}${repoOf(w)}\n${nameOf(w).toLowerCase()}`
  }
  for (const { w } of [...live, ...botDesks]) {
    const key = nameKey(w)
    seenAll.set(key, (seenAll.get(key) ?? 0) + 1)
    if (busy(w)) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const rowOfDesk = new Map<Desk, Row>()
  // a project's main checkout, by repository: the folder over it names the project's owner
  const mains = new Map<string, string>()
  for (const { w, environment } of all) {
    const repoId = str(w.repoId)
    const path = str(w.path)
    const key = `${environment ?? ''}|${repoId}`
    if (repoId && path && w.isMainWorktree === true && !mains.has(key)) mains.set(key, path)
  }
  const deskOf = (placed: Placed, bot: string | null): Desk => {
    const desk = makeDesk(placed, bot)
    rowOfDesk.set(desk, placed.w)
    return desk
  }
  const makeDesk = (placed: Placed, bot: string | null): Desk => {
    const { w, environment } = placed
    const agents = busy(w) ? (w.agents as Row[]) : []
    const repo = repoOf(w)
    const name = nameOf(w)
    const defaultBranch = str(w.defaultBranch)?.replace(/^(?:refs\/heads\/|origin\/)/, '') ?? null
    const plain = w.isMainWorktree === true || isGenericName(name, defaultBranch)
    const generic = plain || (seen.get(nameKey(w)) ?? 0) > 1
    const deskGeneric = plain || (seenAll.get(nameKey(w)) ?? 0) > 1
    return {
      id: idOf(String(w.worktreeId ?? ''), environment) ?? '',
      name,
      repo,
      branch: str(w.branch)?.replace(/^refs\/heads\//, '') ?? null,
      parentId: idOf(str(w.parentWorktreeId), environment),
      environment,
      host: hostOf(placed),
      label: labelOf(null, name, deskGeneric),
      staff: agents.map((row) => toStaff(row, name, generic)),
      bot,
      org: null,
      automation: w.automationCreated === true ? { name: str(w.automationName) } : null
    }
  }
  const floors = new Map<string, Desk[]>()
  for (const placed of live) {
    const list = floors.get(repoOf(placed.w)) ?? []
    list.push(deskOf(placed, null))
    floors.set(repoOf(placed.w), list)
  }
  const out: Floor[] = [...floors.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, desks]) => ({ repo, desks }))

  // the bots: every home, then whoever a desk names without a home in the rows
  const bots = new Map<string, Bot>()
  for (const placed of homes) {
    const { w, environment } = placed
    const name = str(w.bot)!
    const id = idOf(name, environment)!
    if (bots.has(id)) continue
    const agents = busy(w) ? (w.agents as Row[]) : []
    bots.set(id, {
      ...botBase(id, name, environment, hostOf(placed)),
      homeId: idOf(str(w.worktreeId), environment),
      staff: agents.map((row) => toStaff(row, name, false))
    })
  }
  for (const placed of botDesks) {
    const { name, environment } = botOf(placed)!
    // the bot of that name on the Orca that names it, else the only one of that name anywhere,
    // else one known only from its desks
    let bot = bots.get(idOf(name, environment)!)
    if (!bot) {
      const named = [...bots.values()].filter((b) => b.name === name && b.homeId !== null)
      bot = named.length === 1 ? named[0] : undefined
    }
    if (!bot) {
      const id = idOf(name, placed.environment)!
      bot = { ...botBase(id, name, placed.environment, hostOf(placed)), homeId: null, staff: [] }
      bots.set(id, bot)
    }
    bot.desks.push(deskOf(placed, bot.id))
  }
  const botList = [...bots.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  for (const bot of botList) {
    Object.assign(bot, botLook(bot))
    tellProjectsApart(bot.desks, rowOfDesk, mains)
  }
  return { at, floors: out, bots: botList, error: null }
}

/** Which bot a workspace belongs to: the name it goes by and the Orca whose row names it. */
type Owner = { name: string; environment: string | null }

/** `local` in a row's parent address is this machine; any other id is the paired server it names. */
const environmentOfId = (id: string | null): string | null => (!id || id === 'local' ? null : id)

/** Every way another row can point at this one: its id, its `id:` and `identity:` selectors, its instance. */
function refsOf(w: Row): string[] {
  const id = str(w.worktreeId)
  const identity = (w.identity ?? null) as Row | null
  const key = str(identity?.key)
  const instance = str(identity?.instanceId) ?? str(w.worktreeInstanceId) ?? (id?.startsWith('folder:') ? id.slice('folder:'.length) : null)
  return [...(id ? [id, `id:${id}`] : []), ...(key ? [`identity:${key}`] : []), ...(instance ? [`instance:${instance}`] : [])]
}

/**
 * The bot every workspace belongs to, if any. Orca's rule: whatever sits under a bot in
 * navigation is in its room. A row that names its bot (`bot`) says so itself; any other row
 * belongs to the bot of its parent, followed up the chain (a child of a child of the bot too).
 * The parent can sit on another Orca: a workspace on a paired server nested under a bot here
 * names neither the bot nor a lineage, only `parent.selector` and the environment it is on.
 */
export function botOwners(all: { w: Row; environment: string | null }[]): Map<Row, Owner> {
  const byRef = new Map<string, { w: Row; environment: string | null }[]>()
  const at = (environment: string | null, ref: string) => `${environment ?? ''}\u0000${ref}`
  for (const placed of all) {
    for (const ref of refsOf(placed.w)) {
      for (const key of [at(placed.environment, ref), at('*', ref)]) {
        const list = byRef.get(key) ?? []
        list.push(placed)
        byRef.set(key, list)
      }
    }
  }
  /** The row a reference names: on the Orcas tried first, in order, else the only one anywhere. */
  const find = (ref: string | null, environments: (string | null)[]) => {
    if (!ref) return null
    for (const environment of environments) {
      const hit = byRef.get(at(environment, ref))
      if (hit?.length === 1) return hit[0]
    }
    const anywhere = byRef.get(at('*', ref))
    return anywhere?.length === 1 ? anywhere[0] : null
  }
  const parentOf = ({ w, environment }: { w: Row; environment: string | null }) => {
    const parent = (w.parent ?? null) as Row | null
    const lineage = (w.workspaceLineage ?? null) as Row | null
    const named = environmentOfId(str((parent?.environment as Row | null)?.id))
    return (
      find(str(parent?.selector), [named, environment]) ??
      find(str(w.parentWorktreeId), [environment, null]) ??
      find(str(lineage?.parentWorkspaceKey), [environment, null]) ??
      find(str(lineage?.parentInstanceId) ? `instance:${str(lineage?.parentInstanceId)}` : null, [environment, null])
    )
  }
  const owners = new Map<Row, Owner>()
  const settled = new Set<Row>()
  const ownerOf = (placed: { w: Row; environment: string | null }, path: Set<Row>): Owner | null => {
    const { w, environment } = placed
    if (settled.has(w)) return owners.get(w) ?? null
    let owner: Owner | null = null
    const name = str(w.bot)
    if (name) owner = { name, environment }
    else if (w.botHome !== true && !path.has(w)) {
      path.add(w)
      const parent = parentOf(placed)
      if (parent) owner = ownerOf(parent, path)
    }
    settled.add(w)
    if (owner) owners.set(w, owner)
    return owner
  }
  for (const placed of all) ownerOf(placed, new Set())
  return owners
}

/** The folder a checkout's project lives in, the owner or org: `kimbigames` for ~/code/kimbigames/website. */
function orgOf(path: string | null): string | null {
  const parts = (path ?? '').split(/[\\/]+/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : null
}

/**
 * Desks in one bot's room whose projects share a name but are different repositories (three
 * `website` desks from three orgs) get their project's owner, so their tags tell them apart.
 * The owner is the folder over the project's main checkout, else over the desk's own checkout.
 */
function tellProjectsApart(desks: Desk[], rowOf: Map<Desk, Row>, mains: Map<string, string>): void {
  const byName = new Map<string, Desk[]>()
  for (const d of desks) byName.set(d.repo.toLowerCase(), [...(byName.get(d.repo.toLowerCase()) ?? []), d])
  for (const same of byName.values()) {
    const repoIdOf = (d: Desk) => {
      const repoId = str(rowOf.get(d)?.repoId)
      return repoId ? `${d.environment ?? ''}|${repoId}` : d.id
    }
    if (new Set(same.map(repoIdOf)).size < 2) continue
    for (const d of same) d.org = orgOf(mains.get(repoIdOf(d)) ?? str(rowOf.get(d)?.path))
  }
}

function botBase(id: string, name: string, environment: string | null, host: string | null): Bot {
  return { id, name, homeId: null, environment, host, staff: [], desks: [], state: 'asleep', line: '', said: null, task: null, since: 0 }
}

// most urgent first: one chat that needs you speaks for the bot
const URGENCY: StaffState[] = ['blocked', 'waiting', 'working', 'monitoring', 'done', 'idle']
const BUSY_STATES = new Set<StaffState>(['working', 'monitoring', 'waiting', 'blocked'])

/**
 * How a bot shows and what it says: its most urgent chat session; keeping an eye on its desks when
 * that chat is quiet and one of them is busy; asleep with no chat at all.
 */
export function botLook(bot: Pick<Bot, 'staff' | 'desks'>): Pick<Bot, 'state' | 'line' | 'said' | 'task' | 'since'> {
  const lead = [...bot.staff].sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state))[0]
  if (!lead) return { state: 'asleep', line: "I'm resting until someone asks for me", said: null, task: null, since: 0 }
  const busyDesks = bot.desks.filter((d) => d.staff.some((s) => BUSY_STATES.has(s.state)))
  const quiet = lead.state === 'done' || lead.state === 'idle'
  if (quiet && busyDesks.length) {
    const what = busyDesks.length === 1 ? busyDesks[0].staff.find((s) => BUSY_STATES.has(s.state))?.label || busyDesks[0].label : `${busyDesks.length} desks`
    return { state: 'watching', line: `I'm keeping an eye on ${what}`, said: lead.said, task: lead.task, since: lead.since }
  }
  return { state: lead.state, line: lead.line, said: lead.said, task: lead.task, since: lead.since }
}

// ---- Open in Orca -------------------------------------------------------------------------------
// The panel has no CLI, so it asks the worker to bring an agent to the front. A terminal agent's
// pane key is `${tabId}:${leafId}` of a row in `orca terminal list --json`, whose handle
// `orca terminal switch` takes. A Chat UI session is not a terminal: its pane key starts with
// `structured-agent-session-` and no CLI command focuses its tab, so the worker shows its
// worktree instead with `orca worktree activate`, as clicking it in the sidebar does. Nothing the
// panel sends reaches the CLI: the pane key only picks a handle or a worktree id from Orca's own
// answers.

const CHAT_SESSION_PREFIX = 'structured-agent-session-'

export const isChatSession = (paneKey: string): boolean => paneKey.startsWith(CHAT_SESSION_PREFIX)

/** `orca terminal switch` for the terminal whose pane key this is, from `orca terminal list --json`. */
export function terminalSwitchArgs(paneKey: string, raw: unknown): string[] | null {
  const terminals = (raw as { result?: { terminals?: Row[] } } | null)?.result?.terminals
  if (!Array.isArray(terminals)) return null
  const match = terminals.find((t) => `${String(t.tabId ?? '')}:${String(t.leafId ?? '')}` === paneKey)
  const handle = str(match?.handle)
  return handle ? ['terminal', 'switch', '--terminal', handle] : null
}

/** `orca worktree activate` for the worktree the agent with this pane key sits in, from `worktree ps`. */
export function worktreeActivateArgs(paneKey: string, raw: unknown): string[] | null {
  const worktrees = (raw as { result?: { worktrees?: Row[] } } | null)?.result?.worktrees
  if (!Array.isArray(worktrees)) return null
  for (const w of worktrees) {
    const agents = Array.isArray(w.agents) ? (w.agents as Row[]) : []
    if (!agents.some((a) => a.paneKey === paneKey)) continue
    const id = str(w.worktreeId)
    return id ? ['worktree', 'activate', '--worktree', `id:${id}`] : null
  }
  return null
}

const PANE_KEY_MAX = 512

/**
 * Answers 'office.switch'. `run` is the CLI: an argument array in, its parsed JSON out. An agent
 * on a paired server names its `environment`, which must be one Orca itself listed (`known`), so
 * the panel can only pick a server, never pass the CLI a flag of its own.
 */
export async function switchTo(
  input: unknown,
  run: (args: string[]) => Promise<unknown>,
  known: readonly string[] = []
): Promise<SwitchOutcome> {
  const paneKey = str((input as { paneKey?: unknown } | null)?.paneKey)
  if (!paneKey || paneKey.length > PANE_KEY_MAX) return { ok: false, error: 'no pane key' }
  const environment = (input as { environment?: unknown }).environment ?? null
  if (environment !== null && (typeof environment !== 'string' || !known.includes(environment))) {
    return { ok: false, error: 'that Orca server is not paired' }
  }
  const on = environment ? ['--environment', environment] : []
  try {
    if (!isChatSession(paneKey)) {
      const terminal = terminalSwitchArgs(paneKey, await run(['terminal', 'list', '--json', ...on]))
      if (terminal) {
        await run([...terminal, '--json', ...on])
        return { ok: true, via: 'terminal' }
      }
    }
    const worktree = worktreeActivateArgs(paneKey, await run(['worktree', 'ps', '--json', ...on]))
    if (!worktree) return { ok: false, error: 'this agent is no longer in Orca' }
    await run([...worktree, '--json', ...on])
    return { ok: true, via: 'worktree' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  let last: OfficeSnapshot = { at: 0, floors: [], bots: [], error: null }
  let environments: string[] = []
  orca.panels.handle('office.snapshot', async () => {
    try {
      const { local, servers } = await readAllHosts(runCli, (environment, error) =>
        orca.log(`worktree ps on ${environment} failed: ${error instanceof Error ? error.message : String(error)}`)
      )
      environments = pairedEnvironments(local)
      last = toSnapshot(local, Date.now(), servers)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      orca.log(`worktree ps failed: ${message}`)
      last = { ...last, error: message }
    }
    return last
  })
  orca.panels.handle('office.switch', async (input) => {
    const outcome = await switchTo(input, runCli, environments)
    if (!outcome.ok) orca.log(`open in Orca failed: ${outcome.error}`)
    return outcome
  })
}

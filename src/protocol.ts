// The panel <-> worker contract, declared once: src/panel.js and src/worker.ts both read it.
export {}

export type StaffState = 'working' | 'monitoring' | 'waiting' | 'blocked' | 'done' | 'idle'

/** The selectable office layout; Dark is an appearance attribute, not a layout. */
export type OfficeLayout = 'brick' | 'loft'

/** Persisted panel appearance, split so every layout can be rendered in either appearance. */
export type OfficeAppearance = { layout: OfficeLayout; dark: boolean }

/** A subagent: a specialist the agent called in, seated on a stool at its desk. */
export type Specialist = {
  id: string
  role: string | null
  task: string | null
  state: StaffState
}

export type Staff = {
  id: string
  agent: string | null
  name: string | null
  task: string | null
  tool: string | null
  /** First line of the agent's last reply, for its speech bubble. */
  said: string | null
  state: StaffState
  /** What the agent says when you click it: "I'm editing panel.js", "I'm watching CI run". */
  line: string
  /** The nameplate on its desk: a ticket key, an issue number or the first word of its title. */
  label: string
  since: number
  specialists: Specialist[]
}

export type Desk = {
  id: string
  name: string
  /** The project it works in: its floor's repo, and the tag under its nameplate in a bot's room. */
  repo: string
  branch: string | null
  parentId: string | null
  /** The `--environment` selector of the paired Orca server it runs on; null on this machine. */
  environment: string | null
  /** That server's name, for the detail box; null on this machine. */
  host: string | null
  /** The desk's nameplate when nobody sits at it: its ticket key, issue number or own name. */
  label: string
  /** Its agents; none when the worktree is asleep. */
  staff: Staff[]
  /** The bot that runs this desk (its Bot.id); null when none, or on an Orca that does not say. */
  bot: string | null
  /**
   * The owner or org folder of its project, only in a bot's room where another desk works in a
   * different project of the same name: `kimbigames` beside `palulabs` for two `website`s.
   */
  org: string | null
  /** Set when an automation made this workspace: its name, or null when Orca only says one did. */
  automation: { name: string | null } | null
}

export type Floor = { repo: string; desks: Desk[] }

/**
 * How a bot shows: an agent's state, 'watching' when its own chat is quiet but a desk it runs is
 * busy (it keeps an eye on them), or 'asleep' when it has no chat session open.
 */
export type BotState = StaffState | 'watching' | 'asleep'

/** An Orca bot: a named assistant people ask from Slack, Linear or GitHub, with desks of its own. */
export type Bot = {
  /** Its name, prefixed `${environment}|` on a paired server: what Desk.bot points at. */
  id: string
  /** As Orca names it: "Chief of Stack". */
  name: string
  /** Its home folder's worktree id; null for a bot known only from its desks. */
  homeId: string | null
  /** The `--environment` selector of the paired Orca server its home is on; null on this machine. */
  environment: string | null
  /** That server's name, for the detail box; null on this machine. */
  host: string | null
  /** Its own chat sessions; none while it sleeps. */
  staff: Staff[]
  /** Every desk it runs, sleeping ones too; these are not on the project floors. */
  desks: Desk[]
  state: BotState
  /** What it says when you click it. */
  line: string
  /** First line of its last reply, for its speech bubble. */
  said: string | null
  task: string | null
  since: number
}

export type OfficeSnapshot = {
  at: number
  floors: Floor[]
  /** Every bot Orca names, sorted by name; empty on an Orca without bots. */
  bots: Bot[]
  error: string | null
}

/** What came of "Open in Orca": the agent's terminal tab came up, or only its worktree could. */
export type SwitchOutcome = { ok: true; via: 'terminal' | 'worktree' } | { ok: false; error: string }

declare module 'orca' {
  interface PluginRequests {
    /** Every workspace with its agents and their subagents, grouped by project. */
    'office.snapshot': { output: OfficeSnapshot }
    /** Brings an agent to the front in Orca: its terminal tab, or its worktree for a Chat UI session. */
    'office.switch': { input: { paneKey: string; environment?: string | null }; output: SwitchOutcome }
  }
}

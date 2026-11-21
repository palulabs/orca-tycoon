// Runs the mapping from `orca worktree ps --json` rows to the office model, and the lookup from
// an agent's pane key to the CLI call that brings it to the front.
import { assert, test } from 'orca/testing'
import {
  botLook,
  cliEnvironment,
  isChatSession,
  labelOf,
  lineOf,
  pairedEnvironments,
  readAllHosts,
  staffState,
  switchTo,
  terminalSwitchArgs,
  toSnapshot,
  windowsCliPath,
  worktreeActivateArgs
} from './worker'

test('uses the Windows CLI launcher and supplies its required environment', () => {
  assert.equal(windowsCliPath('C:\\Program Files\\Orca\\Orca.exe'), 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe')
  assert.deepEqual(
    cliEnvironment('win32', { ELECTRON_RUN_AS_NODE: '1', PATH: 'example' }, 'C:\\Users\\Example'),
    { PATH: 'example', APPDATA: 'C:\\Users\\Example\\AppData\\Roaming' }
  )
  assert.deepEqual(
    cliEnvironment('win32', { APPDATA: 'D:\\Roaming', ELECTRON_RUN_AS_NODE: '1' }, 'C:\\Users\\Example'),
    { APPDATA: 'D:\\Roaming' }
  )
  assert.deepEqual(cliEnvironment('linux', { ELECTRON_RUN_AS_NODE: '1' }, '/home/example'), { ELECTRON_RUN_AS_NODE: '1' })
})

test('groups agents by project and keeps subagents as specialists', () => {
  const raw = {
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          branch: 'refs/heads/main',
          displayName: 'main',
          agents: [
            {
              paneKey: 'p1',
              state: 'working',
              agentType: 'claude',
              taskTitle: 'SRE-213',
              stateStartedAt: 5,
              subagents: [{ id: 's1', agentType: 'release-engineer', description: 'Build watcher', state: 'working' }]
            }
          ]
        },
        { worktreeId: 'w2', repo: 'infra', agents: [] },
        {
          worktreeId: 'w3',
          repo: 'client-portal',
          displayName: 'TTM-2076',
          agents: [{ paneKey: 'p3', state: 'working', workingMode: 'monitoring' }]
        }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors.map((f) => f.repo), ['client-portal', 'infra'])
  const infra = snap.floors[1].desks[0]
  assert.equal(infra.branch, 'main')
  assert.equal(infra.staff[0].specialists[0].role, 'release-engineer')
  assert.equal(snap.floors[0].desks[0].staff[0].state, 'monitoring')
})

test('reads Chat UI children as specialists, leaving out commands and settled work', () => {
  const agent = (children: unknown[], subagents?: unknown[]) => ({
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          displayName: 'SRE-200',
          agents: [{ paneKey: 'p1', state: 'working', agentType: 'claude', children, subagents }]
        }
      ]
    }
  })
  const children = [
    {
      id: 'c1',
      providerId: 'a7a0',
      kind: 'agent',
      agentType: 'release-engineer',
      description: 'SRE-200 workflow schedule',
      state: 'working',
      membership: 'live'
    },
    { id: 'c2', providerId: 'b1', kind: 'command', description: 'Watch the run', state: 'working', membership: 'live' },
    { id: 'c3', kind: 'agent', name: 'reviewer', state: 'done', membership: 'settled' },
    { id: 'c4', kind: 'workflow', name: 'review-changes', state: 'monitoring', membership: 'live' }
  ]
  const staff = toSnapshot(agent(children), 1).floors[0].desks[0].staff[0]
  assert.deepEqual(
    staff.specialists.map((s) => [s.id, s.role, s.state]),
    [
      ['a7a0', 'release-engineer', 'working'],
      ['c4', 'review-changes', 'monitoring']
    ]
  )
  assert.equal(staff.specialists[0].task, 'SRE-200 workflow schedule')
  // An explicit empty children list wins over a stale subagents roster.
  const old = [{ id: 's1', agentType: 'x', state: 'working' }]
  assert.equal(toSnapshot(agent([], old), 1).floors[0].desks[0].staff[0].specialists.length, 0)
})

test('agents say one short line about what they are doing', () => {
  const say = (row: Record<string, unknown>, subs: unknown[] = []) => {
    const raw = { result: { worktrees: [{ worktreeId: 'w', repo: 'r', agents: [{ paneKey: 'p', ...row, subagents: subs }] }] } }
    return toSnapshot(raw, 1).floors[0].desks[0].staff[0].line
  }
  const bash = (command: string) => say({ state: 'working', toolName: 'Bash', toolInput: command })
  assert.equal(bash('gh run watch 42620993132 -R tatomahq/infra --exit-status'), "I'm watching CI run")
  assert.equal(bash('cd ~/code/app && gh pr checks 12'), "I'm checking the PR's checks")
  assert.equal(bash('CI=1 pnpm -F web test'), "I'm running the tests")
  assert.equal(bash('git push -q origin main'), "I'm pushing my branch")
  assert.equal(bash('pnpm -F web lint'), "I'm running the checks")
  assert.equal(bash('make deploy'), "I'm running make")
  assert.equal(bash('/Applications/Orca.app/Contents/Resources/bin/orca worktree ps --json'), "I'm talking to Orca")
  assert.equal(say({ state: 'working', toolName: 'Edit', toolInput: '/Users/x/app/src/panel.js' }), "I'm editing panel.js")
  assert.equal(say({ state: 'working', toolName: 'Read', toolInput: 'src/worker.ts' }), "I'm reading worker.ts")
  assert.equal(say({ state: 'working', toolName: 'Grep', toolInput: 'lineOf' }), "I'm searching the code")
  assert.equal(say({ state: 'working', toolName: 'WebFetch', toolInput: 'https://www.onorca.dev/plugins' }), "I'm reading onorca.dev")
  assert.equal(say({ state: 'working', toolName: 'mcp__claude_ai_Linear__save_comment' }), "I'm using Linear")
  assert.equal(say({ state: 'working', toolName: 'mcp__plugin_figma_figma__get_design' }), "I'm using figma")
  assert.equal(say({ state: 'working', toolName: null }), "I'm thinking")
  // a specialist's turn, but only when the agent is not busy with a tool of its own
  const sub = [{ id: 's', agentType: 'release-engineer', state: 'working' }]
  assert.equal(say({ state: 'working', toolName: 'Agent' }, sub), "I'm waiting on the release-engineer")
  assert.equal(say({ state: 'working', workingMode: 'monitoring', toolName: 'Bash' }, [...sub, { ...sub[0], id: 't' }]), "I'm waiting on 2 specialists")
  assert.equal(say({ state: 'working', toolName: 'Bash', toolInput: 'git status' }, sub), "I'm looking at the changes")
  assert.equal(say({ state: 'working', workingMode: 'monitoring' }), "I'm waiting on a background job")
  assert.equal(say({ state: 'waiting', toolName: 'AskUserQuestion' }), 'I have a question for you')
  assert.equal(say({ state: 'blocked' }), "I'm stuck, can you help?")
  assert.equal(say({ state: 'done', lastAssistantMessage: 'Merged #12.\nMore below' }), 'Merged #12.')
})

test('staffState trusts Orca\'s prompt verdict and live activity, not a stale program result', () => {
  // the shapes Orca's agentWait verdict comes in
  assert.equal(staffState({ state: 'working', agentWait: { source: 'prompt-text', reason: 'agent-approval-prompt' } }), 'waiting')
  assert.equal(staffState({ state: 'working', agentWait: { source: 'title' } }), 'waiting')
  assert.equal(staffState({ state: 'idle', agentWait: { source: 'hook', since: 1 } }), 'waiting')
  // no verdict, or a value that is not one, is not waiting
  for (const agentWait of [null, undefined, false, 0, '', {}]) {
    assert.equal(staffState({ state: 'working', agentWait }), 'working')
  }
  // Orca's own blocked and done win over a prompt verdict
  assert.equal(staffState({ state: 'blocked', agentWait: { source: 'title' } }), 'blocked')
  assert.equal(staffState({ state: 'done', agentWait: { source: 'title' } }), 'done')
  // a programStatus left over from an earlier run does not put a working agent to sleep
  assert.equal(staffState({ state: 'working', programStatus: { state: 'done' }, activity: { status: 'working' } }), 'working')
  assert.equal(
    staffState({ state: 'working', workingMode: 'monitoring', programStatus: { state: 'done' }, activity: { status: 'monitoring' } }),
    'monitoring'
  )
  // a run that failed shows as stuck, not free
  assert.equal(
    staffState({ state: 'working', workingMode: 'monitoring', programStatus: { state: 'error' }, activity: { status: 'failed' } }),
    'blocked'
  )
})

test('a waiting agent says what the prompt on its terminal asks for', () => {
  const say = (row: Record<string, unknown>) => lineOf(row, 'waiting', [])
  assert.equal(say({ agentWait: { source: 'prompt-text', reason: 'agent-approval-prompt' } }), 'Can I go ahead? I need your OK')
  assert.equal(say({ agentWait: { source: 'prompt-text', reason: 'something-new' } }), 'I need your input')
  assert.equal(say({ agentWait: { source: 'title' }, toolName: 'AskUserQuestion' }), 'I have a question for you')
})

test('a seat is labelled by ticket, issue number, its own name, or the title when its name is generic', () => {
  // a ticket key in the conversation name wins, then one in the workspace name
  assert.equal(labelOf('IT-73625 Mail routing broke', 'main'), 'IT-73625')
  assert.equal(labelOf('Checkout redesign', 'WEB-142 Checkout redesign'), 'WEB-142')
  // a workspace with a name of its own keeps it (the last segment of a branch path)
  assert.equal(labelOf('Fix cart totals', 'tommy/web-151-fix-cart-totals'), 'web-151-fix-cart-totals')
  assert.equal(labelOf('Platform input map M1 cockpit', 'cockpit-input-map-m1'), 'cockpit-input-map-m1')
  // an issue number is next, from either name
  assert.equal(labelOf('Issue #19977: flaky build', 'main'), '#19977')
  assert.equal(labelOf('Flaky build', 'issue-#19977'), '#19977')
  // a generic name gives the title's first word a turn, past leading symbols and trailing punctuation
  assert.equal(labelOf('Assistant name question', 'main'), 'Assistant')
  assert.equal(labelOf('  [WIP] Desk labels: ticket key', 'main'), 'WIP')
  assert.equal(labelOf('- fix: cart totals', 'main'), 'fix')
  assert.equal(labelOf('"Palu" gets bowls', 'main'), 'Palu')
  assert.equal(labelOf('feat/labels', 'main'), 'feat')
  // else the workspace's own name
  assert.equal(labelOf(null, 'main'), 'main')
  assert.equal(labelOf('', 'feature/login form'), 'login')
  // the caller can mark any name generic, for a main checkout or a name desks share
  assert.equal(labelOf('Release notes', 'acme-web', true), 'Release')
  assert.equal(labelOf('Release notes', 'acme-web', false), 'acme-web')
  assert.equal(labelOf('***', 'main'), 'main')
  // never empty
  assert.equal(labelOf('...', '---'), '---')
  assert.equal(labelOf(null, ''), 'workspace')
})

test('staff carry their nameplate label', () => {
  const raw = {
    result: {
      worktrees: [
        {
          worktreeId: 'w1',
          repo: 'infra',
          branch: 'refs/heads/main',
          displayName: 'main',
          agents: [
            { paneKey: 'p1', state: 'working', conversationName: 'SRE-213 Rotate the backup key' },
            { paneKey: 'p2', state: 'working', conversationName: 'Assistant name question' },
            { paneKey: 'p3', state: 'idle' }
          ]
        }
      ]
    }
  }
  const staff = toSnapshot(raw, 1).floors[0].desks[0].staff
  assert.deepEqual(staff.map((s) => s.label), ['SRE-213', 'Assistant', 'main'])
})

// ---- Open in Orca -------------------------------------------------------------------------------

const TERMINALS = {
  result: {
    terminals: [
      { handle: 'term_aaa', tabId: 'tab-1', leafId: 'leaf-1', title: 'one' },
      { handle: 'term_bbb', tabId: 'tab-2', leafId: 'leaf-2', title: 'two' },
      { tabId: 'tab-3', leafId: 'leaf-3', title: 'no handle yet' }
    ]
  }
}
const PS = {
  result: {
    worktrees: [
      { worktreeId: 'repo::/w/one', agents: [{ paneKey: 'tab-1:leaf-1' }] },
      { worktreeId: 'repo::/w/chat', agents: [{ paneKey: 'structured-agent-session-abc:leaf-9' }] },
      { worktreeId: '', agents: [{ paneKey: 'tab-7:leaf-7' }] }
    ]
  }
}

test('finds the terminal handle for a pane key, and nothing for the rest', () => {
  assert.deepEqual(terminalSwitchArgs('tab-2:leaf-2', TERMINALS), ['terminal', 'switch', '--terminal', 'term_bbb'])
  // the whole key, never the tab or the leaf on its own
  assert.equal(terminalSwitchArgs('tab-2', TERMINALS), null)
  assert.equal(terminalSwitchArgs('leaf-2', TERMINALS), null)
  assert.equal(terminalSwitchArgs('tab-3:leaf-3', TERMINALS), null)
  assert.equal(terminalSwitchArgs('tab-1:leaf-1', { result: {} }), null)
  assert.equal(terminalSwitchArgs('tab-1:leaf-1', null), null)
})

test('a Chat UI session is told by its pane key and gets its worktree instead', () => {
  assert.equal(isChatSession('structured-agent-session-abc:leaf-9'), true)
  assert.equal(isChatSession('tab-1:leaf-1'), false)
  assert.deepEqual(worktreeActivateArgs('structured-agent-session-abc:leaf-9', PS), [
    'worktree',
    'activate',
    '--worktree',
    'id:repo::/w/chat'
  ])
  assert.deepEqual(worktreeActivateArgs('tab-1:leaf-1', PS), ['worktree', 'activate', '--worktree', 'id:repo::/w/one'])
  assert.equal(worktreeActivateArgs('tab-7:leaf-7', PS), null)
  assert.equal(worktreeActivateArgs('tab-0:leaf-0', PS), null)
  assert.equal(worktreeActivateArgs('tab-1:leaf-1', undefined), null)
})

test('switchTo runs only the lookup and the one switch, with the CLI injected', async () => {
  const calls: string[][] = []
  const cli = (answers: Record<string, unknown>) => async (args: string[]) => {
    calls.push(args)
    return answers[args.slice(0, 2).join(' ')] ?? { ok: true }
  }
  // a terminal agent: list, then switch to its handle
  assert.deepEqual(await switchTo({ paneKey: 'tab-1:leaf-1' }, cli({ 'terminal list': TERMINALS })), { ok: true, via: 'terminal' })
  assert.deepEqual(calls, [
    ['terminal', 'list', '--json'],
    ['terminal', 'switch', '--terminal', 'term_aaa', '--json']
  ])
  // a Chat UI session: never asks for terminals, reveals the worktree
  calls.length = 0
  assert.deepEqual(
    await switchTo({ paneKey: 'structured-agent-session-abc:leaf-9' }, cli({ 'worktree ps': PS })),
    { ok: true, via: 'worktree' }
  )
  assert.deepEqual(calls, [
    ['worktree', 'ps', '--json'],
    ['worktree', 'activate', '--worktree', 'id:repo::/w/chat', '--json']
  ])
  // a terminal that is gone but an agent still in ps falls back to its worktree
  calls.length = 0
  assert.deepEqual(
    await switchTo({ paneKey: 'tab-1:leaf-1' }, cli({ 'terminal list': { result: { terminals: [] } }, 'worktree ps': PS })),
    { ok: true, via: 'worktree' }
  )
  assert.deepEqual(calls.map((c) => c.slice(0, 2).join(' ')), ['terminal list', 'worktree ps', 'worktree activate'])
  // nothing matches anywhere
  calls.length = 0
  const gone = await switchTo({ paneKey: 'tab-0:leaf-0' }, cli({ 'terminal list': TERMINALS, 'worktree ps': PS }))
  assert.equal(gone.ok, false)
  assert.deepEqual(calls.map((c) => c[1]), ['list', 'ps'])
  // the CLI refusing
  const refused = await switchTo({ paneKey: 'tab-1:leaf-1' }, async (args) =>
    args[1] === 'switch' ? Promise.reject(new Error('terminal_handle_stale')) : TERMINALS
  )
  assert.deepEqual(refused, { ok: false, error: 'terminal_handle_stale' })
})

test('switchTo refuses anything but a pane key without touching the CLI', async () => {
  const calls: string[][] = []
  const spy = async (args: string[]) => {
    calls.push(args)
    return TERMINALS
  }
  for (const bad of [undefined, null, 'tab-1:leaf-1', 42, {}, { paneKey: '' }, { paneKey: '   ' }, { paneKey: 7 }, { paneKey: ['x'] }]) {
    const out = await switchTo(bad, spy)
    assert.equal(out.ok, false, `accepted ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(calls, [])
})

test('only generic workspace names borrow the conversation title', () => {
  const wt = (worktreeId: string, displayName: string, extra: Record<string, unknown> = {}) => ({
    worktreeId,
    repo: 'acme-web',
    displayName,
    defaultBranch: 'refs/heads/trunk',
    ...extra,
    agents: [{ paneKey: `p-${worktreeId}`, state: 'working', conversationName: `Title of ${worktreeId}` }]
  })
  const raw = {
    result: {
      worktrees: [
        wt('a', 'checkout-redesign'),
        wt('b', 'trunk'),
        wt('c', 'acme-web', { isMainWorktree: true }),
        wt('d', 'spike'),
        wt('e', 'Spike')
      ]
    }
  }
  const labels = toSnapshot(raw, 1).floors[0].desks.map((d) => d.staff[0].label)
  // own name kept; the repo's default branch, the main checkout and a shared name take the title
  assert.deepEqual(labels, ['checkout-redesign', 'Title', 'Title', 'Title', 'Title'])
})

// ---- paired Orca servers ------------------------------------------------------------------------
// A local `worktree ps` covers this machine and its SSH targets, and names each paired server it
// leaves out under hostScope.omittedHostIds as runtime:<environment id>. Their rows call
// themselves host=local too, and carry the server's environment id and name.

const LOCAL_PS = {
  ok: true,
  result: {
    worktrees: [{ worktreeId: 'repo::/Users/me/platform', repo: 'platform', displayName: 'TTM-1', agents: [{ paneKey: 'a:1', state: 'working' }] }],
    hostScope: {
      hostIds: ['local'],
      omittedHostIds: ['runtime:aaa', 'runtime:bbb', 'ssh:x'],
      omittedHostSelectors: [
        { hostId: 'runtime:aaa', selector: '--environment lane-poc' },
        { hostId: 'runtime:bbb', selector: '--environment lane-poc' },
        { hostId: 'ssh:x', selector: '--host ssh:x' }
      ]
    }
  }
}
const SERVER_PS = {
  ok: true,
  result: {
    worktrees: [
      {
        worktreeId: 'repo::/home/worker/ttm-2',
        parentWorktreeId: 'repo::/home/worker/main',
        repo: 'platform',
        displayName: 'TTM-2',
        environment: { id: 'aaa', name: 'lane-poc' },
        agents: [{ paneKey: 'b:2', state: 'waiting' }]
      }
    ]
  }
}

test('finds the paired servers a local answer leaves out by id, even when two share a name', () => {
  assert.deepEqual(pairedEnvironments(LOCAL_PS), ['aaa', 'bbb'])
  assert.deepEqual(pairedEnvironments({ result: { hostScope: { omittedHostIds: ['runtime:a%20b', 'runtime:%E0%A4%A', 'runtime:'] } } }), ['a b'])
  assert.deepEqual(pairedEnvironments({ result: { hostScope: { omittedHostIds: [] } } }), [])
  assert.deepEqual(pairedEnvironments(null), [])
})

test('asks every paired server, and a server that fails costs only its own desks', async () => {
  const calls: string[][] = []
  const timeouts: (number | undefined)[] = []
  const failed: string[] = []
  const { local, servers } = await readAllHosts(
    async (args, timeout) => {
      calls.push(args)
      timeouts.push(timeout)
      if (args.includes('bbb')) throw new Error('unreachable')
      return args.includes('aaa') ? SERVER_PS : LOCAL_PS
    },
    (environment) => failed.push(environment)
  )
  assert.equal(local, LOCAL_PS)
  assert.deepEqual(calls, [
    ['worktree', 'ps', '--agent-wait', '--json'],
    ['worktree', 'ps', '--agent-wait', '--json', '--environment', 'aaa'],
    ['worktree', 'ps', '--agent-wait', '--json', '--environment', 'bbb']
  ])
  // this machine keeps the default wait; a server gets a shorter one
  assert.equal(timeouts[0], undefined)
  assert.ok(timeouts[1]! < 8000 && timeouts[2]! < 8000)
  assert.deepEqual(servers, [{ environment: 'aaa', raw: SERVER_PS }])
  assert.deepEqual(failed, ['bbb'])
})

test('agents on a paired server join the team of their project, marked with the server', () => {
  const snap = toSnapshot(LOCAL_PS, 1, [{ environment: 'aaa', raw: SERVER_PS }])
  assert.deepEqual(snap.floors.map((f) => f.repo), ['platform'])
  const [here, there] = snap.floors[0].desks
  assert.equal(here.id, 'repo::/Users/me/platform')
  assert.equal(here.environment, null)
  assert.equal(here.host, null)
  assert.equal(there.id, 'aaa|repo::/home/worker/ttm-2')
  assert.equal(there.parentId, 'aaa|repo::/home/worker/main')
  assert.equal(there.environment, 'aaa')
  assert.equal(there.host, 'lane-poc')
  assert.equal(there.staff[0].id, 'b:2')
  assert.equal(there.staff[0].state, 'waiting')
})

test('switchTo reaches a paired server through its selector, and only one Orca listed', async () => {
  const calls: string[][] = []
  const spy = async (args: string[]) => {
    calls.push(args)
    return args[1] === 'list' ? { result: { terminals: [{ tabId: 'b', leafId: '2', handle: 'term_r' }] } } : { ok: true }
  }
  assert.deepEqual(await switchTo({ paneKey: 'b:2', environment: 'aaa' }, spy, ['aaa']), {
    ok: true,
    via: 'terminal'
  })
  assert.deepEqual(calls, [
    ['terminal', 'list', '--json', '--environment', 'aaa'],
    ['terminal', 'switch', '--terminal', 'term_r', '--json', '--environment', 'aaa']
  ])
  calls.length = 0
  for (const environment of ['lane-poc', 'zzz', '--pairing-code', 7, ['aaa']]) {
    const out = await switchTo({ paneKey: 'b:2', environment }, spy, ['aaa'])
    assert.equal(out.ok, false, `accepted ${JSON.stringify(environment)}`)
  }
  assert.deepEqual(calls, [])
})

test('a busy project brings its sleeping worktrees as empty desks, a quiet project stays away', () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', agents: [{ paneKey: 'p1', state: 'working' }] },
        { worktreeId: 'w2', repo: 'web', displayName: 'WEB-2', agents: [] },
        { worktreeId: 'w3', repo: 'web', displayName: 'WEB-3', isArchived: true, agents: [] },
        { worktreeId: 'w4', repo: 'quiet', displayName: 'Q-1', agents: [] }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors.map((f) => f.repo), ['web'])
  const desks = snap.floors[0].desks
  assert.deepEqual(desks.map((d) => d.id), ['w1', 'w2'])
  assert.equal(desks[1].staff.length, 0)
  assert.equal(desks[1].label, 'WEB-2')
})

test('a sleeping desk sharing a name never changes a busy desk nameplate', () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'w1', repo: 'web', displayName: 'feature', agents: [{ paneKey: 'p1', state: 'working', conversationName: 'Polish the header' }] },
        { worktreeId: 'w2', repo: 'web', displayName: 'feature', agents: [] }
      ]
    }
  }
  const [busy, asleep] = toSnapshot(raw, 1).floors[0].desks
  assert.equal(busy.staff[0].label, 'feature')
  // with no conversation to borrow from, the sleeping one keeps its own name
  assert.equal(asleep.label, 'feature')
})


// ---- bots ----------------------------------------------------------------------------------------

const home = (bot: string, agents: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  workspaceKind: 'folder-workspace',
  worktreeId: `folder:${bot}`,
  repo: 'Bots',
  displayName: bot,
  bot,
  botHome: true,
  agents,
  ...extra
})
const chat = (state: string, extra: Record<string, unknown> = {}) => ({
  paneKey: `structured-agent-session-${state}`,
  state,
  agentType: 'claude',
  conversationName: 'Chief of Stack',
  ...extra
})

test('an Orca without bot fields draws the office it always did', () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', agents: [{ paneKey: 'p1', state: 'working' }] },
        { worktreeId: 'w2', repo: 'web', displayName: 'WEB-2', agents: [] },
        // a bot's folder on a host that does not mark it as a home stays an ordinary team
        { worktreeId: 'folder:x', repo: 'Bots', displayName: 'Chief of Stack', agents: [{ paneKey: 'p2', state: 'done' }] }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.bots, [])
  assert.deepEqual(snap.floors.map((f) => f.repo), ['Bots', 'web'])
  for (const desk of snap.floors.flatMap((f) => f.desks)) {
    assert.equal(desk.bot, null)
    assert.equal(desk.automation, null)
    assert.equal(desk.repo, snap.floors.find((f) => f.desks.includes(desk))!.repo)
  }
})

test('a bot home becomes the bot, off the floors, with its chat as its staff', () => {
  const raw = { result: { worktrees: [home('Chief of Stack', [chat('done', { lastAssistantMessage: 'Filed WEB-160.\nMore' })])] } }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors, [])
  assert.equal(snap.bots.length, 1)
  const [bot] = snap.bots
  assert.equal(bot.id, 'Chief of Stack')
  assert.equal(bot.name, 'Chief of Stack')
  assert.equal(bot.homeId, 'folder:Chief of Stack')
  assert.equal(bot.environment, null)
  assert.equal(bot.staff[0].id, 'structured-agent-session-done')
  assert.equal(bot.state, 'done')
  assert.equal(bot.said, 'Filed WEB-160.')
  assert.equal(bot.line, 'Filed WEB-160.')
  assert.deepEqual(bot.desks, [])
})

test("a bot's desks leave their project for the bot, sleeping ones too, and keep their project", () => {
  const raw = {
    result: {
      worktrees: [
        home('Chief of Stack', [chat('idle')]),
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-160', bot: 'Chief of Stack', agents: [{ paneKey: 'p1', state: 'working' }] },
        { worktreeId: 'w2', repo: 'docs', displayName: 'DOC-12', bot: 'Chief of Stack', agents: [] },
        { worktreeId: 'w3', repo: 'docs', displayName: 'DOC-14', bot: 'Chief of Stack', isArchived: true, agents: [] },
        { worktreeId: 'w4', repo: 'web', displayName: 'WEB-171', agents: [{ paneKey: 'p4', state: 'working' }] },
        // only a bot's desk is busy in api: the api team stays off the floor
        { worktreeId: 'w5', repo: 'api', displayName: 'API-1', bot: 'Chief of Stack', agents: [{ paneKey: 'p5', state: 'waiting' }] },
        { worktreeId: 'w6', repo: 'api', displayName: 'API-2', agents: [] }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors.map((f) => [f.repo, f.desks.map((d) => d.id)]), [['web', ['w4']]])
  const [bot] = snap.bots
  assert.deepEqual(bot.desks.map((d) => [d.id, d.repo, d.bot]), [
    ['w1', 'web', 'Chief of Stack'],
    ['w2', 'docs', 'Chief of Stack'],
    ['w5', 'api', 'Chief of Stack']
  ])
  assert.equal(bot.desks[1].staff.length, 0)
  assert.equal(bot.desks[1].label, 'DOC-12')
  // its own chat is quiet and two of its desks are busy: it keeps an eye on them
  assert.equal(bot.state, 'watching')
  assert.equal(bot.line, "I'm keeping an eye on 2 desks")
})

test('a bot shows its most urgent chat, and keeps an eye on a single busy desk by its nameplate', () => {
  const desk = (state: string) => ({ label: 'WEB-151', staff: [{ state, label: 'WEB-151' }] }) as any
  const staff = (state: string, line = state) => ({ state, line, said: null, task: null, since: 0 }) as any
  assert.equal(botLook({ staff: [staff('done'), staff('waiting'), staff('working')], desks: [] }).state, 'waiting')
  assert.equal(botLook({ staff: [staff('idle')], desks: [desk('working')] }).line, "I'm keeping an eye on WEB-151")
  assert.equal(botLook({ staff: [staff('idle')], desks: [desk('done')] }).state, 'idle')
  assert.equal(botLook({ staff: [staff('working', "I'm reading a ticket")], desks: [desk('blocked')] }).line, "I'm reading a ticket")
  const asleep = botLook({ staff: [], desks: [desk('working')] })
  assert.equal(asleep.state, 'asleep')
  assert.equal(asleep.line, "I'm resting until someone asks for me")
})

test('a desk naming a bot with no home in the rows gets a bot of its own, asleep', () => {
  const raw = {
    result: { worktrees: [{ worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', bot: 'Triage', agents: [{ paneKey: 'p1', state: 'working' }] }] }
  }
  const [bot] = toSnapshot(raw, 1).bots
  assert.equal(bot.id, 'Triage')
  assert.equal(bot.homeId, null)
  assert.deepEqual(bot.staff, [])
  assert.equal(bot.state, 'asleep')
  assert.deepEqual(bot.desks.map((d) => d.id), ['w1'])
})

test('bots on paired servers keep apart by server, and a desk finds its bot there first', () => {
  const local = {
    result: {
      worktrees: [
        home('Chief of Stack', [chat('working')]),
        home('Release notes', []),
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', bot: 'Chief of Stack', agents: [{ paneKey: 'p1', state: 'working' }] }
      ]
    }
  }
  const server = (worktrees: unknown[]) => ({ result: { worktrees } })
  const snap = toSnapshot(local, 1, [
    {
      environment: 'aaa',
      raw: server([
        home('Chief of Stack', [chat('waiting')], { environment: { id: 'aaa', name: 'lane-poc' } }),
        { worktreeId: 'w2', repo: 'web', displayName: 'WEB-2', bot: 'Chief of Stack', agents: [{ paneKey: 'p2', state: 'working' }] }
      ])
    },
    {
      environment: 'bbb',
      raw: server([
        // no home here: the only Release notes anywhere runs it
        { worktreeId: 'w3', repo: 'docs', displayName: 'DOC-1', bot: 'Release notes', agents: [{ paneKey: 'p3', state: 'working' }] },
        // two Chiefs of Stack elsewhere and none here: one of its own, asleep
        { worktreeId: 'w4', repo: 'docs', displayName: 'DOC-2', bot: 'Chief of Stack', agents: [{ paneKey: 'p4', state: 'working' }] }
      ])
    }
  ])
  const byId = new Map(snap.bots.map((b) => [b.id, b]))
  assert.deepEqual([...byId.keys()], ['aaa|Chief of Stack', 'bbb|Chief of Stack', 'Chief of Stack', 'Release notes'])
  assert.deepEqual(byId.get('Chief of Stack')!.desks.map((d) => d.id), ['w1'])
  const remote = byId.get('aaa|Chief of Stack')!
  assert.equal(remote.environment, 'aaa')
  assert.equal(remote.host, 'lane-poc')
  assert.equal(remote.homeId, 'aaa|folder:Chief of Stack')
  assert.equal(remote.state, 'waiting')
  assert.deepEqual(remote.desks.map((d) => [d.id, d.bot]), [['aaa|w2', 'aaa|Chief of Stack']])
  assert.deepEqual(byId.get('Release notes')!.desks.map((d) => d.id), ['bbb|w3'])
  const stub = byId.get('bbb|Chief of Stack')!
  assert.equal(stub.homeId, null)
  assert.equal(stub.state, 'asleep')
  assert.deepEqual(stub.desks.map((d) => d.id), ['bbb|w4'])
})

test('a desk an automation made says so, with the automation name when Orca sends it', () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', automationCreated: true, automationName: 'Nightly deps', agents: [{ paneKey: 'p1', state: 'working' }] },
        { worktreeId: 'w2', repo: 'web', displayName: 'WEB-2', automationCreated: true, agents: [] }
      ]
    }
  }
  const [a, b] = toSnapshot(raw, 1).floors[0].desks
  assert.deepEqual(a.automation, { name: 'Nightly deps' })
  assert.deepEqual(b.automation, { name: null })
})

test('a bot chat session has no CLI way to the front, so the worker never claims one', async () => {
  // Orca cannot activate a folder workspace from the CLI, so the panel hides Open in Orca for bots
  const raw = { result: { worktrees: [home('Chief of Stack', [chat('done')])] } }
  const [bot] = toSnapshot(raw, 1).bots
  assert.ok(isChatSession(bot.staff[0].id))
})


test("a bot's desks never change the nameplates of their project's team", () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'w1', repo: 'web', displayName: 'feature', agents: [{ paneKey: 'p1', state: 'working', conversationName: 'Polish the header' }] },
        { worktreeId: 'w2', repo: 'web', displayName: 'feature', bot: 'Triage', agents: [{ paneKey: 'p2', state: 'working', conversationName: 'Sort the inbox' }] }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  // alone in its team, the desk keeps its own name, as it did before bots
  assert.equal(snap.floors[0].desks[0].staff[0].label, 'feature')
  assert.equal(snap.bots[0].desks[0].staff[0].label, 'feature')
})

test('a bot home that does not say which bot it is stays off the floor', () => {
  const raw = {
    result: {
      worktrees: [
        { worktreeId: 'folder:x', repo: 'Bots', displayName: 'Mystery', botHome: true, agents: [{ paneKey: 'p', state: 'working' }] },
        { worktreeId: 'w1', repo: 'web', displayName: 'WEB-1', agents: [{ paneKey: 'p1', state: 'working' }] }
      ]
    }
  }
  const snap = toSnapshot(raw, 1)
  assert.deepEqual(snap.floors.map((f) => f.repo), ['web'])
  assert.deepEqual(snap.bots, [])
})

test('keeping an eye on one desk names the agent there that is busy', () => {
  const desk = { label: 'WEB-151', staff: [{ state: 'done', label: 'first' }, { state: 'working', label: 'second' }] } as any
  const staff = { state: 'idle', line: '', said: null, task: null, since: 0 } as any
  assert.equal(botLook({ staff: [staff], desks: [desk] }).line, "I'm keeping an eye on second")
})

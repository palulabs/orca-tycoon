# Office Tycoon for Orca

Your coding agents, as tiny pixel staff in an office you can watch.

![The Office Tycoon office in the Loft: five teams at islands of desks behind navy curtains, an agent that just finished saying so in a speech bubble, and the hangout along the bottom with phone booths, a coffee counter, a sofa on a pink rug, foosball and Palú asleep in his bed](docs/office.png)

Office Tycoon is a plugin for [Orca](https://github.com/stablyai/orca), the desktop app for running
many coding agents in parallel git worktrees. It draws every agent on your machine, its SSH targets and the
Orca servers you paired, such as a cloud VM, as a little worker in an office, in the style of tycoon and office-sim games. You get a glance at who is busy,
who needs you and who is done, without having to click through every workspace.

## Install

Requires Orca 1.4.246 or newer.

In Orca, open Settings, then Plugins, and install Office Tycoon for Orca (`palulabs.office-tycoon`) from the
plugin directory. To run it from a clone instead:

```sh
git clone https://github.com/palulabs/orca-tycoon.git
cd orca-tycoon
orca plugin dev load .        # prints an approval; re-run with the --approve flag it shows
orca plugin open local.office-tycoon --panel office
```

The worker looks for the Orca CLI beside the running Orca on Windows (`resources\bin\orca.exe`), at
`/Applications/Orca.app/Contents/Resources/bin/orca` and `~/Applications/...` on macOS, then `orca`
on your `PATH`.

## Who works here

- **Projects are teams.** Each repository gets its own open area on the office floor. A big
  team spreads across the full width; small ones share the floor in two columns.
- **Agents get desks.** Every agent has a seat with a monitor facing you. A worktree's child
  worktrees sit right next to it, so a stack of branches reads as one row of desks. The nameplate
  under a desk is the ticket key or issue number in the agent's conversation or workspace name,
  else the workspace name. Only when that name is generic, like `main` or a name several desks
  share, does the first word of the conversation title take its place, so four desks on `main`
  still tell apart.
- **Subagents are specialists.** Every desk has a stool at its end, the second seat. When an
  agent calls in a subagent, a specialist walks in through the front door in the side wall, sits on that stool
  leaning in toward the screen, and leaves the same way when the job is done. A desk grows up to
  three stools and shows a `+` on the last one beyond that. The badge on a specialist's shirt is coloured by role,
  the same across the whole office.
- **Idle agents take a break.** A band across the middle of the floor holds the commons: a lounge
  with a sofa, the coffee corner and kitchen, a foosball table and calling booths. Agents that are
  done, idle, or waiting on background tasks walk over and pick something to do. Every minute
  each one draws a new activity on a rhythm of its own, so they never all move at once: a nap on
  the sofa (done and idle agents only), a coffee or a book on the sofa, a mug at the coffee corner,
  a game of foosball (always two players, one on each long side), or a call in a booth. When a
  place is full they take their next choice, and when everything is full they stay at their desk.
  When an agent gets new work, it flashes out of the hangout and teleports back to its desk.
- **Palú is the office dog.** A white, fluffy, long and low bichon with a little stub of a tail
  and a red collar. He wanders the floor, sniffs the plants, the bookshelves and the corners of
  the furniture, visits his food and water bowls, naps in his bed in the commons, and now and
  then lies down in front of someone's desk for a nap, more often beside someone who is dozing
  too. Click him while he rests and he gets up and goes on to whatever he does next. He is only
  there for company and never changes what anyone does.
- **Agents speak up.** When an agent finishes, a speech bubble shows the first line of its last
  reply. When one starts waiting for you an amber `?` bobs over its head and a thought bubble says
  "Need you!"; click it and it says what the prompt asks, such as "Can I go ahead? I need your OK".
  When it gets stuck it says "Stuck!".
- **Bots have rooms of their own.** An Orca bot, the assistant people ask from Slack, Linear or
  GitHub, comes in as its mascot: a round little sea creature with a headset, in a colour no other
  bot on the floor has. Every desk a bot runs leaves its project's team and sits at the bot's own
  island, in a room named after the bot. A bot runs whatever sits under it in Orca's sidebar: the
  workspaces it made, their children and theirs, and a workspace nested under it from a paired
  Orca server too. Bot rooms come first on the floor. Each desk keeps its
  ticket nameplate and gets a small tag under it for the project it works in. When two projects
  in one room share a name, such as three `website`s, the tag adds the folder they live in:
  `acme/website`. The bot sits at
  the head of its island like the head of the table: in its chair at the island's end, behind a
  desk of its own turned toward its staff, its terminal facing it.
  A bot comes in while its own chat is open in Orca or one of its desks has an agent at work. A
  bot with no desks on the floor sits at a little desk of its own in the middle of its room, its terminal
  facing you.
- **One bot can be the coordinator.** Pick it with the Coordinator control in the header; the
  panel remembers it. In the loft the coordinator gets a room of its own at the right end of the
  hangout, closed off from the lounge by a curtain, with a big desk, the floor map on a stand, two
  stools for visitors and two plants; its only way in is a gap in the back curtain, onto the office
  floor. In Brick its room stands beside the commons, on a navy rug with its sign, the floor map
  on its whiteboard, a plant and a bookshelf, and its only way in is the door in its top edge,
  onto the hallway. While it works, or keeps an eye on its desks, it walks a round: out through
  its way in, to each desk that needs you and to the head of every other bot's island, saying what
  it is checking ("How is WEB-160 doing?", "Checking on Release notes"), then back to its desk,
  where it rests a little before the next round. When it waits
  for you, it waits at its way in with an amber `?`. Its own desks still form an island in a room
  named after it, with nobody at the head. When nothing goes on it stays, asleep at its desk.

![Bots in the Loft: Chief of Stack, the coordinator, stops at a desk on its round to ask how DAT-11 is doing, Release notes and Triage sit at desks of their own at the heads of their islands, and the coordinator's room with its floor map stands at the right end of the hangout](docs/bots.png)

A status line along the top counts teams, bots, staff, busy agents and how many need you. A bot
that waits for you counts among those who need you.

## Two layouts, two appearances

The Layout control picks the floor plan and the panel remembers it. The separate Appearance
control toggles Dark for any layout. The office opens in the Loft with Dark off. The ⏱ button sets
how long an agent that just finished stays at its desk before its break. Hide sleeping, as in
Orca's sidebar filter, leaves out the desks with no agent, such as a bot's `main` checkouts, and
the rooms close up; it is off at first and the panel remembers it. Brick only ever seats agents
at work, so the button shows in the Loft.

- **Loft** shows the office from the front and above, like a doll's house with its front wall
  taken off. It is set up like a real office in an old concrete hall: a double-height window onto
  the street, one-row workstation bays, and a fixed-height hangout docked at the bottom.
- **Brick** is the flat office seen from straight above, as in the screenshot below and the
  pictures further down.
- **Dark** is an appearance attribute rather than a layout. It adds the low-light, low-saturation
  treatment to Brick or Loft while keeping status colors readable. Use the compact moon/sun button
  beside the layout switch.

![Brick: five teams at their desks on rugs, specialists on stools beside their agents, and a commons band in the middle with the lounge, coffee corner, foosball table, calling booths and Palú asleep in his bed](docs/brick.png)

In the loft, every worktree of a project owns a desk, also while it sleeps: then its chair stays
empty and its nameplate is dimmed. A project shows up as soon as one of its worktrees has a live
agent. Desks stand in islands of six that stay put while seats empty and fill; a project with three
worktrees or fewer gets half an island, one row of three, and two such projects share a room, each
island under its project's name. The front row sits with their backs to you, their screens facing you
and the nameplate on the back of the chair. The back row faces you over their monitors, the nameplate
on the back of the monitor below a status light. A desk keeps its place until its worktree goes,
nobody moves up, and a new worktree takes the first free desk, beside its parent when that one is
free. Specialists sit on an orange stool right beside their agent, two at most, with a `+` for more.
The loft's hangout adds one thing to do on a break: a chat at the round white table, two or more
round it taking turns to talk, never one alone.

## Christmas

From 15 November through 1 January a 🎄 button sits beside the switch, and the office dresses up in
both looks: agents come in as Santa, an elf, a reindeer or the Grinch, Palú wears a Santa cap and a
red nose, a big tree with presents stands in the commons or the hangout, the plants become little pines, and
fairy lights and snow go up by the windows. In the loft a few desks and drawer blocks get a present
too. It is on by default; press the button to turn it off, and the panel remembers. The rest of the
year the button is gone and the office is plain.

## Reading the monitors

![One desk per state on a narrow panel: a red flashing exclamation mark, an amber question mark and typing at their desks, while the done agent naps on the sofa and the monitoring one takes a call in a booth](docs/states.png)

| Agent state | What you see |
| --- | --- |
| working | typing, code scrolling on screen |
| watching background tasks | on a break in the commons, never napping |
| waiting for you | amber `?` on screen and over their head |
| blocked | red flashing screen with `!` |
| done | on a break in the commons, often napping; dozing at the desk with a `z` when the commons are full |

Hover over a desk, a person or Palú for a card with who it is, where they sit and what they are
doing; it follows them if they walk off. Click anyone, at their desk or on a break, and they tell you in one line what they are doing:
"I'm editing panel.js", "I'm watching CI run", "I'm waiting on the reviewer". The line comes from
the tool and input Orca already reports, so no model is asked. A specialist tells you the job it
was called in for. The side panel shows the worktree, state, task, current tool and specialists,
and its Open in Orca button brings the agent's terminal tab to the front. A Chat UI session has no
terminal tab, so for one the button shows its worktree instead, as clicking it in the sidebar does.
Clicking a person or a desk never moves Orca's focus; only the button does. An agent on a paired
Orca server sits with the team of its project at a thin client: a pale terminal with a slim box
beside it whose light blinks while it works. The side panel names the server it runs on.
If a server cannot be reached, only its desks go missing until it answers again.

Bots use the same marks as everyone else, and one of their own:

| Bot state | What you see |
| --- | --- |
| working | bobbing at its post, the light on its mic blinking green |
| keeping an eye | its own chat is quiet but a desk it runs is busy: it looks from side to side and says "I'm keeping an eye on 3 desks" |
| waiting for you | amber `?` over its head |
| blocked | fins up and a red `!` |
| done | smiling eyes, and a bubble with the first line of its last reply |
| asleep | no chat open: eyes shut, dimmed, with a `z` |

Hover over a bot for who it is and what it does, and click it for the side panel: Bot or
Coordinator, the server it runs on, its state and task, and the desks it runs with their state. A
desk a bot runs says "Run by" that bot on its card, and one an automation made says which
automation made it. Orca cannot bring a bot's home folder to the front from its command line yet,
so a bot has no Open in Orca button; open it from Orca's sidebar. A bot on a paired Orca server is
told apart from one of the same name here, and a desk that names a bot whose home Orca does not
list gets a bot of its own, asleep, so every bot desk has someone at its head.

![An agent finishes with a speech bubble, walks down to the commons and takes a call in a booth, then walks back to its desk when new work arrives](docs/break.gif)

![Two specialists come in through the front door one after the other and take the stools at a desk, while another finishes and walks out](docs/specialists.gif)

## How it works

Orca's plugin API (`agents.list`) only lists the agents of the focused workspace, and it has no
subagents. To see the whole office, the worker (`src/worker.ts`) runs `orca worktree ps --json`
instead. Orca's own sidebar and phone app draw from the same rows. The worker trims them to a small
office model (`src/protocol.ts`): projects, seats, and each seat's specialists. Orca marks a
bot's home folder and every workspace a bot runs in those same rows, so the worker gives each bot
its desks; an Orca that does not send those marks draws the office it always did.

The panel (`src/panel.html`, `src/panel.js`, `src/sprites.js`, and `src/loft.js` for the loft) polls the worker every 3 seconds,
the same rate Orca's phone app uses, and draws one canvas at 8 frames a second. Every sprite is
drawn in code, so the plugin loads no assets and makes no network requests. The office fills the
panel: it is drawn at the biggest whole pixel scale at which the whole building fits, and the
corridors between rooms widen so the bottom wall reaches the panel's bottom edge. Only an office
too crowded to fit at the smallest scale scrolls, and then each frame paints only what is on screen.
People find their way round the furniture with `src/walking.js`, which spreads the search over
frames, so a big office where many people get up at once never holds up the panel.

### Permissions

Because the worker runs the Orca CLI, the plugin needs the `trusted-worker` execution profile. It
asks for no other capabilities.

## Develop

```sh
orca plugin validate .
orca plugin test .            # ps rows to the office model, and the loft's seats and floor plan
orca plugin dev reload .      # after editing; the panel redraws
orca plugin shot local.office-tycoon --panel office --out shot.png
```

At the top of `src/panel.js`, `AWAY_STATES` and `LOUNGE_STATES` decide which states send an agent
on a break, and `ACTIVITIES` lists what they can do there, with a weight for how often each comes
up. Add `waiting` to `AWAY_STATES` if you'd like agents that wait for you to take a break too.

The screenshots in `docs/` show a made-up office, rendered from the real panel code.

## License

[MIT](LICENSE)

Office Tycoon for Orca is a community plugin and is not affiliated with Orca or Stably.

Palú, the office dog, is named after the bichon who gave Palu Labs its name. In loving memory,
2003 to 2018.

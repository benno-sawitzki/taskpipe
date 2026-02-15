# taskpipe

Marketing task engine for the terminal. Not a generic todo app — it understands marketing context, connects to other tools, and actively manages your energy and attention.

## Install

```bash
npm install -g taskpipe
# or
git clone https://github.com/bennosan/taskpipe && cd taskpipe && npm install && npm run build && npm link
```

## Quick Start

```bash
taskpipe init
taskpipe add "Write case study for SalesRook" --due friday --energy high --estimate 45 --campaign q1-content --stake "€1,500 client deliverable"
taskpipe add "Follow up with Henrik" --energy low --estimate 10 --priority critical --due today
taskpipe add "Design landing page" --energy high --estimate 90 --campaign agent-smith
taskpipe now          # THE one thing to do next
```

## Commands

### The Essentials

| Command | What it does |
|---------|-------------|
| `taskpipe now` | The ONE thing to do right now |
| `taskpipe quick` | Tasks under 15 min (quick wins) |
| `taskpipe stuck` | Tasks you've been avoiding |
| `taskpipe wins` | What you crushed today |
| `taskpipe plan --2h` | "I have 2 hours" — auto-plans |
| `taskpipe stakes` | Everything with money on the line |

### Task Management

```bash
taskpipe add "task" --due tomorrow --energy high --estimate 30 --campaign q1 --tags "content,client" --stake "€500"
taskpipe list                    # all open tasks
taskpipe list --today            # due today/overdue
taskpipe list --campaign q1      # filter by campaign
taskpipe list --energy low       # match your energy
taskpipe done <id> --time 45 --difficulty hard
taskpipe block <id> "waiting on client"
taskpipe delegate <id> --to agent
```

### Focus Mode

```bash
taskpipe focus "agent smith"     # only show matching tasks
taskpipe unfocus                 # back to everything
```

### Momentum

```bash
taskpipe streak                  # your completion streak
taskpipe momentum                # flow state check
taskpipe cooldown                # should you take a break?
taskpipe insights                # learned patterns from your data
taskpipe review                  # weekly review summary
```

### Reminders

```bash
taskpipe remind <id> "in 2h"              # remind in 2 hours
taskpipe remind <id> "tomorrow 9am"       # remind tomorrow at 9
taskpipe remind <id> "2026-02-15 15:00"   # specific datetime
taskpipe remind <id> "tonight"            # 20:00 today
taskpipe remind <id> --remove             # clear all reminders
taskpipe reminders                        # list all upcoming reminders
taskpipe reminders --due                  # reminders that have fired
```

Supported time formats: `in 30m`, `in 2h`, `in 1d`, `in 1w`, `tomorrow`, `tomorrow 9am`, `tonight`, `monday`, `tuesday 10am`, ISO datetime.

### Calendar Integration

Requires `gog` CLI with Google Calendar access.

```bash
taskpipe calendar                # today's events + free slots
taskpipe calendar --tomorrow     # tomorrow's events
taskpipe calendar --week         # this week overview
taskpipe briefing                # smart daily briefing (calendar + tasks + reminders)
```

### Enhanced Planning

```bash
taskpipe plan --calendar         # plan around your calendar free slots
taskpipe plan --morning          # plan just the morning (until 12:00)
taskpipe plan --afternoon        # plan afternoon (12:00-18:00)
taskpipe plan --calendar --morning  # combine: morning free slots only
```

### Setup & Notifications

```bash
taskpipe setup                   # interactive setup wizard
taskpipe setup --status          # show current config
taskpipe setup --reset           # reset to defaults, remove cron jobs
taskpipe briefing | taskpipe notify  # send briefing via configured channel
echo "Reminder!" | taskpipe notify --title "Hey"  # custom notification
```

The setup wizard configures:
- **Notification channel** — terminal, Slack, Discord, email, webhook, or none
- **Check-in schedule** — morning briefing, midday pulse, afternoon nudge, evening wrap
- **Smart nudges** — streak protection, stale task alerts, quick win suggestions, cooldown alerts
- **Work schedule** — days, hours, timezone
- **Integration detection** — auto-detects contentq and leadpipe

Config is saved to `.taskpipe/config.yaml`. Optionally installs cron jobs for automated check-ins.

### Activity Tracking & Adaptive Timing

Taskpipe learns when you're active and suggests optimal check-in times.

```bash
taskpipe activity status         # show activity profile + suggested schedule
taskpipe activity log --source whatsapp --type message   # log external activity
taskpipe activity log --source agent --type checkin --at "2026-02-15T06:00:00"
taskpipe activity apply          # apply learned schedule to config
taskpipe activity reset          # clear all activity data
```

Every command you run automatically logs activity. Over time, taskpipe builds a profile of when you're active (weekday vs weekend) and suggests adjusted check-in times. The setup wizard includes an adaptive timing option.

### Ghost Tasks

Auto-suggested tasks from your other tools (leadpipe, contentq):

```bash
taskpipe ghost                   # see suggestions
taskpipe ghost --accept <id>     # add to real tasks
taskpipe ghost --dismiss <id>    # nah
```

## Agent-Friendly

Every command supports `--json` for structured output:

```bash
taskpipe now --json | jq '.content'
taskpipe list --json | jq '.[].id'
```

## Philosophy

- **One thing at a time.** `taskpipe now` picks THE task. Not a list. One task.
- **Energy-aware.** Morning = high energy tasks. Evening = easy wins.
- **Stakes matter.** Money on the line? It floats to the top.
- **Learn from you.** Track actual times, see where your estimates lie.
- **Marketing-native.** Campaigns, leads, content pipelines — not generic categories.

## The Unix of Marketing

taskpipe is one tool in the marketing terminal toolkit:
- **leadpipe** — lead tracking
- **contentq** — content queue
- **taskpipe** — task engine (this one)

They talk to each other through ghost tasks.

---

MIT License

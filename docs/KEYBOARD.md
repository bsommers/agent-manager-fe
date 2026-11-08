# Keyboard Shortcuts

Every binding in the app, in one place. The same list is available in the app: press `Ctrl+/` (or choose **Show keyboard shortcuts** in the command palette). Both are generated from a single registry (`src/keyboard/shortcuts.ts`), and a test checks that this document lists every row.

**macOS:** wherever this page says `Ctrl`, use `Cmd` on a Mac (the registry token `Mod`).

## Global

These chords work from anywhere in the app, **including while a terminal has focus**. Held-down keys (auto-repeat) and chords with Alt held are ignored.

| Keys | Action |
| --- | --- |
| Ctrl+K | Open or close the command palette |
| Ctrl+Shift+F | Open or close global output search |
| Ctrl+/ | Show or hide this list of keyboard shortcuts |

## Command palette

Press `Ctrl+K`, type to filter, then choose. The palette reaches:

- **Go to `<agent name>`**: activates the agent, raises its pane (even when it is hidden behind others) and moves keyboard focus into its terminal.
- **Layout: Grid / Focus / Cascade**: exactly what the toolbar buttons do.
- **Broadcast to agents**: opens the broadcast bar and focuses its command field. Sending still goes through the bar and its destructive-command confirmation.
- **Search agent output** opens global search; **Filter agents** focuses the toolbar filter.
- **New agent** opens the add-agent dialog; **Show keyboard shortcuts** opens the help list.

The palette contains no destructive command: nothing in it kills or closes an agent, sends terminal input or sends a broadcast. It shows at most 50 commands at a time; keep typing to narrow the list.

| Keys | Action |
| --- | --- |
| Up/Down | Up and Down choose a command |
| Enter | Enter runs the chosen command |

## Dialogs

| Keys | Action |
| --- | --- |
| Esc | Esc closes the open dialog and returns focus to where it was |
| Tab | Tab and Shift+Tab move between a dialog’s controls without leaving it |

## Terminal

| Keys | Action |
| --- | --- |
| Tab | Tab, Esc and Ctrl+C go to the program in the terminal; the palette chord leaves it |

**Caveat:** `Ctrl+K`, `Ctrl+Shift+F` and `Ctrl+/` are taken by the app and no longer reach programs running in the terminal (for example, readline’s `Ctrl+K` kill-to-end-of-line). Every other key, including `Tab`, `Esc` and `Ctrl+C`, still goes to the program.

**Leaving a terminal by keyboard:** press `Ctrl+K`, then choose **Filter agents** (focus the toolbar) or **Go to `<agent name>`** (focus another terminal). `Esc` closes the palette and returns you to the terminal you left.

## Panes

Pane keys are implemented by the pane chrome and documented here so the list is complete. The values must stay in step with the pane code: 10 px per Arrow press, 50 px with Shift.

| Keys | Action |
| --- | --- |
| Arrow | With the title bar (`Move pane <name>`) focused, Arrow keys move the pane 10 px |
| Shift+Arrow | With the title bar (`Move pane <name>`) focused, Shift+Arrow keys move the pane 50 px |
| Arrow | With the resize handle (`Resize pane <name>`) focused, Right and Down grow the pane and Left and Up shrink it by 10 px |
| Shift+Arrow | With the resize handle (`Resize pane <name>`) focused, Shift+Arrow keys resize the pane by 50 px |

`<name>` is the agent’s name: the title bar’s accessible name is `Move pane <agent name>` and the resize handle’s is `Resize pane <agent name>`. Use **Go to `<agent name>`** in the command palette to raise a pane that is hidden behind others.

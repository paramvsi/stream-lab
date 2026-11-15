# Design system

Source: the "Stream Lab" design system artifact (https://claude.ai/artifact/XsFEmm7ktnXLYf9PcgJJ7m) and `seed/tokens.json` / `seed/tokens.css` (use these; do not hand-copy hex values).

## Brand
- Name: **Stream Lab**, wordmark lowercase `stream` (ink) + `lab` (rose-600), Outfit 600.
- Mark: **Serpentine S**: rounded square (rx 9/32) in rose-500, white stroke S (2.6/32) ending in an event dot. `seed/logo-mark.svg`. Mono version: ink square. Min size 16 px; clear space = 1/4 mark.
- Boards: B01 (concepts), B02 (system and rules), B03 (node library).

## Colour
| Token | Hex | Use |
|---|---|---|
| surface | #FFFFFF | page, cards |
| subtle | #FAF7F7 | page sections, table header, hover |
| ink | #1F1416 | text, dark toast |
| muted | #6B5A5D | secondary text (AA on white) |
| line | #EDE5E6 | borders, dividers |
| line-strong | #9C8C90 | input borders, disabled text |
| rose-50/100 | #FDF1F3 / #F9DCE2 | selected bg, focus halo |
| rose-500 | #E6526F | brand fills, illustrations, **never text on white or white on it** |
| rose-600 | #CC3D5C | primary buttons (white text 4.78:1), focus ring, links |
| rose-700 | #A92F4B | text on rose-50 |
| orange-50/500/700 | #FEF3E8 / #F2994A / #A8540F | warnings, late events |
| success-50/600 | #EAF5EF / #1E7F4F | ok |
| danger-50/600 | #FDEDEB / #B42318 | errors |
| node categories | see tokens | Sources #7B3FA0, Transform #0F766E, Enrich #8A5A44, Time & state #CC3D5C, Quality #B45309, Outputs #3B2A2E |

No blue/gray chrome. Background pattern: grid with rose nodes at intersections, 40 px, masked radial fade, landing/welcome only.

## Type
Outfit (UI) and JetBrains Mono (code, ids, numbers in tables). Scale: 12 / 13 / 14 (body) / 16 / 19 / 24 / 36 / 56 (hero). Weights 400/500/600/700. Numbers in tables: mono, tabular.

## Shape and elevation
Radius 6 (chips) / 8 (buttons, inputs) / 12 (cards, panels) / 16 (dialogs). Shadow `card` for raised cards, `pop` for menus, dialogs, toasts. Focus: 2 px rose-600 ring + 2 px white offset.

## Components (packages/ui)
Button (primary/secondary/ghost/danger; sm/md/lg; loading; disabled-with-reason), IconButton, Field (text, number, select, combobox, textarea, file, with help/error), Toggle, Segmented, Tabs (with counts), Badge (tones), Chip, Kbd, Card, Metric, Sparkline, LineChart (uPlot), Table (dense, mono cols, sticky header, selection), Skeleton, EmptyState, Banner, Toast, Progress, CodeBlock, Timeline, Dialog, Drawer (right, bottom), Popover, Menu, Tooltip, CommandPalette, NodeCard, StatusBadge, ProblemsPanel, Spotlight, CoachMark.
Each component has a Storybook story per state shown on any board.

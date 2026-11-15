# Motion

Boards: WM00–WM07 (web), DM00–DM05 (desktop). Global CSS: bottom of `seed/tokens.css`.

Principles: motion explains state change (where something came from, what is flowing); never decorative loops except running pipelines; calm, short, one ease.

| Token | Value |
|---|---|
| ease | cubic-bezier(.2, 0, 0, 1) |
| fast | 150 ms (hover, press, toggles) |
| base | 260 ms (dialogs, menus, toasts) |
| slow | 420 ms (page entrance, drawers 300–320 ms) |
| stagger | 50 ms per item, max 5 items (then all at 250 ms) |

| Pattern | Spec |
|---|---|
| Page entrance | children of `main` fade + rise 8 px, staggered (`sl-in`) |
| Dialog | scrim fade 200 ms; panel scale .96→1 + fade 260 ms, 80 ms delay (`sl-pop`) |
| Right drawer / bottom drawer | slide 300 / 320 ms (`sl-left`, `sl-up`) |
| Toast | rise 16 px + fade 300 ms (`sl-rise`); exit fade 150 ms |
| Running edge | dashed stroke offset loop .8 s linear (`sl-flow`) |
| Busy node | rose glow pulse 1.8 s (`sl-glow`) — never a spinner on nodes |
| Live dot / reconnecting | opacity blink 1.2 s (`sl-blink`) |
| Event travelling | dot along edge path 2.4 s (`sl-travel`, use `offset-path` in code) |
| Tour spotlight | cutout scale 1.06→1 + fade 360 ms (`sl-spot`); moves between targets 300 ms |
| Window fire | window bracket flashes rose-100 → transparent 600 ms; output row slides in |
| Late event | event dot turns orange and drops to the late port 500 ms |
| Counters | tick numbers without animation; charts append without easing |
| Landing hero | loop of the fintech pipeline, pauses when off-screen (IntersectionObserver) |

`prefers-reduced-motion: reduce` → all animations and transitions off; running edges become solid with a static "running" badge; landing hero shows a still frame.

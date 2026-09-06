# Rules

Stages 9, 10 and 11. What holds for every component, so a screen composes
rather than decides.

## Grouping

Proximity, then common region, then similarity, in that order of strength. When
two of them disagree, the object model in `objects.md` breaks the tie.

In practice, for this product: **space groups, hairlines separate, and a filled
region is reserved for a thing you can act on.** A run's rows are grouped by
gap and divided by a single hairline. They are not in cards. At the density this
product runs at, a card around every row is six borders and a shadow doing the
work that one gap already did.

## Emphasis spends one channel

One preattentive channel per distinction, because the channels are scarce and a
second competing for the same attention cancels the first.

| Distinction | Channel |
| --- | --- |
| Which run is unhealthy | Hue, on the outcome badge only |
| Which event kind this row is | Position, in a fixed column |
| Which number is larger | The number itself, monospaced and right-aligned |
| Which row you are on | Luminance, one step of surface |
| Which agent wrote it | Text, never colour. Agents do not get assigned colours |

Agents deliberately have no colour. There is no bounded set of them, so any
palette would run out and start repeating, and a repeated hue reads as a
relationship that is not there.

## State is never carried by hue alone

Every status colour appears beside its own word. Around 4.5% of men cannot
separate red from green, and an operator reading an outcome needs the outcome,
not a hint. This is also what frees the status fills from the 3:1 floor: the
fill reinforces a label rather than being the only thing carrying meaning.

## Signifiers

Anything operable carries a visible cue before it is touched. A row that opens
something has a hover surface and a pointer. A control that does nothing yet is
not rendered rather than rendered disabled, because a disabled control is a
promise the product is not keeping.

`:focus-visible` is never removed. It is the only position indicator a keyboard
user has, and the ring is held to 3:1 by the contrast gate.

## The radius rule

One system, applied everywhere.

| Element | Radius |
| --- | --- |
| Data rows, table cells, the spine | `none` |
| Buttons, inputs, badges, chips | `sm` |
| Panels, popovers, dialogs | `md` |
| Nothing | `lg`, `full` |

`lg` and `full` exist in the scale and are unused. An instrument has square
corners on its readouts, and a pill in this product would be the only round
thing on the screen.

## Layout

Smallest viewport first, breakpoints where this content breaks rather than at
device widths.

- Below `md`: one column. The rail collapses to a header row.
- `md` to `lg`: one column of content, rail visible.
- At `lg`: the run detail's second pane appears. That is where two panes stop
  fitting, and it is the only reason a breakpoint sits there.

Density is a mode, not a redraw. `layout-compact` re-points three semantic
spacing tokens and no component changes.

The highest-frequency target is the run row, and it spans the full content
width, so it is the easiest thing on the screen to hit.

## Buttons

One family, by emphasis. One primary per view.

| Type | Use |
| --- | --- |
| `primary` | The one action a view exists for |
| `secondary` | Everything else that acts |
| `ghost` | Controls inside a dense row, where a border would add a fifth line |
| `danger` | Nothing yet. This product reads and does not write |

States: default, hover, active, focus-visible, disabled, loading. Every one is
contrast-checked. The hit target is at least 44px including its inset, even
where the visible control is shorter.

Labels are verb first. There are no confirmations, because there is nothing
destructive to confirm.

## Empty, loading, error

Every view ships all three, and each is a designed layout rather than a message
centred in the void.

- **Empty** says what would put something here and gives the command that does
  it. A new install's runs list shows the two lines of Python that observe a run.
- **Loading** is the final layout with its text replaced by a shimmer of the
  same shape, so nothing moves when the data lands.
- **Error** names what failed and what to check. It never says something went
  wrong.

## Motion

`MOTION_INTENSITY` is 3. This is an instrument and it does not perform.

What moves, and why:

| Movement | Reason |
| --- | --- |
| Row hover surface, 120ms | Feedback: the row is operable |
| Panel and popover enter, 180ms | State transition: something new is present |
| The live indicator on an open run | State: this run is still going |
| The spine drawing on first paint, 260ms | Hierarchy: it is the axis, so it arrives first |

Nothing loops except the live indicator, and that one stops when the run closes.
Every one of these collapses under `prefers-reduced-motion`, which the token
build enforces by setting all three durations to zero.

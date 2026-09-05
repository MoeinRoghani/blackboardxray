---
version: 1
slug: "ui-src-app-tsx"
primary_target: "ui/src/App.tsx"
related_targets: ["ui/src/pages/Runs.tsx","ui/src/pages/RunDetail.tsx"]
---

## Direction contract

THESIS: The canvas is where you are and layers are what you are inspecting. It
refuses the admin skeleton it replaces: no left menu, no page swap, nothing
that makes an operator lose the run they were reading in order to look at
something inside it.

OWN-WORLD: Graphite. Layered neutral surfaces with a translucent chrome that
lets content show through it, an inset light edge on every raised plane, and
no brand colour at all. Chroma appears only where it carries state, which is
what pro instruments do. Tabular figures on every number.

STORY: The operator scans runs, opens one without leaving the list, drills into
an event and then into the agent behind it, and returns by a gesture rather
than by reading a breadcrumb.

FIRST VIEWPORT: One header with the wordmark, a command field and the outcome
filters. Below it a permanent runs column on the left and the selected run
filling the right. Drilling pushes a sheet from the right edge while the canvas
scales back and dims behind it. The primary action is selecting a run.

FORM: Canvas with a navigation stack. Chosen by the user from three comps, as
shell A's composition carrying shell B's layering. Seed key a3231bfa.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

# Brand — Optket

_Status: documented (existing system, captured 2026-09-19)_

This project already shipped a committed design language before `brand-design` was
ever run, so this file **documents the system in use** rather than replacing it.
All tokens live in `src/index.css` under `:root`. Use these tokens — never inline
hex values or magic spacing.

## Palette

Dark-first, cool-gray temperature. Surfaces get lighter as they elevate.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0e14` | Page base (with a soft radial wash) |
| `--bg-elev` | `#111722` | Cards, primary surfaces |
| `--bg-elev2` | `#161d2b` | Raised controls, hover surfaces |
| `--border` | `#222c3d` | Default 1px separators |
| `--border-strong` | `#33405a` | Inputs, emphasized edges |
| `--text` | `#e6edf6` | Primary text (softened white, not `#fff`) |
| `--text-dim` | `#9aa9bd` | Secondary text (7.5:1 on cards) |
| `--text-faint` | `#7d8da3` | Tertiary text — passes AA at body size (≥4.99:1 on all surfaces) |

All three text tokens pass WCAG AA for body copy on every surface, so any of them
is safe for small text. Keep the hierarchy `text` → `dim` → `faint`.

### Accents — one per meaning

| Token | Value | Meaning |
|---|---|---|
| `--accent` / `--accent-dim` | `#4ade80` / `#16382a` | Primary action, success, "live"/verified |
| `--blue` / `--blue-dim` | `#5b9dff` / `#16273f` | Informational callouts, links, neutral status |
| `--amber` / `--amber-dim` | `#f5c451` / `#3a2f12` | Devnet-value boundary, warnings, unavailable state |
| `--red` / `--red-dim` | `#f87171` / `#3a1a1a` | Destructive, negative values, failures |

Green is the single brand accent, concentrated on the purchase action and payoff.
The compact oUSD demo/no-real-value disclosure is neutral and always readable.
Amber signals warnings or unavailable data, not the normal Devnet environment.

## Typography

- **Sans (`--sans`)**: system stack (`-apple-system`, `Segoe UI`, `Inter`) for all UI.
- **Mono (`--mono`)**: `SF Mono` / `JetBrains Mono` for every number, address,
  price, and quantity. Always pair with `tabular-nums` (set globally via
  `.mono` and `font-variant-numeric`) so updating values don't jitter.
- Landing headings: weight 500, tighter tracking at display sizes. Financial values retain stronger emphasis.
- Body: 14px base, `line-height: 1.5`.

## Shape & depth

The public page combines Set-COM's lighter typography and restrained colour with
Optimus's flat numbered rows. Keep one contained Protect workspace; supporting
asset descriptions and product links use separators rather than nested cards.
The Why protect section uses one asymmetric shared surface: an ownership
illustration beside two concise buyer benefits. Reserve funding belongs in
onchain proof, not the buyer-benefit trio. Illustrations contain no balances,
transaction statuses or simulated execution.
The scroll-led walkthrough pairs readable steps with a sticky mechanism diagram.
Only narrow viewports show diagrams inline. Short desktop windows use a compact
right-side panel. Reduced motion retains the responsive layout with instant
diagram changes and no animated transitions.
These explain mechanics only; they never depict simulated transactions.

Landing hierarchy: one left-aligned introduction, the real Protect workspace,
an asymmetric benefit panel, the walkthrough, asset profiles, onchain evidence and
a quiet footer. Avoid repeated feature lists or a second closing sales pitch.
Connected navigation prioritizes Protect and Positions; Markets, Pools and
Onchain are secondary destinations under Protocol. Position history remains
available alongside active coverage.

- Radius: `--radius` 12px (cards), `--radius-sm` 8px (buttons, inputs), 100px (pills).
- **Borders, not shadows.** The system is flat-with-1px-borders; don't add shadows
  to separate surfaces.

## Motion

- Micro-feedback only: `0.12s ease` on `transform`/`background`/`border-color`.
- Never `transition: all`. Never longer than 300ms for interactive elements.
- All motion sits behind `@media (prefers-reduced-motion: no-preference)`.
- Walkthrough diagrams use 200ms transitions and a 250ms progress line. Reading
  text stays stationary; scrolling is never locked or forced.

## Voice

Plain, precise, and **honest about limits**. This product protects money, and the
demo boundary is disclosed everywhere it matters.

- Say what a thing is: "Settles onchain against a live Jupiter median."
- Name the boundary rather than burying it: "Demo tokens — no redemption promise."
- Never imply an indicative price is executable, or that a simulated value is settled.
- Active voice, sentence case, no exclamation marks.

## Rules of thumb

1. Numbers are mono + tabular; prices carry consistent decimals within a view.
2. Addresses truncate (`Xsc9qv…9qEh`) and link to the cluster-correct explorer.
3. Live data shows its source and freshness; unavailable data is labelled, never faked.
4. One accent per element — a card is bordered *or* tinted, not both plus a shadow.

# Brand — Airbag

Yellow-and-charcoal identity for risk management on Solana.
Design tokens live in `src/index.css` under `:root`.

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
| `--accent` / `--accent-dim` | `#ffdc00` / `oklch(26% 0.045 98)` | Primary actions, hero category, floor marker, focus |
| `--accent-foreground` | `#0a0e14` | Text on yellow buttons |
| `--success` / `--success-dim` | `#4ade80` / `#16382a` | Confirmed success and positive actual results |
| `--blue` / `--blue-dim` | `#5b9dff` / `#16273f` | Informational callouts, links, neutral status |
| `--amber` / `--amber-dim` | `#f5c451` / `#3a2f12` | Devnet-value boundary, warnings, unavailable state |
| `--red` / `--red-dim` | `#f87171` / `#3a1a1a` | Destructive, negative values, failures |

Yellow is the single brand accent; it replaces decorative green. "Risk management"
is yellow; the rest of the hero heading is off-white and the tagline is neutral.
Hypothetical payout amounts are off-white, not success green. Keep authentic asset
logos unchanged. No yellow-filled cards, glowing borders or additional decorative hues.
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
Narrow viewports use a three-step summary and an optional mechanics disclosure, not four inline diagrams. Short desktop windows use a compact
right-side panel. Reduced motion retains the responsive layout with instant
diagram changes and no animated transitions.
These explain mechanics only; they never depict simulated transactions.

Landing hierarchy: category-led hero, the real Protect workspace, an asymmetric
benefit panel, the walkthrough, asset profiles, FAQ with a quiet linked evidence
strip beneath it, and a quiet footer. Avoid repeated feature lists or a second
closing sales pitch.
Connected navigation prioritizes Open position and Positions; Markets, Pools and
Onchain are secondary destinations under Protocol. Position history remains
available alongside active coverage.

Lead with the category headline: "Risk management for tokenized equities."
"Keep the upside. Define your downside." is the single supporting line.
For the vault release, the supporting line is "Set a downside floor. Or fund payouts and share in premiums."
A single selector above the working form switches between Set your floor and Fund a vault. Do not repeat these as hero buttons. Your positions opens the existing buyer-contract and vault-deposit overview.
Only the selected real form mounts; changing modes preserves configuration but never carries transaction approval.
The dedicated vault view retains history and management. Wallet connection does not submit a transaction.
Why Airbag uses a holder-to-vault premium/payout relationship, not a second numbered process. State
that depositor capital can lose value and premiums are not guaranteed profit.
Gate this positioning with the vault feature itself until the coordinated release.
Keep the hero free of environment labels; Devnet and oUSD disclosures remain
in the product, checkout and transaction screens. Keep token-market contract scope in contract
details and holdings calculations, not a repeated hero caveat. The earlier onchain thesis
supports the Why protect section rather than competing with the hero.
Show only supported token markets, distinguishing tokenized public equity from
pre-IPO token exposure without implying issuer partnerships or company-share ownership.
The signature payoff surface uses selected contract terms and existing fixed-point
calculations. Hypothetical references and payouts are labelled, not presented as
quotes or settlement receipts. A price-axis boundary connects the chosen floor,
hypothetical reference and calculated payout; it is not a historical price chart.
Confirmed receipts and positions reuse the floor motif without an invented reference.
Values update directly, never counting up to suggest live trading activity.
Purchase confirmation follows confirmed execution, snapshots its own contract target,
and directs the user to the highlighted position. The detailed payoff curve remains
available through progressive disclosure.

The desktop Protect workspace places terms left and the payout boundary right,
with one shared premium/action row beneath. Holdings lookup, detailed curve and
methodology expand below the primary workflow. Use natural height and responsive
stacking, never clipped panels, internal scrolling or tiny type to force a fit.
On mobile, a compact maximum-payout summary precedes an optional Explore payouts panel.
Vault entry prioritizes the deposit action and lock terms; accounting and historical rounds remain secondary.
The hero keeps breathing room and a product peek; it does not squeeze the entire
workspace above the fold. The evidence strip links to program, pool funding,
reference rules and actual activity; it is not a second numbered walkthrough.
Reserve amounts and receipts in Positions come from chain data.
The category uses the display headline with primary contrast, not an eyebrow.
Important labels are 14–16px and supporting explanations 15–16px; only secondary metadata
uses smaller text. Preserve fit by shortening copy, not shrinking primary labels.

Product controls use neutral, checked selections; yellow marks the primary
commitment action. Scenario prices are explicitly exploratory, support direct
entry and keyboard adjustment, and never stand in for executable quotes.
Public Markets, Pools and Onchain views do not require a wallet. App destinations
use a `view` query parameter so refresh and browser Back preserve navigation.
Purchases require review of a maximum premium, enforced against signed payload
bytes before submission. Exercise has a separate irreversible-action review.

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
- Name the boundary rather than burying it: "Demo tokens. No redemption promise."
- Never imply an indicative price is executable, or that a simulated value is settled.
- Active voice, sentence case, no exclamation marks or em dashes in product copy.
- Supporting text is at least 14px. Keep section labels neutral and consistent.
- Remove decorative button arrows. Preserve functional disclosure chevrons and mechanism arrows.
- The environment badge says Devnet, not Devnet demo. Keep oUSD's no-real-value disclosure at transaction points.
- Set 12: shorten repeated explanations; preserve unavailable-reference states,
  quote limits, browser-wallet access warnings and irreversible exercise review.
  Normal references show freshness without a redundant "Reference available" label.
  Label scenarios "Illustrative payout. Not a quote." Keep oUSD's no-real-value
  disclosure visible at checkout and combined holdings outcomes.

## Rules of thumb

1. Numbers are mono + tabular; prices carry consistent decimals within a view.
2. Addresses truncate (`Xsc9qv…9qEh`) and link to the cluster-correct explorer.
3. Live data shows its source and freshness; unavailable data is labelled, never faked.
4. One accent per element — a card is bordered *or* tinted, not both plus a shadow.
Set Hero: show asset logos, names and category labels only in the functional selector,
not as a duplicate hero row. Preserve headline size and the gap above the workspace.
- Use “Set your floor” for configuration, “Review position” before purchase and
  “Open position” for the final action. Use protection selectively to explain the
  mechanism, not as the label for every action. Early exercise remains an explicit
  request, never “cash out” or an immediate, known payout.

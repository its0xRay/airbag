# Airbag design guide

## Identity

Yellow `#ffdc00`, charcoal `#0a0e14`, and off-white `#f5f5f2`.
Design tokens live in `src/index.css`. Use yellow for primary actions and selected
financial markers, with dark text. Reserve status colors for actual state.

## Layout

- Dark hero and transaction workspace; light explanatory sections.
- Buyer and vault tabs share one panel and preserve editable drafts, never approvals.
- Desktop pairs the introduction with the workspace. Mobile stacks them.
- Desktop landing content shares a 1600px maximum width and 32px minimum gutters,
  including navigation and footer. Paragraphs retain their own reading-width limits.
- Keep controls readable and touch-sized. Avoid clipped panels and internal scrolling.
- Positions prioritize the next available action, with details progressively disclosed.

## Typography and copy

Use the system sans-serif stack for text and tabular monospace for amounts.
Keep supporting text readable; shorten copy before shrinking it.
Use consistent asset names, explicit units and concise sentence-case labels.
Say “onchain” and “Devnet”. Keep test-token information beside transaction controls.

## Interaction

Preserve keyboard access, visible focus, review steps and cancellation.
Use subtle motion and respect reduced-motion preferences.
Show actual references, reserves and transaction state. Label payout scenarios as
hypothetical; never invent prices, activity or executable terms.

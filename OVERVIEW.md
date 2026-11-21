Smart tables sizes Markdown tables proportionally to their content and expands wide tables past the chat content column only as far as needed.

Default Markdown tables in Paseo use `width: 100%` inside the content column, which squeezes CJK or prose columns beside unbreakable identifiers and forces horizontal scrollbars even when wide margins remain unused.

What it does:
- Short tables stay compact inside the content column without stretching.
- Wide tables expand symmetrically into the surrounding scroll pane (with a 12px horizontal gutter) using CSS Tables 3 min/max proportional distribution and a LaTeX tabulary square-root column cap (26em).
- Long identifier lists break cleanly at spaces, punctuation, and path separators, while inline code badges and collapsed borders are measured in border-box units.
- Post-layout width reconciliation checks `table.scrollWidth` and widens the wrapper when space remains in the scroll pane, preventing unnecessary horizontal scrollbars.
- Streaming table updates and window resizes are tracked automatically via `MutationObserver` and `ResizeObserver`.

Platform support and privacy:
- Runs only in the Paseo desktop and web renderer (no-op on iOS and Android native apps).
- Pure client plugin with no server process, no network requests, and no filesystem access.
- Unloading or disabling the plugin removes all injected styles and observers and restores default table rendering.

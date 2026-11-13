# ATT design brief — light, restrained, crafted, tennis-inflected

## Intent (non-negotiable)

Deliver a **professional, contemporary, LIGHT interface** with the clarity, typographic discipline and calm tactile refinement of good Apple-era product UI **without copying Apple branding or screens**. It should feel like a thoughtful independent product designed for friends playing table tennis, **not** a generic AI-generated dashboard or loud drinking-party website. Tennis has a visible but restrained influence; a tiny celebratory layer makes the experience lively.

**Design keywords:** bright / editorial / legible / purposeful / welcoming / precise / understated / playful only in details.

**Avoid:** dark-first default; huge gradient blobs, glassmorphism everywhere, rainbow stat cards, overdone 3D balls, random emojis, giant hero marketing sections, stock images, neon gradients, floating cards with enormous shadows, generic SaaS admin template, “AI slop” visual motifs, flashy confetti on every click, excessive pill controls and ultra-rounded everything.

## Visual direction

- Background: near-white or very soft warm gray (`#FAFAF8` / `#F7F8F6` illustrative); cards true white; high-contrast charcoal text (`#1F2422` illustrative). Don't freeze palette until visual validation in browser.
- Primary accent: restrained **table-tennis green** (`#346A4A` or similarly muted sport green); supplementary warm **ball-orange/coral** (`#E38B59`) in very small doses for stage or match annotations. Secondary neutrals in graphite and gray. Keep one main accent in the same screen.
- Use system font stack (`-apple-system`, `BlinkMacSystemFont`, `Inter` if licensing permits, `Segoe UI`, sans-serif); no proprietary Apple font distribution; limit font families and weights. Strong number typography and tabular numerals for scoreboards and ratings.
- 8px-ish spacing rhythm, generous yet not wasteful whitespace, 10–16px corner radius depending on component, hairline dividers, nearly invisible shadows reserved for overlays. Avoid multiplying container layers.
- Small tennis cues: subtle 2px baseline/side-line rules, a ball-size circle as a section marker, score-grid rhythm, a restrained top-bar icon. These must not sacrifice affordance or accessibility.
- Tiny celebration: a gentle brief highlight or a 300–500ms micro-animation on a saved match/important win, only when reduced motion is off; no alcohol-linked reward effect. No confetti shower by default.
- Default light theme is **mandatory**. A polished dark mode is optional P1 only if the light design and all P0 functionality are complete.

## Visual hierarchy & layout

### Desktop

- Simple top navigation with ATT wordmark/logo mark, links «Обзор», «Матчи», «Игроки», «Алкоголь», «Аналитика»; primary «Записать матч» action is visible; admin entry subdued.
- Content max width around 1120–1240px; sufficient gutters; crisp section headers with short descriptions. Use at most 2–3 columns where useful, not a wall of tiny widgets.
- Overview: hero is a compact title and one or two factual summary lines, **not** marketing; meaningful stat strip, table/leaderboard, a single compelling Elo chart and recent matches.
- Analytics favor precise labels, axis units, number of samples and consistent colors; tooltips accessible and mobile-friendly. No 3D charts or meaningless radial gauges.

### Mobile (primary)

- Width 320px minimum without horizontal overflow; comfortable 360–430px. Sticky or persistent clear navigation (top with compact controls or tasteful bottom nav) and a prominent «+ Матч» action.
- Primary actions reachable with thumb, minimum approximately 44px targets, one-column card sections and compact tables transformed into readable rows.
- Scorekeeper fills usable viewport with *two large score zones*, obvious names and target, large accessible tap targets, undo, confirmation. Legible outdoors under bright light. Landscape should remain functional.
- Consumption forms are quick: select player, drink, volume, ABV; editable numerical keyboard and preset suggestions only if they improve speed. Avoid giant multi-step wizard for routine input.
- Compare two players without requiring delicate pinch/zoom; adapt chart legend and axis labels.

## Page-by-page UX contracts

1. **Overview:** headline «Турнир в разгаре» or neutral state dependent on data, total matches/players/stage, preview of top players, rating history, recent events. Empty state explains first steps. No fake demo content in production.
2. **Quick match:** two player selectors that prevent duplicate choice, target segmented control (11/21), score steppers or numeric fields, subjective 0–10 selectors, visible stage/snapshot, immediate validity feedback, review confirmation. Strong post-save affordance to repeat pair.
3. **Live counter:** single-device, local-only clearly indicated; large labels, 2 score controls, undo (keyboard accessible), game point/result presentation, confirm and publish only at the end. Preserve draft on refresh and failures.
4. **Players & profile:** rankings legible, normalized decimals, rank vs provisional label; profile emphasizes match record, Elo movement and opponents before alcohol charts. Consistent player color in every chart.
5. **Alcohol:** global stage timeline, cumulative amounts and editable display (admin only), one low-friction action for adding drink, public visibility notice. Never represent subjective 10/10 as a success state or badge.
6. **Analytics:** clear toggles between «Рейтинг», «Трезвая игра», «Алкоголь и результаты»; chart annotations name sample size and assumptions. Correlation results have uncertainty copy and blank states.
7. **Admin:** unobtrusive separate route/login; ordinary UI gains edit actions only after valid session. Destructive operations get explicit dialog describing impact on ratings.

## Component inventory

- AppShell, PageHeader, TopNav/MobileNav, PrimaryButton, QuietButton, FormField, NumericStepper, PlayerSelect, StageChip, Scoreboard, MatchRow, RatingRow, ChartCard, EmptyState, ConfirmDialog, Toast/InlineNotice, LoadingSkeleton, ErrorState, AdminActionMenu.
- Reuse these components rather than generating an unrelated visual system for every page.
- Show focus rings, hover, active, disabled, pending, validation and loading states. Long names must truncate gracefully with tooltip/accessible full-name exposure.
- Tables: align numeric columns, show contextual titles/units. Color must never be the sole carrier of wins/losses or alert state.
- Use simple original SVG logo/mark if needed; no stock photography or generated illustrations required.

## Content tone

Concise Russian, neutral and slightly witty only where appropriate. Examples: «Матч записан», «Пока нет матчей», «Добавить напиток», «Данных для сравнения недостаточно». Do not glamorize intoxication or present a high score on the 0–10 scale as a trophy. Keep calculations and definitions one tap away.

## UI acceptance/design review

- Capture and attach screenshots (desktop 1440px and mobile 390px; also 320px) for Overview, Quick Match, Live counter, Alcohol timeline and Analytics with seeded *development-only* data.
- Manually inspect: no overflow, readable chart axes, coherent whitespace, no repeated big card shadows or decorative gradients, no broken empty states, accessible keyboard focus, reduced motion, browser refresh/local draft recovery.
- Ensure build output does not ship demo seed data. Screenshots of representative data may be committed to docs if small and useful, but no third-party asset licensing problems.
- Visual gate: the end result must look like a specifically designed tennis analytics tool, not a remixed generic AI landing page. If in doubt choose simplicity over decoration.

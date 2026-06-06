# Qantara Accessibility Contract

Qantara targets WCAG 2.2 AA for the production web app. This file captures the release contract that must stay true as new payment, chat, receipt, and wallet flows are added.

## Landmarks

- Public pages use a single `main` landmark.
- App shell content is wrapped in the app layout `main` region.
- Standalone checkout routes such as `/pay/:hash` and `/checkout/:hash` expose their own `main` region because they do not use the app shell.

## Keyboard And Focus

- Every interactive control must be reachable with keyboard navigation.
- Icon-only controls require `aria-label` and, when useful, `title`.
- Modal and drawer work must preserve visible focus states and a clear close action.
- Disabled transaction actions must remain visibly disabled and must not hide the reason from nearby state text.

## Forms

- Inputs must have an associated label via `htmlFor`/`id`, or a direct `aria-label` when a visual label would duplicate compact checkout UI.
- Error states use `aria-invalid` where validation belongs to a specific field.
- Helper text should be connected through `aria-describedby` when it explains a field value or unit.

## Live Updates

- Route loading uses `role="status"` with polite announcements.
- Toasts use `role="status"` for informational updates and `role="alert"` for errors.
- Realtime checkout status uses polite live text so payment, RPC verification, and deal-room updates are announced without interrupting wallet flows.

## Content And Visuals

- Images require meaningful `alt` text unless decorative.
- Text must not rely on color alone for status. Payment, network, invoice, and receipt states must also include text.
- Compact mobile checkout must keep amount, merchant, status, wallet action, and deal-room entry readable without horizontal scrolling.

## Regression Checks

- `npm run lint`
- `npm test -- --run`
- Playwright responsive smoke in `qie-app/e2e/responsive.spec.ts`
- Manual keyboard pass for `/app/start`, `/app/dashboard`, `/app/settings`, `/pay/:hash`, and `/checkout/:hash`

# Kasa Theme and Navigation Implementation Plan

**Goal:** Implement the user's system theme preference and revised header/drawer, then publish the verified result.

**Architecture:** A small theme store resolves system/light/dark, applies root data-theme and browser color metadata, and persists a nonfinancial device preference. React consumes the store through useTheme. CSS maps surfaces and text to semantic theme colors; charts use these variables directly. Header markup preserves existing navigation and focus management.

**Tech Stack:** React 19, TypeScript, CSS, Vite, existing Vitest and browser QA.

## Constraints

- Default preference is system; explicit light/dark ignores subsequent system changes.
- Light header #ffffff; dark header #14232c; notch surface matches the header.
- Keep the approved 286×60 bottom dock, 50px peers and 68px center button.
- No financial API/data changes or additional dependencies.
- The user already authorized this layout and production publishing.

## Tasks

- [x] Theme agent: src/theme.tsx, versioned public bootstrap, index.html, main.tsx, Settings.tsx and focused theme behavior tests. Root contract is data-theme=light|dark and useTheme returning preference, resolved and setPreference.
- [x] Header agent: App.tsx and Brand.tsx. Put .topbar-brand and current page left, .mobile-menu-button right; .sidebar-logout inside menu. Keep focus trap, inert regions, route changes and viewport recovery.
- [x] Root: styles.css semantic palettes, legacy dark surfaces/text, theme choice controls and right drawer with right safe-area padding. Keep normal browser zoom and reduced motion.
- [x] Review agent: Charts.tsx variables for SVG strokes/fills, tooltip, cursor and legend, followed by independent integrated review.
- [x] Root: extend existing browser QA for actual preference actions, reload/system changes, header geometry, right drawer, logout location and matching notch/header surfaces. Reuse synthetic API interception.
- [x] Build/typecheck, focused theme tests, appropriate mobile/desktop QA and visual inspection. Resolve findings before commit.
- [ ] Commit exact source/test/docs files, push main, use existing atomic server updater, verify live HTML/assets/health and one live mobile browser run.

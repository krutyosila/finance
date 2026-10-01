# Kasa branding implementation plan

> **For agentic workers:** Use parallel scoped tasks in this session and review the combined result before publishing.

**Goal:** Apply the user-approved symbol and exact name Kasa to the web app, browser favicon, installed app icons and live site.

**Architecture:** Author shared SVG symbol and outlined wordmark assets, render installation icons from the same geometry, and reuse a single accessible Brand component in the existing React screens. Update the PWA cache to migrate existing installations from Still assets to Kasa assets.

**Tech Stack:** Existing React, TypeScript, Vite, SVG and service worker; bundled font/image tooling for asset preparation.

## Global constraints

- Preserve the approved two-part circular symbol and existing teal/navy/mint palette.
- Display the exact name Kasa, with lowercase kasa in the wordmark.
- Keep existing finance data, accounting behavior and authentication session identifiers intact.
- Include SVG, PNG and ICO browser icons; 192/512 install icons, 180 Apple icon and safe-area maskable icon.
- Publish through the existing confirmed deployment target after build, tests and browser checks pass.

## Tasks

- [x] Author public/brand/kasa-mark.svg, kasa-mark-mint.svg, kasa-logo.svg and kasa-logo-light.svg with embedded outlines and no runtime font dependency. Generate public/icons and public/favicon.ico from the same vector geometry.
- [x] Integrate a shared Brand component into src/App.tsx and src/auth.tsx; update src/pwa.tsx, src/styles.css and index.html names and icon links. Check desktop and mobile sizing and focus visibility.
- [x] Update public/manifest.webmanifest, public/offline.html, README.md, docs/PWA.md and package metadata. Migrate service-worker caches in public/sw.js and verify the existing frontend-security cache test also removes old Still caches and stale Kasa caches while retaining unrelated caches.
- [x] Review combined diffs, run the frontend-security tests, full test suite and production build. Inspect login and main screen on desktop and mobile and verify asset dimensions and alpha.
- [ ] Identify the real current HTTPS URL and approved SSH/update workflow. Publish the verified commit and check live title, manifest, logos, icons and health response. Record the actual deployed version and rollback path.

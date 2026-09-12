# companion-apply header shell — root cause

## Symptom
Top black Header looked like a floating card: gaps above and on both sides; Header and application content appeared as two separate containers.

## DOM hierarchy (before)

```
html
└─ body.companion-apply-page          ← padding: 24px (mobile 10/16)  ★ ROOT CAUSE
   ├─ header.site-header.mcj-boss-header   ← injected by boss-header.js as firstChild
   └─ main.apply-shell                     ← max-width:1100px; margin:auto
      ├─ .apply-top (duplicate brand + 返回)
      ├─ .apply-hero
      └─ #companionApplyRoot
```

## Why padding-tweaks kept failing
Header is a **sibling** of `main.apply-shell`, both children of `body`.
Any `body { padding }` insets the Header on all sides. Negative margins /
`translate` / `top:-N` only masked one side and broke at other breakpoints.

## Fix (structural)
1. `body.companion-apply-page { margin:0; padding:0 }` — body is the App Shell.
2. Header stays full-bleed: `width:100%; margin:0; border-radius:0; box-shadow:none`.
3. Content inset moves to `main.apply-shell` only.
4. Remove duplicate `.apply-brand` from `.apply-top` (boss header already owns brand).
5. Load page shell CSS after `design-system.css`.

## After hierarchy

```
html
└─ body.companion-apply-page          ← padding:0 (full viewport shell)
   ├─ header.mcj-boss-header          ← full-bleed top chrome
   └─ main.apply-shell                ← owns padding + max-width
      ├─ .apply-top > .apply-back
      ├─ .apply-hero
      └─ #companionApplyRoot
```

## Out of scope
Step 1–4 form logic, uploads, review API, theme colors, buttons.

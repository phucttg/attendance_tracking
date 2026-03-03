---
trigger: always_on
---

---
applyTo: "client/**"
---

# Flowbite React Rules — Attendance MVP

## Purpose
- Use Flowbite React to build MVP UI fast (tables/forms/modals), consistent with Tailwind-first approach.

## Prefer Flowbite React over Flowbite vanilla JS
- Use `flowbite-react` components (Modal/Dropdown/Tabs/Datepicker/Sidebar/Navbar).
- Avoid initializing Flowbite vanilla JS in React unless you have a very specific reason.

## Import rules
- Import only what you use: `import { Table, Button } from "flowbite-react";`
- Keep components small; pages compose from reusable UI pieces.

## Styling rules
- Tailwind utility classes only.
- Use `className` to adjust spacing/layout; do not fork component internals unless necessary.

## UX rules for data pages
- Always show loading state (Spinner) + empty state + error state (Alert).
- Use Modal for confirm actions (approve/reject/export confirm if needed).
- Use Toast for “Saved/Approved/Export started”.

## Tables
- Wrap tables in `overflow-x-auto` container.
- Table header includes controls: month selector, scope selector, export button.

## Forms
- Use Flowbite React Forms components (Label/TextInput/Select/Textarea).
- Validate client-side first; show inline error via Alert or helper text.

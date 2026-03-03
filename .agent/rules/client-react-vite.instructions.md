
---
applyTo: "client/**"
---

# Client (React + Vite) Instructions — Attendance MVP

## Goals
- Beginner-friendly MVP. Keep it simple: tables/forms, minimal dependencies.
- Follow source-of-truth docs: RULES.md (business logic), API_SPEC.md (endpoints), ROADMAP.md (pages).

## Tech
- React + Vite + React Router
- Axios client with Bearer token
- TailwindCSS utility classes only (no custom CSS)

## React Hooks Rules
- Use AuthContext as single source of truth for user/token/loading.
- Pages keep local state (month/scope/loading/error/data) and fetch via useEffect when inputs change.
- Prefer derived rendering with useMemo (do not store derived values in state).
- Use useCallback for handlers passed to children or used in effects.
- Avoid race conditions on month changes (AbortController or requestId ref).

## Auth + RBAC
- Protect routes in UI (ProtectedRoute) AND hide nav items based on role.
- RoleRoute must enforce allowed roles (MANAGER/ADMIN only pages).

## Timezone (Critical)
- All “today” and date displays are Asia/Ho_Chi_Minh (GMT+7).
- When status === null, distinguish date > today (future) vs date === today (not checked in yet).

## API usage
- Base URL: http://localhost:3000/api (dev)
- Authorization header: Bearer <token> on protected routes.
- For export: open /reports/monthly/export in new tab to download xlsx.

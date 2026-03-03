---
description: "Guidelines for writing Node.js and JavaScript code with Vitest testing"
applyTo: '**/*.js, **/*.mjs, **/*.cjs'
---

# Code Generation Guidelines

## Coding standards
- Use JavaScript with ES2022 features and Node.js (20+) ESM modules
- Use Node.js built-in modules and avoid external dependencies where possible
- Ask the user if you require any additional dependencies before adding them
- Always use async/await for asynchronous code, and use 'node:util' promisify function to avoid callbacks
- Keep the code simple and maintainable
- Use descriptive variable and function names
- Do not add comments unless absolutely necessary, the code should be self-explanatory
- Never use `null`, always use `undefined` for optional values
- Prefer functions over classes

## Project Exception — Attendance MVP (MERN) Null Handling

The general guideline says: **"Never use `null`, always use `undefined` for optional values"**.

However, for this Attendance MVP project, we allow `null` **ONLY** for specific database fields where it makes the business logic clearer and queries more predictable.

### Allowed `null` fields (ONLY these cases)
1) **Attendance**
- `checkOutAt`:
  - After check-in: `checkOutAt = null`
  - After check-out: set to `Date`
  - This is required to distinguish:
    - Today: `checkInAt != null && checkOutAt == null` => `WORKING`
    - Past day: `checkInAt != null && checkOutAt == null` => `MISSING_CHECKOUT`

2) **Requests (adjust time)**
- `requestedCheckInAt` / `requestedCheckOutAt`:
  - If user requests only check-out: `requestedCheckInAt = null`, `requestedCheckOutAt = <Date>`
  - If user requests only check-in: `requestedCheckInAt = <Date>`, `requestedCheckOutAt = null`

### When NOT to use `null`
Do NOT use `null` for required/identity fields:
- `userId`, `date`, `employeeCode`, `email`, `role`, `passwordHash`

### Consistency rule (important)
- For the fields above, prefer **explicit `null`** (instead of missing/undefined fields) to keep querying and status computation consistent.
- Outside these explicitly listed cases, follow the original guideline: prefer `undefined` for optional values.


## Testing
- Use Vitest for testing
- Write tests for all new features and bug fixes
- Ensure tests cover edge cases and error handling
- NEVER change the original code to make it easier to test, instead, write tests that cover the original code as it is

## Documentation
- When adding new features or making significant changes, update the README.md file where necessary

## User interactions
- Ask questions if you are unsure about the implementation details, design choices, or need clarification on the requirements
- Always answer in the same language as the question, but use english for the generated content like code, comments or docs

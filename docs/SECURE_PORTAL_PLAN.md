# GS25 Secure Employee Portal — integration plan

Status: development branch; NOT production-ready. Existing index.html is deliberately unchanged.

## Existing behavior reviewed
- index.html downloads employee and salary JSON directly in the browser.
- Employee passwords are compared against downloaded data in JavaScript.
- Employee object can be stored in localStorage.
- Cash difference and salary display already exist and should be preserved.
- Existing Google Sheets URLs must be moved to server-side secrets and the original public feeds restricted or retired before launch.

## Target architecture
GitHub Pages (static existing UI) -> authenticated HTTPS backend (separate deployment) -> private Google Sheets / Supabase.
GitHub Pages CANNOT run server-side authentication or keep credentials secret.

## Migration steps
1. Set up server deployment (e.g. Next.js on Vercel) with private environment variables.
2. Provision authenticated users, migrate legacy plaintext passwords to salted password hashes through an approved reset process. Never copy passwords into public files.
3. Restrict original spreadsheet endpoints: if old public endpoints still expose full rows, proxying them does not solve leakage.
4. Implement /api/session, /api/me, /api/me/payroll, /api/me/cash, /api/employee-profile and /api/admin endpoints with server-side authorization.
5. Add employee form to existing UI after verified login, or one-link onboarding using short-lived single-use invite tokens; never use employee code alone as proof of identity.
6. Admin role must be assigned server-side to verified employee code 115091; require MFA for admin.
7. Use Maps JavaScript API for pin selection, Routes API for driving/walking/transit where available. Branch coordinates must be maintained in a private branches table.
8. Export Excel only through authenticated, audited admin API; formula-escape untrusted cells.
9. Test with synthetic data, conduct security review, then merge.

## Important constraints
- Exact home coordinates, bank IBAN, salary and emergency contacts are sensitive. Limit access, retention and exports.
- Staff cannot edit submitted profile in UI; authorized HR can correct data.
- Consent notice and lawful basis must be reviewed before production.
- Route travel time is an estimate; transit coverage depends on Google availability.
- Never expose service-role keys, Sheets tokens, or complete payroll feeds to browser.

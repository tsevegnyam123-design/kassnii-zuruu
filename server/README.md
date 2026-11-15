# GS25 protected API — first implementation

This is the first working **server-side auth and role-check scaffold**, not a complete production portal.

## Run locally
1. Install Node.js 20+.
2. In this directory run `npm install`.
3. Copy `.env.example` to `.env` and populate secrets locally (never commit `.env`).
4. Set ALLOWED_ORIGINS to exact allowed browser origins.
5. Run `npm run dev`.
6. GET `/api/health` returns `{"status":"ok"}`.
7. `/api/me` and `/api/admin/status` require a valid Supabase Auth bearer access token.

## Security and limitations
- The service-role key stays only on the server. Do not put it in GitHub Pages, browser JS, or chat.
- Admin is authorized from portal_roles, not a browser comparison with code 115091.
- CORS is not authentication; authorization is checked on every protected endpoint.
- Auth sessions and employee profile mapping must be implemented before real employee access.
- Existing public Google Sheets JSON feeds still need to be locked down. Until then, payroll remains exposed independently of this API.
- Do not deploy this as a complete HR system or enter real personal data.
- In production, add request auditing, MFA enforcement for admins, token/session revocation handling, private Sheet connector, password reset/migration, strict security headers, and integration tests.

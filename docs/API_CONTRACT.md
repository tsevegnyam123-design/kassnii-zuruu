# Proposed protected API contract (not implemented yet)

POST /api/session — authenticate; issue secure HttpOnly, Secure, SameSite cookie; rate-limit and audit.
POST /api/logout — invalidate session.
GET /api/me — only authenticated user's code, name, branch and role.
GET /api/me/cash — cash difference for authenticated employee only, server-side Sheets lookup.
GET /api/me/payroll — payroll for authenticated employee only, server-side Sheets lookup.
POST /api/me/profile — one-time profile submission after authenticated onboarding; require home pin and consent.
GET /api/admin/employees — hr_admin only, paginated, filtered and audited.
GET /api/admin/export — hr_admin only, Excel file; sensitive fields separately authorized.
POST /api/routes — authorized requester, validated origin/destination, Google Routes server key.

Do not implement admin check as a client-side comparison to employee code 115091.
Do not allow public anonymous profile writes without verified invitation.

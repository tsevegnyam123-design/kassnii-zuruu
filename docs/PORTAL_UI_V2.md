# GS25 Portal UI V2 preview

Open `portal-preview.html` locally in a browser to review the responsive Mongolian-language navigation and form layout.

This is **a visual prototype**, not an employee data collection system. It intentionally does not store data, log in, expose payroll, or call Google Maps. Never enter real personal information.

The existing `index.html` is unchanged. The production portal remains on GitHub Pages.

## Next implementation tasks
1. Private server-side authentication and role checks; rotate or restrict any currently public Google Sheets endpoints.
2. Backend data access for employee-specific cash difference and salary.
3. Verified single-use onboarding and one-time employee profile submission.
4. Google Maps location selection and Routes API with controlled access.
5. Authenticated HR Dashboard, audited Excel export and retention controls.
6. Test with synthetic data and deploy a separate Vercel preview before changing the production entrypoint.

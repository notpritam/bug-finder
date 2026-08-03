# Test credentials — Bug Finder dashboard

Auth is CLIENT-SIDE ONLY (localStorage registry + SHA-256, no backend auth).
Accounts live in the browser's localStorage under key `bf.users`; the session under `bf.session-user`.

To test signed-in flows, simply CREATE an account on the /auth screen (any values work):
- Name: QA Tester
- Email: qa@test.com
- Password: test123
- Role: QA Engineer, Team: Platform

Or inject a session directly before page load:
localStorage.setItem('bf.session-user', JSON.stringify({id:'u1',name:'Pritam Sharma',email:'pritam@emergent.sh',role:'Engineer',team:'Platform'}));

Bugs/drafts persist in IndexedDB db `bugfinder` (stores: `bugs`, `drafts`) — seed there for bug-page tests.
Backend endpoints (no auth): /api/initiatives (CRUD), /api/bugs/{humanId}, /api/ai/draft-fill.

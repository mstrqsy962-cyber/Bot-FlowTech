# FlowTech — Railway

## Persistent storage
FlowTech now stores all persistent data under `DATA_DIR`. On Railway, attach a Volume and mount it at `/data`.

The volume stores:
- user accounts
- per-user settings
- AI configuration
- WhatsApp auth credentials
- per-user sessions

Do not run multiple replicas for a service using this WhatsApp session storage.

## Environment
Optional:
- `PORT` — Railway supplies this automatically.
- `DATA_DIR=/data` — recommended when the Railway Volume is mounted at `/data`.
- `DASHBOARD_SECRET` — optional; if omitted, a random secret is generated for the current process.
- `AI_PROVIDER`, `AI_MODEL` — optional defaults only.

No service-account/private Firebase key is required by this version.

## Account model
Each account has:
- username
- email
- password hash
- isolated settings
- one WhatsApp session
- isolated AI key/configuration

The dashboard API always resolves data through the authenticated account ID.

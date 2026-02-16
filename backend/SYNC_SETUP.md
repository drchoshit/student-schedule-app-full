# Student Sync Setup

When `/api/admin/students` is called (add/update/delete), student data is synced to other apps.

## 1) Default behavior

- `add/update`: upsert is sent to external apps
- `delete`: delete is **blocked by default** for safety.
  - Delete propagation runs only when **both** conditions are satisfied:
    - `STUDENT_SYNC_DELETE_MODE=hard`
    - `STUDENT_SYNC_ALLOW_DELETE=true`

## 2) Manual reconciliation (name-based)

Admin API supports preview/apply flow:

- `POST /api/admin/students/sync/preview`
- `POST /api/admin/students/sync/apply`

Rules:

- source of truth: `medischedule` students (`/admin` app)
- match key: student `name` (normalized)
- if source has student and target doesn't: target add
- if target has student and source doesn't: do **not** delete, only report as `extras`

## 3) Environment variables

```env
# global on/off (default true)
STUDENT_SYNC_ENABLED=true

# request timeout in ms (default 8000)
STUDENT_SYNC_TIMEOUT_MS=8000

# delete sync mode: skip | hard (default skip, safer)
STUDENT_SYNC_DELETE_MODE=skip

# second safety latch for delete propagation (default false)
STUDENT_SYNC_ALLOW_DELETE=false

# blocks dangerous local actions in admin API:
# - DELETE /api/admin/students/:id
# - DELETE /api/admin/schedules/clearAll
# - DELETE /api/admin/schedules/clear-all
# default false (recommended in production)
ADMIN_DANGEROUS_ACTIONS_ENABLED=false

# ---- dosirak ----
SYNC_DOSIRAK_BASE_URL=https://your-dosirak-domain
SYNC_DOSIRAK_ADMIN_USER=admin_id
SYNC_DOSIRAK_ADMIN_PASS=admin_password

# ---- mentoring ----
SYNC_MENTORING_BASE_URL=https://your-mentoring-api-domain
SYNC_MENTORING_USERNAME=director_or_admin_username
SYNC_MENTORING_PASSWORD=director_or_admin_password

# ---- penalty ----
SYNC_PENALTY_BASE_URL=https://your-penalty-domain

# ---- legacy state app ----
SYNC_LEGACY_BASE_URL=https://your-legacy-state-domain
SYNC_LEGACY_USERNAME=admin_username
SYNC_LEGACY_PASSWORD=admin_password
```

## 4) Production safety checklist

1. Keep `STUDENT_SYNC_DELETE_MODE=skip`
2. Keep `STUDENT_SYNC_ALLOW_DELETE=false`
3. Keep `ADMIN_DANGEROUS_ACTIONS_ENABLED=false`
4. Take DB/state backup from all 5 apps before first sync apply
5. Run preview first: `POST /api/admin/students/sync/preview`
6. Apply only after manual review: `POST /api/admin/students/sync/apply`

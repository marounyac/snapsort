# SnapSort social layer — approved plan

Backend: **Supabase** (free tier, no build step — UMD SDK from jsDelivr,
everything configured in the web dashboard). The anon key + project URL live
in `js/config.js`; while they're empty every social feature is hidden and the
app stays fully solo/on-device.

Core principle carried over from the solo app: **photos stay on-device by
default**. Sharing uploads a *copy*; local originals are never touched, and
deleting shared things never deletes anyone's local photos.

## Phases

- **Phase 0 — Backend foundation** *(this commit)*: `js/config.js`,
  `js/backend.js` (lazy CDN SDK load, graceful offline/unconfigured
  degradation), `supabase/schema.sql` (all tables + RLS + storage bucket,
  pasted into the dashboard SQL editor). No visible changes.
- **Phase 1 — Real accounts**: Supabase Auth behind the existing two-step
  signup/login UI (username → synthetic email, email confirmation disabled),
  cross-device sessions, migration note for local accounts. Privacy copy
  changes ship here: "Private by default: photos stay on your device unless
  you share them."
- **Phase 2 — Friends**: username search, send/accept/decline requests,
  friends list, realtime request updates, **blocking** included from day one.
- **Phase 3 — Shared categories**: create + invite one friend, upload/view/
  delete shared photos (Storage bucket `shared`, paths `<category_id>/…`),
  "Shared" section on the home screen. Owner deletes the category; the other
  member can leave; either can rename; uploader or owner deletes a photo.
- **Phase 4 — Chat**: per-friend DMs (text + emoji) → chat in shared
  categories → image messages (reuse Phase 3 uploads) → GIFs last (needs a
  Tenor/GIPHY API key).

## Dashboard setup (done once, by hand)

1. supabase.com → sign in with GitHub → New project (name `snapsort`).
2. Authentication → Sign In / Providers → Email → turn **off** "Confirm email".
3. SQL Editor → paste all of `schema.sql` → Run.
4. Project Settings → API → copy Project URL + anon public key into
   `js/config.js`.

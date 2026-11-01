-- Projects carry a manual "estimating" lifecycle status in the app
-- (src/utils/projects.js), but the production baseline only allowed
-- draft/active/completed/archived. The cloud writer therefore had to fold every
-- estimating project into "active", and a fresh-device restore brought it back
-- as Active. This widens the existing check by exactly that one value: no row is
-- rewritten, no other status is added or removed, and no grant or RLS policy
-- changes.
--
-- Apply this before shipping a client that persists "estimating"; until then
-- the database rejects that value.
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'estimating'::text, 'active'::text, 'completed'::text, 'archived'::text]));


-- Enums
CREATE TYPE public.deploy_target AS ENUM ('docker','process','ssh','cloud');
CREATE TYPE public.workspace_type AS ENUM ('none','pnpm','npm','yarn','rush','cargo','go','uv','elixir','maven','gradle','dotnet');
CREATE TYPE public.deploy_trigger AS ENUM ('git','manual','upload','url','cli','api','rollback');
CREATE TYPE public.deploy_phase AS ENUM ('queued','building','deploying','ready','failed','cancelled');
CREATE TYPE public.token_scope AS ENUM ('read','deploy','admin');
CREATE TYPE public.oauth_grant_type AS ENUM ('authorization_code','refresh_token','client_credentials');

-- Projects additions
ALTER TABLE public.projects
  ADD COLUMN target_type public.deploy_target NOT NULL DEFAULT 'docker',
  ADD COLUMN workspace_type public.workspace_type NOT NULL DEFAULT 'none',
  ADD COLUMN build_timeout_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN current_version text,
  ADD COLUMN ssh_host text,
  ADD COLUMN ssh_user text,
  ADD COLUMN git_provider text NOT NULL DEFAULT 'github',
  ADD COLUMN webhook_secret text;

-- Deployments additions
ALTER TABLE public.deployments
  ADD COLUMN environment public.env_scope NOT NULL DEFAULT 'production',
  ADD COLUMN trigger_type public.deploy_trigger NOT NULL DEFAULT 'manual',
  ADD COLUMN phase public.deploy_phase NOT NULL DEFAULT 'queued',
  ADD COLUMN version text,
  ADD COLUMN rollback_of uuid REFERENCES public.deployments(id) ON DELETE SET NULL,
  ADD COLUMN source_url text,
  ADD COLUMN artifact_url text;

-- Access tokens
CREATE TABLE public.access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_prefix text NOT NULL,
  token_hash text NOT NULL,
  scopes public.token_scope[] NOT NULL DEFAULT ARRAY['read']::public.token_scope[],
  project_grants uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_tokens TO authenticated;
GRANT ALL ON public.access_tokens TO service_role;
ALTER TABLE public.access_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tokens" ON public.access_tokens FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- OAuth clients (for MCP + OAuth 2.1 server)
CREATE TABLE public.oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL UNIQUE,
  client_secret_hash text,
  name text NOT NULL,
  description text,
  redirect_uris text[] NOT NULL DEFAULT ARRAY[]::text[],
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  is_mcp boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT false,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_clients TO authenticated;
GRANT ALL ON public.oauth_clients TO service_role;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own oauth clients" ON public.oauth_clients FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- OAuth grants (issued authorizations)
CREATE TABLE public.oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_type public.oauth_grant_type NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  refresh_token_hash text,
  revoked boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_grants TO authenticated;
GRANT ALL ON public.oauth_grants TO service_role;
ALTER TABLE public.oauth_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own grants" ON public.oauth_grants FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users revoke own grants" ON public.oauth_grants FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own grants" ON public.oauth_grants FOR DELETE
  USING (auth.uid() = user_id);
CREATE POLICY "System inserts grants" ON public.oauth_grants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Git webhook events log
CREATE TABLE public.git_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  ref text,
  commit_sha text,
  actor text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.git_webhooks TO authenticated;
GRANT ALL ON public.git_webhooks TO service_role;
ALTER TABLE public.git_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see webhooks of own projects" ON public.git_webhooks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = git_webhooks.project_id AND p.owner_id = auth.uid()));
CREATE POLICY "Users insert webhooks for own projects" ON public.git_webhooks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = git_webhooks.project_id AND p.owner_id = auth.uid()));

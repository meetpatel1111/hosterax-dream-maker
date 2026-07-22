
-- Enums
CREATE TYPE public.project_status AS ENUM ('active','building','failed','sleeping','archived');
CREATE TYPE public.deployment_status AS ENUM ('queued','building','deploying','success','failed','cancelled');
CREATE TYPE public.log_level AS ENUM ('info','warn','error','success','debug');
CREATE TYPE public.db_engine AS ENUM ('postgres','mysql','mongodb','redis');
CREATE TYPE public.db_status AS ENUM ('provisioning','running','stopped','failed');
CREATE TYPE public.env_scope AS ENUM ('production','preview','development');

-- Updated-at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile write" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- projects
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  repo_url TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  stack TEXT NOT NULL DEFAULT 'auto',
  region TEXT NOT NULL DEFAULT 'local',
  subdomain TEXT,
  status public.project_status NOT NULL DEFAULT 'active',
  root_dir TEXT DEFAULT '/',
  build_command TEXT,
  start_command TEXT,
  port INTEGER DEFAULT 3000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects" ON public.projects FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX projects_owner_idx ON public.projects(owner_id);

-- deployments
CREATE TABLE public.deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  commit_message TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  status public.deployment_status NOT NULL DEFAULT 'queued',
  duration_ms INTEGER,
  triggered_by UUID REFERENCES auth.users,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployments TO authenticated;
GRANT ALL ON public.deployments TO service_role;
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own deployments" ON public.deployments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));
CREATE INDEX deployments_project_idx ON public.deployments(project_id, created_at DESC);

-- deployment_logs
CREATE TABLE public.deployment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES public.deployments ON DELETE CASCADE,
  level public.log_level NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_logs TO authenticated;
GRANT ALL ON public.deployment_logs TO service_role;
ALTER TABLE public.deployment_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logs" ON public.deployment_logs FOR ALL
  USING (EXISTS (SELECT 1 FROM public.deployments d JOIN public.projects p ON p.id = d.project_id
                 WHERE d.id = deployment_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.deployments d JOIN public.projects p ON p.id = d.project_id
                 WHERE d.id = deployment_id AND p.owner_id = auth.uid()));
CREATE INDEX deployment_logs_dep_idx ON public.deployment_logs(deployment_id, created_at);

-- env_vars
CREATE TABLE public.env_vars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  environment public.env_scope NOT NULL DEFAULT 'production',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, environment, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.env_vars TO authenticated;
GRANT ALL ON public.env_vars TO service_role;
ALTER TABLE public.env_vars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own envs" ON public.env_vars FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));
CREATE TRIGGER env_vars_updated_at BEFORE UPDATE ON public.env_vars FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- databases
CREATE TABLE public.databases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  name TEXT NOT NULL,
  engine public.db_engine NOT NULL,
  status public.db_status NOT NULL DEFAULT 'provisioning',
  size_mb INTEGER NOT NULL DEFAULT 512,
  connection_string TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.databases TO authenticated;
GRANT ALL ON public.databases TO service_role;
ALTER TABLE public.databases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own dbs" ON public.databases FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

-- Realtime for live deployment logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.deployments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deployment_logs;

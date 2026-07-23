export type StackDef = { id: string; name: string; language: string; icon: string; build?: string; start?: string; port?: number };

export const STACKS: StackDef[] = [
  { id: "auto", name: "Auto-detect", language: "Any", icon: "✨" },
  // JavaScript / TypeScript
  { id: "node", name: "Node.js", language: "JavaScript", icon: "⬢", build: "npm install && npm run build", start: "npm start", port: 3000 },
  { id: "next", name: "Next.js", language: "JavaScript", icon: "▲", build: "next build", start: "next start", port: 3000 },
  { id: "nuxt", name: "Nuxt", language: "JavaScript", icon: "💚", build: "nuxt build", start: "node .output/server/index.mjs", port: 3000 },
  { id: "remix", name: "Remix", language: "JavaScript", icon: "💿", build: "remix build", start: "remix-serve build", port: 3000 },
  { id: "astro", name: "Astro", language: "JavaScript", icon: "🚀", build: "astro build", start: "node ./dist/server/entry.mjs", port: 4321 },
  { id: "vite", name: "Vite / React", language: "JavaScript", icon: "⚡", build: "npm run build", start: "npm run preview", port: 4173 },
  { id: "sveltekit", name: "SvelteKit", language: "JavaScript", icon: "🔥", build: "vite build", start: "node build", port: 3000 },
  { id: "bun", name: "Bun", language: "JavaScript", icon: "🥟", build: "bun install", start: "bun run start", port: 3000 },
  { id: "deno", name: "Deno", language: "JavaScript", icon: "🦕", build: "deno cache main.ts", start: "deno run --allow-net main.ts", port: 8000 },
  { id: "tanstack", name: "TanStack Start", language: "JavaScript", icon: "🌀", build: "vite build", start: "node .output/server/index.mjs", port: 3000 },
  // Go
  { id: "go", name: "Go", language: "Go", icon: "🐹", build: "go build -o app .", start: "./app", port: 8080 },
  { id: "gin", name: "Go / Gin", language: "Go", icon: "🍸", build: "go build -o app .", start: "./app", port: 8080 },
  { id: "echo", name: "Go / Echo", language: "Go", icon: "🔊", build: "go build -o app .", start: "./app", port: 8080 },
  // Rust
  { id: "rust", name: "Rust / Axum", language: "Rust", icon: "🦀", build: "cargo build --release", start: "./target/release/app", port: 8080 },
  { id: "actix", name: "Rust / Actix", language: "Rust", icon: "🕸️", build: "cargo build --release", start: "./target/release/app", port: 8080 },
  { id: "rocket", name: "Rust / Rocket", language: "Rust", icon: "🚀", build: "cargo build --release", start: "./target/release/app", port: 8000 },
  // Python
  { id: "python", name: "Python / FastAPI", language: "Python", icon: "🐍", build: "pip install -r requirements.txt", start: "uvicorn main:app --host 0.0.0.0 --port $PORT", port: 8000 },
  { id: "django", name: "Django", language: "Python", icon: "🎸", build: "pip install -r requirements.txt", start: "gunicorn app.wsgi", port: 8000 },
  { id: "flask", name: "Flask", language: "Python", icon: "🧪", build: "pip install -r requirements.txt", start: "gunicorn app:app", port: 8000 },
  { id: "streamlit", name: "Streamlit", language: "Python", icon: "🎈", build: "pip install -r requirements.txt", start: "streamlit run app.py", port: 8501 },
  // Ruby
  { id: "ruby", name: "Ruby on Rails", language: "Ruby", icon: "💎", build: "bundle install", start: "bundle exec rails s", port: 3000 },
  { id: "sinatra", name: "Sinatra", language: "Ruby", icon: "🎩", build: "bundle install", start: "ruby app.rb", port: 4567 },
  // PHP
  { id: "laravel", name: "Laravel", language: "PHP", icon: "🐘", build: "composer install --no-dev", start: "php artisan serve --host=0.0.0.0 --port=$PORT", port: 8000 },
  { id: "symfony", name: "Symfony", language: "PHP", icon: "🎼", build: "composer install --no-dev", start: "symfony server:start", port: 8000 },
  { id: "wordpress", name: "WordPress", language: "PHP", icon: "📝", build: "composer install", start: "php -S 0.0.0.0:$PORT", port: 8080 },
  // Java / Kotlin
  { id: "spring", name: "Spring Boot", language: "Java", icon: "☕", build: "./mvnw package", start: "java -jar target/*.jar", port: 8080 },
  { id: "quarkus", name: "Quarkus", language: "Java", icon: "⚛️", build: "./mvnw package -Pnative", start: "./target/*-runner", port: 8080 },
  { id: "kotlin", name: "Kotlin / Ktor", language: "Kotlin", icon: "🟣", build: "./gradlew build", start: "java -jar build/libs/*.jar", port: 8080 },
  // C# / .NET
  { id: "dotnet", name: ".NET", language: "C#", icon: "🔷", build: "dotnet publish -c Release", start: "dotnet run", port: 5000 },
  { id: "aspnet", name: "ASP.NET Core", language: "C#", icon: "🌐", build: "dotnet publish -c Release", start: "dotnet ./out/app.dll", port: 5000 },
  // Elixir
  { id: "elixir", name: "Elixir / Phoenix", language: "Elixir", icon: "💧", build: "mix deps.get && mix compile", start: "mix phx.server", port: 4000 },
  { id: "elixir-nerves", name: "Elixir / Nerves", language: "Elixir", icon: "🪷", build: "mix deps.get", start: "mix run --no-halt", port: 4000 },
  // Docker
  { id: "docker", name: "Dockerfile", language: "Docker", icon: "🐳", build: "docker build -t app .", start: "docker run -p $PORT:$PORT app", port: 8080 },
  { id: "compose", name: "Docker Compose", language: "Docker", icon: "📚", build: "docker compose build", start: "docker compose up", port: 8080 },
  // Static
  { id: "static", name: "Static HTML", language: "HTML", icon: "📄", build: "npm run build", start: "serve dist", port: 8080 },
  { id: "hugo", name: "Hugo", language: "Static", icon: "📰", build: "hugo --minify", start: "hugo server", port: 1313 },
  { id: "jekyll", name: "Jekyll", language: "Static", icon: "🪶", build: "bundle exec jekyll build", start: "bundle exec jekyll serve", port: 4000 },
  { id: "eleventy", name: "Eleventy", language: "Static", icon: "1️⃣1️⃣", build: "eleventy", start: "eleventy --serve", port: 8080 },
  // Generic
  { id: "bash", name: "Bash script", language: "Generic", icon: "🐚", build: "chmod +x start.sh", start: "./start.sh", port: 3000 },
  { id: "custom", name: "Custom", language: "Generic", icon: "🔧", build: "make build", start: "make start", port: 3000 },
];

export const WORKSPACES = [
  { id: "none",    name: "Single package",   icon: "📦" },
  { id: "pnpm",    name: "pnpm workspaces",  icon: "🅿️" },
  { id: "npm",     name: "npm/yarn workspaces", icon: "🅽" },
  { id: "yarn",    name: "Yarn Berry",       icon: "🧶" },
  { id: "rush",    name: "Rush",             icon: "🏃" },
  { id: "cargo",   name: "Cargo workspace",  icon: "🦀" },
  { id: "go",      name: "Go workspace",     icon: "🐹" },
  { id: "uv",      name: "uv (Python)",      icon: "🐍" },
  { id: "elixir",  name: "Elixir umbrella",  icon: "💧" },
  { id: "maven",   name: "Maven multi-module", icon: "☕" },
  { id: "gradle",  name: "Gradle multi-project", icon: "🐘" },
  { id: "dotnet",  name: ".NET solution",    icon: "🔷" },
] as const;

export const TARGETS = [
  { id: "docker",  name: "Docker container", desc: "Isolated container on the local Docker daemon", icon: "🐳" },
  { id: "process", name: "Bare process",     desc: "Direct process managed by HosteraX supervisor",   icon: "⚙️" },
  { id: "ssh",     name: "SSH remote",       desc: "Deploy over SSH to a remote server",              icon: "🔐" },
  { id: "cloud",   name: "HosteraX Cloud",   desc: "Managed cloud region (simulated)",                icon: "☁️" },
] as const;

export const ENVIRONMENTS = [
  { id: "production",  name: "Production",  icon: "🟢" },
  { id: "preview",     name: "Preview",     icon: "🟡" },
  { id: "development", name: "Development", icon: "🔵" },
] as const;

export const REGIONS = [
  { id: "local", name: "Local (this machine)", flag: "💻" },
  { id: "us-east", name: "US East · Virginia", flag: "🇺🇸" },
  { id: "us-west", name: "US West · Oregon", flag: "🇺🇸" },
  { id: "eu-west", name: "EU West · Frankfurt", flag: "🇩🇪" },
  { id: "ap-south", name: "Asia · Mumbai", flag: "🇮🇳" },
  { id: "ap-east", name: "Asia · Singapore", flag: "🇸🇬" },
];

export const APP_TEMPLATES = [
  { id: "n8n", name: "n8n", desc: "Workflow automation", icon: "🔗" },
  { id: "ghost", name: "Ghost", desc: "Publishing platform", icon: "👻" },
  { id: "directus", name: "Directus", desc: "Headless CMS", icon: "📦" },
  { id: "metabase", name: "Metabase", desc: "Business intelligence", icon: "📊" },
  { id: "gitea", name: "Gitea", desc: "Self-hosted git", icon: "🍵" },
  { id: "plausible", name: "Plausible", desc: "Privacy analytics", icon: "📈" },
];

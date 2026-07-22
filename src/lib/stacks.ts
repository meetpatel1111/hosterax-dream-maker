export type StackDef = { id: string; name: string; language: string; icon: string; build?: string; start?: string; port?: number };

export const STACKS: StackDef[] = [
  { id: "auto", name: "Auto-detect", language: "Any", icon: "✨" },
  { id: "node", name: "Node.js", language: "JavaScript", icon: "⬢", build: "npm install && npm run build", start: "npm start", port: 3000 },
  { id: "next", name: "Next.js", language: "JavaScript", icon: "▲", build: "next build", start: "next start", port: 3000 },
  { id: "vite", name: "Vite / React", language: "JavaScript", icon: "⚡", build: "npm run build", start: "npm run preview", port: 4173 },
  { id: "bun", name: "Bun", language: "JavaScript", icon: "🥟", build: "bun install", start: "bun run start", port: 3000 },
  { id: "python", name: "Python / FastAPI", language: "Python", icon: "🐍", build: "pip install -r requirements.txt", start: "uvicorn main:app --host 0.0.0.0 --port $PORT", port: 8000 },
  { id: "django", name: "Django", language: "Python", icon: "🎸", build: "pip install -r requirements.txt", start: "gunicorn app.wsgi", port: 8000 },
  { id: "go", name: "Go", language: "Go", icon: "🐹", build: "go build -o app .", start: "./app", port: 8080 },
  { id: "rust", name: "Rust / Axum", language: "Rust", icon: "🦀", build: "cargo build --release", start: "./target/release/app", port: 8080 },
  { id: "java", name: "Spring Boot", language: "Java", icon: "☕", build: "./mvnw package", start: "java -jar target/*.jar", port: 8080 },
  { id: "kotlin", name: "Kotlin / Ktor", language: "Kotlin", icon: "🟣", build: "./gradlew build", start: "java -jar build/libs/*.jar", port: 8080 },
  { id: "dotnet", name: ".NET", language: "C#", icon: "🔷", build: "dotnet publish -c Release", start: "dotnet run", port: 5000 },
  { id: "laravel", name: "Laravel / PHP", language: "PHP", icon: "🐘", build: "composer install --no-dev", start: "php artisan serve --host=0.0.0.0 --port=$PORT", port: 8000 },
  { id: "ruby", name: "Ruby on Rails", language: "Ruby", icon: "💎", build: "bundle install", start: "bundle exec rails s", port: 3000 },
  { id: "static", name: "Static site", language: "HTML", icon: "📄", build: "npm run build", start: "serve dist", port: 8080 },
];

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

// Generated from the Openship stack registry + detector rules (oblien/openship:
// packages/core/src/stacks.ts + apps/api/src/lib/stack-detector.ts).
// 42 stacks across 10 languages, priority-ordered detection with manifest-dep gates.
import fs from "node:fs";
import path from "node:path";
import { EXTRA_STACKS, EXTRA_ORDER, EXTRA_PACKAGE_MANAGERS } from "./stack-registry-extra.mjs";

const BASE_STACK_REGISTRY = {
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    language: "typescript",
    category: "fullstack",
    icon: "▲",
    port: 3000,
    build: "next build",
    start: "next start",
    outputDir: ".next",
    rootMarkers: ["next.config.js", "next.config.mjs", "next.config.ts"],
    deps: ["next"],
  },
  nuxt: {
    id: "nuxt",
    name: "Nuxt",
    language: "typescript",
    category: "fullstack",
    icon: "💚",
    port: 3000,
    build: "nuxt build",
    start: "node .output/server/index.mjs",
    outputDir: ".output",
    rootMarkers: ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs"],
    deps: ["nuxt", "@nuxt/core"],
  },
  sveltekit: {
    id: "sveltekit",
    name: "SvelteKit",
    language: "typescript",
    category: "fullstack",
    icon: "🔥",
    port: 3000,
    build: "vite build",
    start: "node build/index.js",
    outputDir: ".svelte-kit",
    rootMarkers: ["svelte.config.js", "svelte.config.mjs"],
    deps: ["svelte", "@sveltejs/kit"],
  },
  astro: {
    id: "astro",
    name: "Astro",
    language: "typescript",
    category: "frontend",
    icon: "🚀",
    port: 4321,
    build: "astro build",
    start: "node dist/server/entry.mjs",
    outputDir: "dist",
    rootMarkers: ["astro.config.mjs", "astro.config.js", "astro.config.ts"],
    deps: ["astro"],
  },
  remix: {
    id: "remix",
    name: "Remix",
    language: "typescript",
    category: "fullstack",
    icon: "💿",
    port: 3000,
    build: "remix build",
    start: "remix-serve build/index.js",
    outputDir: "build",
    rootMarkers: ["remix.config.js", "remix.config.ts"],
    deps: ["@remix-run/react", "@remix-run/node", "remix"],
  },
  "tanstack-start": {
    id: "tanstack-start",
    name: "TanStack Start",
    language: "typescript",
    category: "fullstack",
    icon: "🌀",
    port: 3000,
    build: "vite build",
    start: "node .output/server/index.mjs",
    outputDir: ".output",
    rootMarkers: [
      "app.config.ts",
      "app.config.js",
      "app.config.mjs",
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mjs",
      "rsbuild.config.ts",
      "rsbuild.config.js",
      "rsbuild.config.mjs",
    ],
    deps: ["@tanstack/react-start", "@tanstack/start"],
  },
  angular: {
    id: "angular",
    name: "Angular",
    language: "typescript",
    category: "frontend",
    icon: "🅰️",
    port: 4200,
    build: "ng build --configuration production",
    start: null,
    outputDir: "dist",
    rootMarkers: ["angular.json"],
    deps: ["@angular/core"],
  },
  gatsby: {
    id: "gatsby",
    name: "Gatsby",
    language: "javascript",
    category: "frontend",
    icon: "🟣",
    port: 8000,
    build: "gatsby build",
    start: "gatsby serve",
    outputDir: "public",
    rootMarkers: ["gatsby-config.js", "gatsby-config.ts"],
    deps: ["gatsby"],
  },
  vite: {
    id: "vite",
    name: "Vite",
    language: "typescript",
    category: "frontend",
    icon: "⚡",
    port: 5173,
    build: "vite build",
    start: null,
    outputDir: "dist",
    rootMarkers: ["vite.config.js", "vite.config.ts", "vite.config.mjs"],
    deps: ["vite"],
  },
  cra: {
    id: "cra",
    name: "Create React App",
    language: "javascript",
    category: "frontend",
    icon: "⚛️",
    port: 3000,
    build: "react-scripts build",
    start: null,
    outputDir: "build",
    rootMarkers: [],
    deps: ["react-scripts"],
  },
  vue: {
    id: "vue",
    name: "Vue CLI",
    language: "javascript",
    category: "frontend",
    icon: "🟩",
    port: 8080,
    build: "vue-cli-service build",
    start: null,
    outputDir: "dist",
    rootMarkers: ["vue.config.js", "vue.config.ts"],
    deps: ["vue"],
  },
  nestjs: {
    id: "nestjs",
    name: "NestJS",
    language: "typescript",
    category: "backend",
    icon: "🐱",
    port: 3000,
    build: "nest build",
    start: "node dist/main.js",
    outputDir: "dist",
    rootMarkers: ["nest-cli.json"],
    deps: ["@nestjs/core"],
  },
  adonis: {
    id: "adonis",
    name: "AdonisJS",
    language: "typescript",
    category: "fullstack",
    icon: "🟪",
    port: 3333,
    build: "node ace build --production",
    start: "node build/server.js",
    outputDir: "build",
    rootMarkers: ["ace.js", ".adonisrc.json", "adonisrc.ts"],
    deps: ["@adonisjs/core"],
  },
  elysia: {
    id: "elysia",
    name: "Elysia",
    language: "typescript",
    category: "backend",
    icon: "🦊",
    port: 3000,
    build: null,
    start: "bun dist/index.js",
    outputDir: "dist",
    rootMarkers: [],
    deps: ["elysia"],
  },
  hono: {
    id: "hono",
    name: "Hono",
    language: "typescript",
    category: "backend",
    icon: "🔥",
    port: 3000,
    build: null,
    start: "node dist/index.js",
    outputDir: "dist",
    rootMarkers: [],
    deps: ["hono"],
  },
  fastify: {
    id: "fastify",
    name: "Fastify",
    language: "typescript",
    category: "backend",
    icon: "🚀",
    port: 3000,
    build: null,
    start: "node dist/index.js",
    outputDir: "dist",
    rootMarkers: [],
    deps: ["fastify"],
  },
  koa: {
    id: "koa",
    name: "Koa",
    language: "javascript",
    category: "backend",
    icon: "🌿",
    port: 3000,
    build: null,
    start: "node index.js",
    outputDir: "dist",
    rootMarkers: [],
    deps: ["koa"],
  },
  express: {
    id: "express",
    name: "Express",
    language: "javascript",
    category: "backend",
    icon: "🚏",
    port: 3000,
    build: null,
    start: "node index.js",
    outputDir: "dist",
    rootMarkers: [],
    deps: ["express"],
  },
  django: {
    id: "django",
    name: "Django",
    language: "python",
    category: "fullstack",
    icon: "🎸",
    port: 8000,
    build: "pip install -r requirements.txt && python manage.py collectstatic --noinput",
    start: "gunicorn config.wsgi:application --bind 0.0.0.0:8000",
    outputDir: ".",
    rootMarkers: ["manage.py"],
    deps: [],
  },
  flask: {
    id: "flask",
    name: "Flask",
    language: "python",
    category: "backend",
    icon: "🧪",
    port: 5000,
    build: "pip install -r requirements.txt",
    start: "gunicorn app:app --bind 0.0.0.0:5000",
    outputDir: ".",
    rootMarkers: ["requirements.txt", "pyproject.toml", "Pipfile"],
    deps: ["flask", "Flask"],
  },
  fastapi: {
    id: "fastapi",
    name: "FastAPI",
    language: "python",
    category: "backend",
    icon: "⚡",
    port: 8000,
    build: "pip install -r requirements.txt",
    start: "uvicorn main:app --host 0.0.0.0 --port 8000",
    outputDir: ".",
    rootMarkers: ["requirements.txt", "pyproject.toml", "Pipfile"],
    deps: ["fastapi", "FastAPI"],
  },
  gin: {
    id: "gin",
    name: "Gin",
    language: "go",
    category: "backend",
    icon: "🍸",
    port: 8080,
    build: "go build -o app .",
    start: "./app",
    outputDir: ".",
    rootMarkers: ["go.mod"],
    deps: ["github.com/gin-gonic/gin"],
  },
  fiber: {
    id: "fiber",
    name: "Fiber",
    language: "go",
    category: "backend",
    icon: "🧵",
    port: 3000,
    build: "go build -o app .",
    start: "./app",
    outputDir: ".",
    rootMarkers: ["go.mod"],
    deps: ["github.com/gofiber/fiber"],
  },
  echo: {
    id: "echo",
    name: "Echo",
    language: "go",
    category: "backend",
    icon: "🔊",
    port: 8080,
    build: "go build -o app .",
    start: "./app",
    outputDir: ".",
    rootMarkers: ["go.mod"],
    deps: ["github.com/labstack/echo"],
  },
  go: {
    id: "go",
    name: "Go",
    language: "go",
    category: "backend",
    icon: "🐹",
    port: 8080,
    build: "go build -o app .",
    start: "./app",
    outputDir: ".",
    rootMarkers: ["go.mod"],
    deps: [],
  },
  actix: {
    id: "actix",
    name: "Actix Web",
    language: "rust",
    category: "backend",
    icon: "🕸️",
    port: 8080,
    build: "cargo build --release",
    start: "./target/release/app",
    outputDir: "target/release",
    rootMarkers: ["Cargo.toml"],
    deps: ["actix-web"],
  },
  axum: {
    id: "axum",
    name: "Axum",
    language: "rust",
    category: "backend",
    icon: "🪓",
    port: 3000,
    build: "cargo build --release",
    start: "./target/release/app",
    outputDir: "target/release",
    rootMarkers: ["Cargo.toml"],
    deps: ["axum"],
  },
  rocket: {
    id: "rocket",
    name: "Rocket",
    language: "rust",
    category: "backend",
    icon: "🚀",
    port: 8000,
    build: "cargo build --release",
    start: "./target/release/app",
    outputDir: "target/release",
    rootMarkers: ["Cargo.toml"],
    deps: ["rocket"],
  },
  rust: {
    id: "rust",
    name: "Rust",
    language: "rust",
    category: "backend",
    icon: "🦀",
    port: 8080,
    build: "cargo build --release",
    start: "./target/release/app",
    outputDir: "target/release",
    rootMarkers: ["Cargo.toml"],
    deps: [],
  },
  rails: {
    id: "rails",
    name: "Ruby on Rails",
    language: "ruby",
    category: "fullstack",
    icon: "💎",
    port: 3000,
    build: "bundle install && bundle exec rails assets:precompile",
    start: "bundle exec rails server -b 0.0.0.0",
    outputDir: ".",
    rootMarkers: ["Gemfile", "bin/rails", "config/routes.rb"],
    deps: [],
  },
  sinatra: {
    id: "sinatra",
    name: "Sinatra",
    language: "ruby",
    category: "backend",
    icon: "🎩",
    port: 4567,
    build: "bundle install",
    start: "ruby app.rb",
    outputDir: ".",
    rootMarkers: ["Gemfile"],
    deps: ["sinatra"],
  },
  laravel: {
    id: "laravel",
    name: "Laravel",
    language: "php",
    category: "fullstack",
    icon: "🐘",
    port: 8000,
    build: "composer install --no-dev --optimize-autoloader",
    start: "php artisan serve --host=0.0.0.0 --port=$PORT",
    outputDir: "public",
    rootMarkers: ["artisan", "composer.json"],
    deps: ["laravel/framework"],
  },
  symfony: {
    id: "symfony",
    name: "Symfony",
    language: "php",
    category: "fullstack",
    icon: "🎼",
    port: 8000,
    build: "composer install --no-dev --optimize-autoloader",
    start: "php -S 0.0.0.0:$PORT -t public",
    outputDir: "public",
    rootMarkers: ["composer.json", "symfony.lock"],
    deps: ["symfony/framework-bundle"],
  },
  springboot: {
    id: "springboot",
    name: "Spring Boot",
    language: "java",
    category: "backend",
    icon: "☕",
    port: 8080,
    build: "mvn clean package -DskipTests",
    start: "java -jar target/*.jar",
    outputDir: "target",
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts"],
    deps: ["org.springframework.boot:spring-boot-starter-web", "spring-boot"],
  },
  quarkus: {
    id: "quarkus",
    name: "Quarkus",
    language: "java",
    category: "backend",
    icon: "⚛️",
    port: 8080,
    build: "mvn clean package -DskipTests",
    start: "java -jar target/quarkus-app/quarkus-run.jar",
    outputDir: "target",
    rootMarkers: ["pom.xml", "build.gradle", "build.gradle.kts"],
    deps: ["io.quarkus:quarkus-core", "quarkus"],
  },
  kotlin: {
    id: "kotlin",
    name: "Kotlin",
    language: "java",
    category: "backend",
    icon: "🟣",
    port: 8080,
    build: "gradle build -x test",
    start: "java -jar build/libs/*.jar",
    outputDir: "build/libs",
    rootMarkers: ["build.gradle.kts", "build.gradle"],
    deps: [],
  },
  blazor: {
    id: "blazor",
    name: "Blazor",
    language: "csharp",
    category: "static",
    icon: "🔥",
    port: 5000,
    build: "dotnet publish -c Release -o publish",
    start: null,
    outputDir: "publish/wwwroot",
    rootMarkers: [],
    deps: ["Microsoft.AspNetCore.Components.WebAssembly"],
  },
  dotnet: {
    id: "dotnet",
    name: ".NET",
    language: "csharp",
    category: "backend",
    icon: "🔷",
    port: 5000,
    build: "dotnet publish -c Release -o publish",
    start: "ASPNETCORE_URLS=http://0.0.0.0:$PORT dotnet publish/app.dll",
    outputDir: "publish",
    rootMarkers: [],
    deps: [],
  },
  phoenix: {
    id: "phoenix",
    name: "Phoenix",
    language: "elixir",
    category: "fullstack",
    icon: "💧",
    port: 4000,
    build: "MIX_ENV=prod mix do deps.get, compile, assets.deploy, release",
    start: "_build/prod/rel/app/bin/app start",
    outputDir: "_build/prod/rel",
    rootMarkers: ["mix.exs"],
    deps: ["phoenix"],
  },
  python: {
    id: "python",
    name: "Python",
    language: "python",
    category: "backend",
    icon: "🐍",
    port: 8000,
    build: "pip install -r requirements.txt",
    start: "python app.py",
    outputDir: ".",
    rootMarkers: ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"],
    deps: [],
  },
  "docker-compose": {
    id: "docker-compose",
    name: "Docker Compose",
    language: "multi",
    category: "services",
    icon: "📚",
    port: 3000,
    build: null,
    start: null,
    outputDir: ".",
    rootMarkers: ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],
    deps: [],
  },
  docker: {
    id: "docker",
    name: "Dockerfile",
    language: "multi",
    category: "docker",
    icon: "🐳",
    port: 3000,
    build: null,
    start: null,
    outputDir: ".",
    rootMarkers: ["Dockerfile"],
    deps: [],
  },
  static: {
    id: "static",
    name: "Static Site",
    language: "multi",
    category: "static",
    icon: "📄",
    port: 3000,
    build: null,
    start: null,
    outputDir: ".",
    rootMarkers: ["index.html"],
    deps: [],
  },
  node: {
    id: "node",
    name: "Node.js",
    language: "javascript",
    category: "backend",
    icon: "⬢",
    port: 3000,
    build: null,
    start: "node index.js",
    outputDir: "dist",
    rootMarkers: ["package.json"],
    deps: [],
  },
};

export const STACK_REGISTRY = { ...BASE_STACK_REGISTRY, ...EXTRA_STACKS };

const BASE_STACK_ORDER = [
  "nextjs",
  "nuxt",
  "sveltekit",
  "astro",
  "remix",
  "tanstack-start",
  "angular",
  "gatsby",
  "vite",
  "cra",
  "vue",
  "nestjs",
  "adonis",
  "elysia",
  "hono",
  "fastify",
  "koa",
  "express",
  "django",
  "flask",
  "fastapi",
  "gin",
  "fiber",
  "echo",
  "go",
  "actix",
  "axum",
  "rocket",
  "rust",
  "rails",
  "sinatra",
  "laravel",
  "symfony",
  "springboot",
  "quarkus",
  "kotlin",
  "blazor",
  "dotnet",
  "phoenix",
  "python",
  "docker-compose",
  "docker",
  "static",
  "node",
];

/** Merge the extended matrix into the priority order at the right slots. */
function buildOrder() {
  const out = [];
  for (const id of BASE_STACK_ORDER) {
    if (id === "vite") out.push(...EXTRA_ORDER.beforeFrontend);
    if (id === "nestjs") out.push(...EXTRA_ORDER.beforeBackendJs);
    if (id === "django") out.push(...EXTRA_ORDER.beforeLanguages);
    out.push(id);
  }
  out.push(...EXTRA_ORDER.tail);
  return out.filter((id, i) => STACK_REGISTRY[id] && out.indexOf(id) === i);
}

export const STACK_ORDER = buildOrder();

export const STACK_LANGUAGES = [
  ...new Set(Object.values(STACK_REGISTRY).map((s) => s.language)),
].sort();

const BACKEND_MARKERS = ["composer.json", "artisan", "manage.py", "gemfile", "mix.exs"];

export function detectPackageManager(files) {
  const has = (f) => files.has(f.toLowerCase());
  if (has("go.mod")) return "go";
  if (has("cargo.toml")) return "cargo";
  if (has("pyproject.toml")) return "uv";
  if (has("pipfile")) return "pipenv";
  if (has("requirements.txt")) return "pip";
  if (has("gemfile")) return "bundler";
  if (has("composer.json")) return "composer";
  if (has("pom.xml")) return "maven";
  if (has("build.gradle") || has("build.gradle.kts")) return "gradle";
  if (has("mix.exs")) return "mix";
  if ([...files].some((f) => f.endsWith(".csproj") || f.endsWith(".fsproj") || f.endsWith(".sln")))
    return "dotnet";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("bun.lockb") || has("bun.lock")) return "bun";
  if (has("package-lock.json")) return "npm";
  if (has("yarn.lock")) return "yarn";
  if (has("package.json")) return "npm";
  for (const [marker, pm] of EXTRA_PACKAGE_MANAGERS) if (has(marker)) return pm;
  return "none";
}

export const WORKSPACE_DETECTORS = [
  { id: "pnpm", label: "pnpm workspaces", markers: ["pnpm-workspace.yaml", ".pnpmfile.cjs"] },
  { id: "yarn", label: "Yarn Berry", markers: [".yarnrc.yml", ".yarnrc"] },
  { id: "rush", label: "Rush", markers: ["rush.json"] },
  { id: "cargo", label: "Cargo workspace", markers: ["Cargo.toml"], content: /\[workspace\]/ },
  { id: "go", label: "Go workspace", markers: ["go.work"] },
  { id: "uv", label: "uv (Python)", markers: ["uv.lock"] },
  { id: "elixir", label: "Elixir umbrella", markers: ["mix.exs"], content: /apps_path/ },
  { id: "maven", label: "Maven multi-module", markers: ["pom.xml"], content: /<modules>/ },
  {
    id: "gradle",
    label: "Gradle multi-project",
    markers: ["settings.gradle", "settings.gradle.kts"],
  },
  { id: "dotnet", label: ".NET solution", markers: [], glob: /\.sln$/ },
  { id: "npm", label: "npm/yarn workspaces", markers: ["package.json"], content: /"workspaces"/ },
];

/** Read every dependency-ish token out of the manifests we can parse. */
function readDeps(dir, files) {
  const deps = {};
  const add = (k) => {
    if (k) deps[k] = "*";
  };
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  if (files.has("package.json")) {
    try {
      const pkg = JSON.parse(read("package.json"));
      for (const k of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) add(k);
    } catch {}
  }
  if (files.has("go.mod"))
    for (const l of read("go.mod").split(/\r?\n/)) {
      const t = l
        .trim()
        .replace(/^require\s+/, "")
        .split(/\s+/)[0];
      if (t && /^[a-z0-9.\-]+\//.test(t)) add(t);
    }
  if (files.has("cargo.toml")) {
    let inDeps = false;
    for (const l of read("Cargo.toml").split(/\r?\n/)) {
      if (/^\[/.test(l.trim())) {
        inDeps = /dependencies\]/.test(l);
        continue;
      }
      if (inDeps) add(l.split("=")[0].trim());
    }
  }
  for (const f of ["requirements.txt", "Pipfile", "pyproject.toml"])
    if (files.has(f.toLowerCase()))
      for (const l of read(f).split(/\r?\n/))
        add(
          l
            .trim()
            .split(/[=<>!~\[ ;#]/)[0]
            .replace(/^"|"$/g, ""),
        );
  if (files.has("gemfile"))
    for (const l of read("Gemfile").split(/\r?\n/)) {
      const mm = l.match(/gem\s+["']([^"']+)/);
      if (mm) add(mm[1]);
    }
  if (files.has("composer.json")) {
    try {
      const c = JSON.parse(read("composer.json"));
      for (const k of Object.keys({ ...c.require, ...c["require-dev"] })) add(k);
    } catch {}
  }
  if (files.has("pom.xml")) {
    const x = read("pom.xml");
    for (const mm of x.matchAll(/<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)</g)) {
      add(mm[1] + ":" + mm[2]);
      add(mm[2]);
    }
  }
  for (const f of ["build.gradle", "build.gradle.kts"])
    if (files.has(f)) {
      for (const mm of read(f).matchAll(/["']([a-z0-9.\-]+):([a-z0-9.\-]+)/gi)) {
        add(mm[1] + ":" + mm[2]);
        add(mm[2]);
      }
    }
  if (files.has("mix.exs"))
    for (const mm of read("mix.exs").matchAll(/\{:([a-z_0-9]+)/g)) add(mm[1]);
  for (const f of files)
    if (f.endsWith(".csproj") || f.endsWith(".fsproj"))
      for (const mm of read(f).matchAll(/PackageReference\s+Include="([^"]+)"/g)) add(mm[1]);
  return deps;
}

/** Shallow-recursive extension probe (Kotlin sources live under src/main/kotlin). */
function hasExt(dir, ext, depth = 4) {
  const walk = (d, lvl) => {
    if (lvl > depth) return false;
    let names = [];
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of names) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      if (e.isFile() && e.name.endsWith(ext)) return true;
      if (e.isDirectory() && walk(path.join(d, e.name), lvl + 1)) return true;
    }
    return false;
  };
  return walk(dir, 0);
}

function listFiles(dir) {
  const out = new Set();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) out.add(n.toLowerCase());
  for (const sub of ["config", "bin", "src", "lib", "app"]) {
    try {
      for (const n of fs.readdirSync(path.join(dir, sub))) out.add((sub + "/" + n).toLowerCase());
    } catch {}
  }
  return out;
}

/**
 * Zero-config stack detection. Mirrors Openship rule order: fullstack/frontend
 * JS first (a Next.js app also has express in transitive deps), then backend JS,
 * then per-language frameworks, then generic catch-alls.
 */
export function detectStackDir(dir) {
  const files = listFiles(dir);
  const deps = readDeps(dir, files);
  const has = (f) => files.has(f.toLowerCase());
  const hasBackendMarker = () => BACKEND_MARKERS.some(has);
  const markerHit = (s) => s.rootMarkers.some(has);
  const depHit = (s) =>
    s.deps.some((d) => deps[d] || Object.keys(deps).some((k) => k.startsWith(d)));

  for (const id of STACK_ORDER) {
    const s = STACK_REGISTRY[id];
    let fileMatch = s.rootMarkers.length === 0 || markerHit(s);
    let depMatch = s.deps.length === 0 || depHit(s);

    switch (id) {
      case "vite":
        fileMatch = markerHit(s) && !hasBackendMarker();
        break;
      case "cra":
        fileMatch = has("package.json");
        break;
      case "vue":
        depMatch = !!deps["vue"] && !deps["nuxt"];
        break;
      case "elysia":
      case "hono":
      case "fastify":
      case "koa":
      case "express":
        fileMatch = has("package.json");
        break;
      case "rails":
        fileMatch = has("gemfile") && (has("config/routes.rb") || has("bin/rails"));
        break;
      case "symfony":
        fileMatch = has("composer.json") && has("symfony.lock");
        break;
      case "phoenix":
        fileMatch = has("mix.exs") && (has("lib") || has("config/config.exs"));
        break;
      case "kotlin":
        fileMatch = has("build.gradle.kts") || (markerHit(s) && hasExt(dir, ".kt"));
        break;
      case "blazor":
      case "dotnet":
        fileMatch = [...files].some(
          (f) => f.endsWith(".csproj") || f.endsWith(".fsproj") || f.endsWith(".sln"),
        );
        break;
      case "static":
        fileMatch = has("index.html") && !has("package.json");
        break;
      case "node":
        fileMatch = has("package.json") || has("server.js") || has("app.js") || has("index.js");
        break;
      default:
        break;
    }
    if (fileMatch && depMatch) {
      const pm = detectPackageManager(files);
      return {
        id,
        ...s,
        stack: s.name,
        marker: s.rootMarkers.find(has) ?? null,
        packageManager: pm,
        install: pm === "none" || !has("package.json") ? null : pm + " install",
        workspace: detectWorkspace(dir, files),
      };
    }
  }
  return {
    id: "unknown",
    name: "Unknown",
    stack: "custom",
    language: "multi",
    category: "generic",
    icon: "🔧",
    port: null,
    build: null,
    start: null,
    outputDir: null,
    rootMarkers: [],
    deps: [],
    marker: null,
    packageManager: detectPackageManager(files),
    install: null,
    workspace: detectWorkspace(dir, files),
  };
}

export function detectWorkspace(dir, files = listFiles(dir)) {
  for (const w of WORKSPACE_DETECTORS) {
    if (w.glob && [...files].some((f) => w.glob.test(f))) return w;
    const hit = w.markers.find((mk) => files.has(mk.toLowerCase()));
    if (!hit) continue;
    if (w.content) {
      try {
        if (!w.content.test(fs.readFileSync(path.join(dir, hit), "utf8"))) continue;
      } catch {
        continue;
      }
    }
    return w;
  }
  return null;
}

/** Legacy shape kept for callers that expect {file, stack, build, start, port}. */
export const DETECTORS = STACK_ORDER.flatMap((id) => {
  const s = STACK_REGISTRY[id];
  return s.rootMarkers.map((file) => ({
    file,
    stack: s.name,
    build: s.build,
    start: s.start,
    port: s.port,
  }));
});

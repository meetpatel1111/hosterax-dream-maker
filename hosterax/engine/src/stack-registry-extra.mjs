// Extended stack matrix for HosteraX core detection.
// Adds frameworks + languages beyond the base registry.
// Every entry follows the same shape as STACK_REGISTRY in ./stack-registry.mjs.

const s = (id, name, language, category, icon, port, build, start, outputDir, rootMarkers, deps = []) => [
  id,
  { id, name, language, category, icon, port, build, start, outputDir, rootMarkers, deps },
];

export const EXTRA_STACKS = Object.fromEntries([
  // ---------- JavaScript / TypeScript ----------
  s("solidstart", "SolidStart", "typescript", "fullstack", "🔷", 3000, "vinxi build", "node .output/server/index.mjs", ".output", ["app.config.ts", "vite.config.ts"], ["@solidjs/start", "solid-start"]),
  s("qwik", "Qwik City", "typescript", "fullstack", "⚡️", 3000, "npm run build", "node server/entry.express", "dist", ["vite.config.ts"], ["@builder.io/qwik-city", "@builder.io/qwik"]),
  s("redwood", "RedwoodJS", "typescript", "fullstack", "🌲", 8910, "yarn rw build", "yarn rw serve", "web/dist", ["redwood.toml"], ["@redwoodjs/core"]),
  s("nx", "Nx Workspace", "typescript", "fullstack", "🅧", 3000, "nx build", "nx serve", "dist", ["nx.json"], ["nx", "@nx/workspace"]),
  s("docusaurus", "Docusaurus", "typescript", "static", "🦖", 3000, "docusaurus build", "docusaurus serve --port 3000", "build", ["docusaurus.config.js", "docusaurus.config.ts"], ["@docusaurus/core"]),
  s("vitepress", "VitePress", "typescript", "static", "📘", 4173, "vitepress build docs", "vitepress preview docs", "docs/.vitepress/dist", ["docs/.vitepress/config.ts", "package.json"], ["vitepress"]),
  s("nuxt-content", "Nuxt Content", "typescript", "static", "📗", 3000, "nuxt build", "node .output/server/index.mjs", ".output", ["nuxt.config.ts"], ["@nuxt/content"]),
  s("medusa", "Medusa", "typescript", "backend", "🛒", 9000, "medusa build", "medusa start", ".medusa", ["medusa-config.js", "medusa-config.ts"], ["@medusajs/medusa"]),
  s("strapi", "Strapi", "typescript", "backend", "🧩", 1337, "strapi build", "strapi start", "build", ["config/server.js", "config/server.ts", "package.json"], ["@strapi/strapi"]),
  s("payload", "Payload CMS", "typescript", "backend", "📦", 3000, "payload build", "node dist/server.js", "dist", ["payload.config.ts", "payload.config.js"], ["payload"]),
  s("keystone", "Keystone 6", "typescript", "backend", "🗝️", 3000, "keystone build", "keystone start", ".keystone", ["keystone.ts"], ["@keystone-6/core"]),
  s("meteor", "Meteor", "javascript", "fullstack", "☄️", 3000, "meteor build ../output --directory", "meteor run", ".meteor", [".meteor/release"], ["meteor-node-stubs"]),
  s("sails", "Sails.js", "javascript", "backend", "⛵", 1337, null, "sails lift", ".tmp", ["config/env", ".sailsrc"], ["sails"]),
  s("feathers", "FeathersJS", "typescript", "backend", "🪶", 3030, "npm run compile", "node lib/index.js", "lib", ["package.json"], ["@feathersjs/feathers"]),
  s("hapi", "hapi", "javascript", "backend", "🎩", 3000, null, "node server.js", "dist", ["package.json"], ["@hapi/hapi", "hapi"]),
  s("fresh", "Fresh (Deno)", "typescript", "fullstack", "🍋", 8000, "deno task build", "deno task start", "_fresh", ["fresh.config.ts", "deno.json", "deno.jsonc"], ["$fresh"]),
  s("deno", "Deno", "typescript", "backend", "🦕", 8000, null, "deno run -A main.ts", "dist", ["deno.json", "deno.jsonc", "deno.lock"], []),
  s("bun", "Bun", "typescript", "backend", "🥟", 3000, "bun install", "bun run index.ts", "dist", ["bunfig.toml", "bun.lockb", "bun.lock"], []),
  s("electron", "Electron", "typescript", "desktop", "🖥️", 0, "npm run build", "electron .", "dist", ["package.json"], ["electron"]),
  s("expo", "Expo / React Native Web", "typescript", "frontend", "📱", 8081, "expo export --platform web", "npx serve dist", "dist", ["app.json", "app.config.js"], ["expo"]),

  // ---------- Python ----------
  s("streamlit", "Streamlit", "python", "frontend", "📊", 8501, null, "streamlit run app.py --server.port 8501 --server.address 0.0.0.0", null, ["requirements.txt", "pyproject.toml"], ["streamlit"]),
  s("gradio", "Gradio", "python", "frontend", "🎛️", 7860, null, "python app.py", null, ["requirements.txt", "pyproject.toml"], ["gradio"]),
  s("litestar", "Litestar", "python", "backend", "🌟", 8000, null, "litestar run --host 0.0.0.0 --port 8000", null, ["requirements.txt", "pyproject.toml"], ["litestar", "starlite"]),
  s("sanic", "Sanic", "python", "backend", "💨", 8000, null, "sanic server:app --host 0.0.0.0 --port 8000", null, ["requirements.txt", "pyproject.toml"], ["sanic"]),
  s("tornado", "Tornado", "python", "backend", "🌪️", 8888, null, "python main.py", null, ["requirements.txt", "pyproject.toml"], ["tornado"]),
  s("aiohttp", "aiohttp", "python", "backend", "🐍", 8080, null, "python main.py", null, ["requirements.txt", "pyproject.toml"], ["aiohttp"]),
  s("bottle", "Bottle", "python", "backend", "🍶", 8080, null, "python app.py", null, ["requirements.txt", "pyproject.toml"], ["bottle"]),
  s("pyramid", "Pyramid", "python", "backend", "🔺", 6543, null, "pserve production.ini", null, ["production.ini", "development.ini"], ["pyramid"]),
  s("dash", "Dash / Plotly", "python", "frontend", "📈", 8050, null, "python app.py", null, ["requirements.txt", "pyproject.toml"], ["dash"]),
  s("airflow", "Apache Airflow", "python", "backend", "🌬️", 8080, null, "airflow standalone", null, ["airflow.cfg", "dags"], ["apache-airflow"]),

  // ---------- Go ----------
  s("chi", "Chi", "go", "backend", "🐹", 8080, "go build -o app ./...", "./app", "app", ["go.mod"], ["github.com/go-chi/chi"]),
  s("beego", "Beego", "go", "backend", "🐝", 8080, "go build -o app ./...", "./app", "app", ["go.mod"], ["github.com/beego/beego"]),
  s("buffalo", "Buffalo", "go", "fullstack", "🦬", 3000, "buffalo build", "./bin/app", "bin", ["go.mod"], ["github.com/gobuffalo/buffalo"]),
  s("hugo", "Hugo", "go", "static", "🔷", 1313, "hugo --minify", "hugo server --bind 0.0.0.0 --port 1313", "public", ["hugo.toml", "hugo.yaml", "config.toml"], []),

  // ---------- Rust ----------
  s("warp", "Warp", "rust", "backend", "🕸️", 3030, "cargo build --release", "./target/release/app", "target/release", ["Cargo.toml"], ["warp"]),
  s("poem", "Poem", "rust", "backend", "📝", 3000, "cargo build --release", "./target/release/app", "target/release", ["Cargo.toml"], ["poem"]),
  s("tide", "Tide", "rust", "backend", "🌊", 8080, "cargo build --release", "./target/release/app", "target/release", ["Cargo.toml"], ["tide"]),
  s("leptos", "Leptos", "rust", "fullstack", "🦀", 3000, "cargo leptos build --release", "./target/release/app", "target", ["Cargo.toml"], ["leptos"]),
  s("dioxus", "Dioxus", "rust", "frontend", "🧬", 8080, "dx build --release", "dx serve", "dist", ["Dioxus.toml", "Cargo.toml"], ["dioxus"]),
  s("trunk", "Trunk (Rust WASM)", "rust", "frontend", "📦", 8080, "trunk build --release", null, "dist", ["Trunk.toml"], []),

  // ---------- Ruby ----------
  s("hanami", "Hanami", "ruby", "backend", "🌸", 2300, "bundle install", "bundle exec hanami server", null, ["Gemfile"], ["hanami"]),
  s("roda", "Roda", "ruby", "backend", "🛤️", 9292, "bundle install", "bundle exec rackup -o 0.0.0.0", null, ["config.ru"], ["roda"]),
  s("jekyll", "Jekyll", "ruby", "static", "🧪", 4000, "bundle exec jekyll build", "bundle exec jekyll serve --host 0.0.0.0", "_site", ["_config.yml"], ["jekyll"]),

  // ---------- PHP ----------
  s("codeigniter", "CodeIgniter", "php", "backend", "🔥", 8080, "composer install", "php spark serve --host 0.0.0.0 --port 8080", null, ["spark"], ["codeigniter4/framework"]),
  s("slim", "Slim", "php", "backend", "🍰", 8080, "composer install", "php -S 0.0.0.0:8080 -t public", "public", ["composer.json"], ["slim/slim"]),
  s("cakephp", "CakePHP", "php", "backend", "🍰", 8765, "composer install", "bin/cake server -H 0.0.0.0 -p 8765", null, ["composer.json"], ["cakephp/cakephp"]),
  s("drupal", "Drupal", "php", "backend", "💧", 8080, "composer install", "php -S 0.0.0.0:8080 -t web", "web", ["composer.json"], ["drupal/core", "drupal/core-recommended"]),
  s("wordpress", "WordPress", "php", "backend", "📰", 8080, null, "php -S 0.0.0.0:8080", null, ["wp-config.php", "wp-settings.php"], []),

  // ---------- Java / JVM ----------
  s("micronaut", "Micronaut", "java", "backend", "🧬", 8080, "./gradlew build", "java -jar build/libs/app.jar", "build/libs", ["micronaut-cli.yml", "build.gradle", "pom.xml"], ["io.micronaut:micronaut-core", "micronaut-http-server-netty"]),
  s("vertx", "Eclipse Vert.x", "java", "backend", "🔻", 8888, "./mvnw package", "java -jar target/app.jar", "target", ["pom.xml", "build.gradle"], ["io.vertx:vertx-core", "vertx-core"]),
  s("dropwizard", "Dropwizard", "java", "backend", "🎯", 8080, "./mvnw package", "java -jar target/app.jar server config.yml", "target", ["pom.xml"], ["io.dropwizard:dropwizard-core", "dropwizard-core"]),
  s("ktor", "Ktor", "kotlin", "backend", "🅺", 8080, "./gradlew build", "java -jar build/libs/app.jar", "build/libs", ["build.gradle.kts", "build.gradle"], ["io.ktor:ktor-server-core", "ktor-server-core"]),
  s("play", "Play Framework", "scala", "fullstack", "▶️", 9000, "sbt stage", "target/universal/stage/bin/app", "target/universal", ["build.sbt", "conf/application.conf"], ["play"]),
  s("scala", "Scala (sbt)", "scala", "backend", "🔴", 8080, "sbt compile stage", "target/universal/stage/bin/app", "target", ["build.sbt"], []),
  s("clojure", "Clojure", "clojure", "backend", "🍀", 3000, "clojure -T:build uber", "clojure -M -m core", "target", ["deps.edn", "project.clj"], []),
  s("groovy", "Groovy / Grails", "groovy", "backend", "🎸", 8080, "./gradlew assemble", "./gradlew bootRun", "build/libs", ["grails-app", "build.gradle"], ["org.grails:grails-core"]),

  // ---------- .NET ----------
  s("fsharp", "F#", "fsharp", "backend", "🔷", 5000, "dotnet publish -c Release -o out", "dotnet out/app.dll", "out", ["Program.fs", "App.fs"], []),

  // ---------- Elixir / Erlang / BEAM ----------
  s("elixir", "Elixir (Mix)", "elixir", "backend", "💧", 4000, "mix deps.get && mix compile", "mix run --no-halt", "_build", ["mix.exs"], []),
  s("erlang", "Erlang (rebar3)", "erlang", "backend", "☎️", 8080, "rebar3 compile", "rebar3 shell", "_build", ["rebar.config"], []),
  s("gleam", "Gleam", "gleam", "backend", "✨", 3000, "gleam build", "gleam run", "build", ["gleam.toml"], []),

  // ---------- Other languages ----------
  s("vapor", "Vapor (Swift)", "swift", "backend", "💧", 8080, "swift build -c release", ".build/release/App serve --hostname 0.0.0.0", ".build/release", ["Package.swift"], ["vapor"]),
  s("swift", "Swift Package", "swift", "backend", "🕊️", 8080, "swift build -c release", ".build/release/App", ".build/release", ["Package.swift"], []),
  s("dart", "Dart (shelf)", "dart", "backend", "🎯", 8080, "dart pub get && dart compile exe bin/server.dart -o server", "./server", "bin", ["pubspec.yaml"], ["shelf"]),
  s("flutter-web", "Flutter Web", "dart", "frontend", "🐦", 8080, "flutter build web --release", null, "build/web", ["pubspec.yaml"], ["flutter"]),
  s("crystal", "Crystal (Kemal/Lucky)", "crystal", "backend", "💎", 3000, "shards install && crystal build --release src/app.cr", "./app", "bin", ["shard.yml"], []),
  s("haskell", "Haskell", "haskell", "backend", "λ", 8080, "stack build", "stack exec app", ".stack-work", ["stack.yaml", "cabal.project"], []),
  s("ocaml", "OCaml (Dune)", "ocaml", "backend", "🐫", 8080, "dune build", "dune exec ./bin/main.exe", "_build", ["dune-project"], []),
  s("nim", "Nim", "nim", "backend", "👑", 8080, "nimble build -d:release", "./app", "bin", ["nim.cfg"], []),
  s("zig", "Zig", "zig", "backend", "⚡", 8080, "zig build -Doptimize=ReleaseSafe", "./zig-out/bin/app", "zig-out", ["build.zig"], []),
  s("perl", "Perl", "perl", "backend", "🐪", 5000, "cpanm --installdeps .", "plackup -o 0.0.0.0 -p 5000 app.psgi", null, ["cpanfile", "app.psgi"], []),
  s("lua", "Lua / OpenResty", "lua", "backend", "🌙", 8080, "luarocks install --only-deps *.rockspec", "openresty -p . -c conf/nginx.conf", null, ["conf/nginx.conf", "init.lua"], []),
  s("julia", "Julia", "julia", "backend", "🔮", 8080, "julia --project -e 'using Pkg; Pkg.instantiate()'", "julia --project src/main.jl", null, ["Project.toml"], []),
  s("rlang", "R (Plumber/Shiny)", "r", "backend", "📉", 8000, null, "Rscript app.R", null, ["DESCRIPTION", "app.R", "plumber.R"], []),
  s("cpp", "C / C++ (CMake)", "cpp", "backend", "🔧", 8080, "cmake -B build && cmake --build build --config Release", "./build/app", "build", ["CMakeLists.txt"], []),
  s("make", "Makefile project", "multi", "generic", "🛠️", 8080, "make", "make run", null, ["Makefile"], []),
  s("elm", "Elm", "elm", "frontend", "🌳", 8000, "elm make src/Main.elm --optimize --output=dist/main.js", null, "dist", ["elm.json"], []),
  s("wasm", "WASM bundle", "multi", "frontend", "🕸️", 8080, null, null, "dist", ["wasm-pack.toml"], []),

  // ---------- Static site generators ----------
  s("eleventy", "Eleventy", "javascript", "static", "1️⃣1️⃣", 8080, "npx @11ty/eleventy", "npx @11ty/eleventy --serve", "_site", [".eleventy.js", "eleventy.config.js"], ["@11ty/eleventy"]),
  s("gridsome", "Gridsome", "javascript", "static", "🟢", 8080, "gridsome build", "gridsome serve", "dist", ["gridsome.config.js"], ["gridsome"]),
  s("mkdocs", "MkDocs", "python", "static", "📚", 8000, "mkdocs build", "mkdocs serve -a 0.0.0.0:8000", "site", ["mkdocs.yml"], []),
  s("zola", "Zola", "rust", "static", "🧊", 1111, "zola build", "zola serve --interface 0.0.0.0", "public", ["config.toml", "content"], []),

  // ---------- Infra / ops ----------
  s("nginx", "Nginx site", "multi", "static", "🌐", 80, null, "nginx -g 'daemon off;'", null, ["nginx.conf"], []),
  s("helm", "Helm chart", "multi", "generic", "⎈", 0, "helm dependency update", null, null, ["Chart.yaml"], []),
  s("terraform", "Terraform", "multi", "generic", "🏗️", 0, "terraform init", "terraform apply -auto-approve", null, ["main.tf"], []),
  s("ansible", "Ansible", "multi", "generic", "🅰️", 0, null, "ansible-playbook playbook.yml", null, ["playbook.yml", "ansible.cfg"], []),
  s("procfile", "Procfile app", "multi", "generic", "🧾", 3000, null, "honcho start", null, ["Procfile"], []),
  s("nixpacks", "Nixpacks", "multi", "generic", "❄️", 3000, "nixpacks build .", null, null, ["nixpacks.toml", "flake.nix"], []),
  s("bash", "Shell script", "shell", "generic", "🐚", 0, null, "bash start.sh", null, ["start.sh", "run.sh"], []),
]);

/**
 * Detection order for the extra stacks, grouped so specific frameworks always
 * win before the base registry's generic per-language catch-alls.
 */
export const EXTRA_ORDER = {
  // inserted before the base "vite"/generic frontend entries
  beforeFrontend: [
    "nuxt-content",
    "redwood",
    "solidstart",
    "qwik",
    "fresh",
    "docusaurus",
    "vitepress",
    "gridsome",
    "expo",
  ],
  // inserted before base backend-JS entries (express/koa/...)
  beforeBackendJs: [
    "medusa",
    "strapi",
    "payload",
    "keystone",
    "meteor",
    "sails",
    "feathers",
    "hapi",
    "nx",
    "electron",
  ],
  // inserted before base per-language generic entries
  beforeLanguages: [
    // python
    "streamlit",
    "gradio",
    "litestar",
    "sanic",
    "tornado",
    "aiohttp",
    "bottle",
    "pyramid",
    "dash",
    "airflow",
    "mkdocs",
    // go
    "chi",
    "beego",
    "buffalo",
    "hugo",
    // rust
    "leptos",
    "dioxus",
    "warp",
    "poem",
    "tide",
    "trunk",
    "zola",
    // ruby
    "hanami",
    "roda",
    "jekyll",
    // php
    "codeigniter",
    "cakephp",
    "drupal",
    "slim",
    "wordpress",
    // jvm
    "micronaut",
    "vertx",
    "dropwizard",
    "ktor",
    "play",
    "groovy",
    "scala",
    "clojure",
    // beam
    "erlang",
    "gleam",
    "elixir",
    // other languages
    "vapor",
    "swift",
    "flutter-web",
    "dart",
    "crystal",
    "haskell",
    "ocaml",
    "nim",
    "zig",
    "perl",
    "lua",
    "julia",
    "rlang",
    "elm",
    "eleventy",
    "deno",
    "bun",
    "fsharp",
  ],
  // last-resort generic detectors, after base static/node
  tail: ["cpp", "nginx", "helm", "terraform", "ansible", "procfile", "nixpacks", "make", "bash", "wasm"],
};

export const EXTRA_PACKAGE_MANAGERS = [
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["shard.yml", "shards"],
  ["pubspec.yaml", "pub"],
  ["package.swift", "swiftpm"],
  ["rebar.config", "rebar3"],
  ["gleam.toml", "gleam"],
  ["dune-project", "dune"],
  ["stack.yaml", "stack"],
  ["cabal.project", "cabal"],
  ["build.sbt", "sbt"],
  ["deps.edn", "clojure"],
  ["project.clj", "leiningen"],
  ["project.toml", "julia"],
  ["cmakelists.txt", "cmake"],
  ["build.zig", "zig"],
  ["nim.cfg", "nimble"],
  ["cpanfile", "cpanm"],
  ["poetry.lock", "poetry"],
  ["pdm.lock", "pdm"],
  ["conda.yaml", "conda"],
  ["environment.yml", "conda"],
  ["makefile", "make"],
];

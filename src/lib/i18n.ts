// src/lib/i18n.ts
// Multi-Language Localization (i18n) & RTL Layout Subsystem for HosteraX
// Supports English, Arabic (RTL), German, Spanish, French, Japanese, Portuguese, and Chinese.

import { useState, useEffect, useCallback } from "react";

export type LanguageCode = "en" | "ar" | "de" | "es" | "fr" | "ja" | "pt" | "zh";

export interface LanguageMeta {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  dir: "ltr" | "rtl";
}

export const LANGUAGES: LanguageMeta[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸", dir: "ltr" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", dir: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", dir: "rtl" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", dir: "ltr" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", dir: "ltr" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", dir: "ltr" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇧🇷", dir: "ltr" },
  { code: "zh", name: "Chinese", nativeName: "简体中文", flag: "🇨🇳", dir: "ltr" },
];

export const TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  en: {
    // Navigation & Shell
    dashboard: "Dashboard",
    projects: "Projects",
    apps: "App Store",
    quickDeploy: "Registries",
    deploy: "Deployments",
    deployments: "Deployments",
    jobs: "Jobs & Schedules",
    domains: "Domains & SSL",
    databases: "Databases",
    servers: "Servers",
    team: "Team & RBAC",
    mail: "Mailboxes",
    activity: "Activity",
    tokens: "API Tokens",
    oauth: "OAuth Apps",
    settings: "Settings",
    newProject: "New Project",
    systemHealthy: "Control plane · connected",
    logout: "Sign out",
    search: "Search projects, apps, databases...",
    language: "Language",
    primaryWorkspace: "Primary Workspace",

    // App Store & Catalog
    softwareDirectory: "Software Directory & Templates",
    appStoreCatalog: "App Store & Catalog",
    appStoreDesc: "Discover, install, and run 2,550+ self-hosted software packages and starter templates with zero-config.",
    oneClickApps: "One-Click Apps",
    starterTemplates: "Starter Templates",
    oneClickCatalogTitle: "One-Click Self-Hosted Software Catalog",
    oneClickCatalogDesc: "Browse 112+ tags and categories from awesome-selfhosted.net, sysadmin.awesome-selfhosted.net, and selfh.st/apps. Launch any application instantly with smart zero-config port discovery, persistent volumes, and custom domains.",
    deployAnyDockerImage: "Deploy Any Docker Image (Docker Hub / GHCR / Self-Hosted)",
    sourceFilter: "Source:",
    allApps: "All",
    verifiedOneClick: "Verified 1-Click",
    searchAppsPlaceholder: "Search across 2,550+ self-hosted apps...",
    allCategories: "All Categories",
    readyToDeploy: "Ready to deploy",
    analytics: "Analytics",
    automation: "Automation",
    cicd: "CI / CD",
    blogging: "Blogging",
    bookmarks: "Bookmarks",
    cms: "CMS & Backends",
    databasesCategory: "Databases",
    securityCategory: "Security",
    aiCategory: "AI",
    inspect: "Inspect",
    launchImage: "Launch Image",
  },

  es: {
    // Navigation & Shell
    dashboard: "Panel de Control",
    projects: "Proyectos",
    apps: "Tienda de Apps",
    quickDeploy: "Registros Docker",
    deploy: "Despliegues",
    deployments: "Despliegues",
    jobs: "Tareas Programadas",
    domains: "Dominios y SSL",
    databases: "Bases de Datos",
    servers: "Servidores",
    team: "Equipo y Roles",
    mail: "Correo y Buzones",
    activity: "Actividad y Auditoría",
    tokens: "Tokens de API",
    oauth: "Aplicaciones OAuth",
    settings: "Configuración",
    newProject: "Nuevo Proyecto",
    systemHealthy: "Plano de Control · Conectado",
    logout: "Cerrar Sesión",
    search: "Buscar proyectos, aplicaciones, bases de datos...",
    language: "Idioma",
    primaryWorkspace: "Espacio Principal",

    // App Store & Catalog
    softwareDirectory: "Directorio de Software y Plantillas",
    appStoreCatalog: "Tienda de Apps y Catálogo",
    appStoreDesc: "Descubre, instala y ejecuta más de 2,550 paquetes de software auto-hospedados y plantillas sin configuración.",
    oneClickApps: "Apps en 1-Clic",
    starterTemplates: "Plantillas Iniciales",
    oneClickCatalogTitle: "Catálogo de Software Auto-Hospedado en 1-Clic",
    oneClickCatalogDesc: "Explora más de 112 categorías y etiquetas de awesome-selfhosted.net y selfh.st. Despliega cualquier aplicación al instante con descubrimiento automático de puertos, volúmenes persistentes y dominios.",
    deployAnyDockerImage: "Desplegar Cualquier Imagen Docker (Docker Hub / GHCR / Auto-Hospedado)",
    sourceFilter: "Origen:",
    allApps: "Todas",
    verifiedOneClick: "Verificadas 1-Clic",
    searchAppsPlaceholder: "Buscar entre más de 2,550 aplicaciones...",
    allCategories: "Todas las Categorías",
    readyToDeploy: "Listo para desplegar",
    analytics: "Analítica",
    automation: "Automatización",
    cicd: "CI / CD",
    blogging: "Blogs",
    bookmarks: "Marcadores",
    cms: "CMS y Backends",
    databasesCategory: "Bases de Datos",
    securityCategory: "Seguridad",
    aiCategory: "Inteligencia Artificial",
    inspect: "Inspeccionar",
    launchImage: "Lanzar Imagen",
  },

  ar: {
    // Navigation & Shell
    dashboard: "لوحة التحكم",
    projects: "المشاريع",
    apps: "متجر التطبيقات",
    quickDeploy: "سجلات الحاويات",
    deploy: "عمليات النشر",
    deployments: "عمليات النشر",
    jobs: "المهام المجدولة",
    domains: "النطاقات وشهادات SSL",
    databases: "قواعد البيانات",
    servers: "الخوادم والعقد",
    team: "الفريق والصلاحيات",
    mail: "صناديق البريد",
    activity: "سجل النشاطات",
    tokens: "رموز API",
    oauth: "تطبيقات OAuth",
    settings: "الإعدادات",
    newProject: "مشروع جديد",
    systemHealthy: "لوحة التحكم · متصلة",
    logout: "تسجيل الخروج",
    search: "ابحث في المشاريع والتطبيقات...",
    language: "اللغة",
    primaryWorkspace: "مساحة العمل الرئيسية",

    // App Store & Catalog
    softwareDirectory: "دليل البرمجيات والقوالب",
    appStoreCatalog: "متجر التطبيقات والدليل الشامل",
    appStoreDesc: "اكتشف وثبت وشغل أكثر من 2,550 تطبيقاً برمجياً مفتوح المصدر وقوالب سريعة بدون أي إعدادات مسبقة.",
    oneClickApps: "تطبيقات بنقرة واحدة",
    starterTemplates: "قوالب سريعة",
    oneClickCatalogTitle: "دليل التطبيقات ذاتية الاستضافة بنقرة واحدة",
    oneClickCatalogDesc: "تصفح أكثر من 112 تصنيفاً من مصادر البرمجيات ذاتية الاستضافة الموثوقة. أطلق أي تطبيق فورياً مع إدارة تلقائية للمنافذ والأقراص والنطاقات.",
    deployAnyDockerImage: "نشر أي حاوية دكر (Docker Hub / GHCR / استضافة ذاتية)",
    sourceFilter: "المصدر:",
    allApps: "الكل",
    verifiedOneClick: "موثقة 1-نقرة",
    searchAppsPlaceholder: "ابحث في أكثر من 2,550 تطبيقاً...",
    allCategories: "جميع الفئات والتصنيفات",
    readyToDeploy: "جاهز للنشر",
    analytics: "التحليلات",
    automation: "الأتمتة",
    cicd: "التكامل المستمر",
    blogging: "المدونات",
    bookmarks: "الإشارات المرجعية",
    cms: "إدارة المحتوى",
    databasesCategory: "قواعد البيانات",
    securityCategory: "الأمان والحماية",
    aiCategory: "الذكاء الاصطناعي",
    inspect: "فحص الحاوية",
    launchImage: "تشغيل التطبيق",
  },

  de: {
    dashboard: "Dashboard",
    projects: "Projekte",
    apps: "App Store",
    quickDeploy: "Registries",
    deploy: "Deployments",
    deployments: "Deployments",
    jobs: "Geplante Jobs",
    domains: "Domains & SSL",
    databases: "Datenbanken",
    servers: "Server",
    team: "Team & RBAC",
    mail: "Postfächer",
    activity: "Aktivitäten",
    tokens: "API-Tokens",
    oauth: "OAuth-Apps",
    settings: "Einstellungen",
    newProject: "Neues Projekt",
    systemHealthy: "Steuerebene · Verbunden",
    logout: "Abmelden",
    search: "Projekte, Apps durchsuchen...",
    language: "Sprache",
    primaryWorkspace: "Hauptarbeitsbereich",

    softwareDirectory: "Software-Verzeichnis & Vorlagen",
    appStoreCatalog: "App Store & Katalog",
    appStoreDesc: "Entdecken, installieren und betreiben Sie über 2.550 selbst gehostete Softwarepakete und Vorlagen ohne Konfiguration.",
    oneClickApps: "1-Klick-Apps",
    starterTemplates: "Starter-Vorlagen",
    oneClickCatalogTitle: "1-Klick Self-Hosted Software-Katalog",
    oneClickCatalogDesc: "Durchsuchen Sie über 112 Kategorien. Starten Sie jede Anwendung sofort mit intelligenter Port-Erkennung und persistentem Speicher.",
    deployAnyDockerImage: "Beliebiges Docker-Image bereitstellen (Docker Hub / GHCR)",
    sourceFilter: "Quelle:",
    allApps: "Alle",
    verifiedOneClick: "Verifizierte 1-Klick",
    searchAppsPlaceholder: "Über 2.550 Apps durchsuchen...",
    allCategories: "Alle Kategorien",
    readyToDeploy: "Bereit zum Deploy",
    analytics: "Analytik",
    automation: "Automatisierung",
    cicd: "CI / CD",
    blogging: "Blogging",
    bookmarks: "Lesezeichen",
    cms: "CMS & Backends",
    databasesCategory: "Datenbanken",
    securityCategory: "Sicherheit",
    aiCategory: "Künstliche Intelligenz",
    inspect: "Prüfen",
    launchImage: "Image starten",
  },

  fr: {
    dashboard: "Tableau de Bord",
    projects: "Projets",
    apps: "Boutique d'Apps",
    quickDeploy: "Registres",
    deploy: "Déploiements",
    deployments: "Déploiements",
    jobs: "Tâches Planifiées",
    domains: "Domaines et SSL",
    databases: "Bases de Données",
    servers: "Serveurs",
    team: "Équipe & Rôles",
    mail: "Messagerie",
    activity: "Activité",
    tokens: "Jetons d'API",
    oauth: "Applications OAuth",
    settings: "Paramètres",
    newProject: "Nouveau Projet",
    systemHealthy: "Plan de Contrôle · Connecté",
    logout: "Déconnexion",
    search: "Rechercher des projets, applications...",
    language: "Langue",
    primaryWorkspace: "Espace Principal",

    softwareDirectory: "Répertoire de Logiciels et Modèles",
    appStoreCatalog: "Boutique d'Apps et Catalogue",
    appStoreDesc: "Découvrez, installez et exécutez plus de 2 550 packages de logiciels auto-hébergés sans configuration.",
    oneClickApps: "Apps en 1-Clic",
    starterTemplates: "Modèles de Démarrage",
    oneClickCatalogTitle: "Catalogue de Logiciels Auto-Hébergés en 1-Clic",
    oneClickCatalogDesc: "Parcourez plus de 112 catégories. Lancez n'importe quelle application instantanément avec détection de port et volumes persistants.",
    deployAnyDockerImage: "Déployer une Image Docker (Docker Hub / GHCR)",
    sourceFilter: "Source:",
    allApps: "Toutes",
    verifiedOneClick: "Vérifiées 1-Clic",
    searchAppsPlaceholder: "Rechercher parmi 2 550+ applications...",
    allCategories: "Toutes les Catégories",
    readyToDeploy: "Prêt à déployer",
    analytics: "Analytique",
    automation: "Automatisation",
    cicd: "CI / CD",
    blogging: "Blogs",
    bookmarks: "Favoris",
    cms: "CMS & Backends",
    databasesCategory: "Bases de Données",
    securityCategory: "Sécurité",
    aiCategory: "Intelligence Artificielle",
    inspect: "Inspecter",
    launchImage: "Lancer l'Image",
  },

  ja: {
    dashboard: "ダッシュボード",
    projects: "プロジェクト",
    apps: "アプリストア",
    quickDeploy: "レジストリ",
    deploy: "デプロイ一覧",
    deployments: "デプロイ一覧",
    jobs: "定期ジョブ",
    domains: "ドメインとSSL",
    databases: "データベース",
    servers: "サーバー",
    team: "チームと権限",
    mail: "メールボックス",
    activity: "アクティビティ",
    tokens: "APIトークン",
    oauth: "OAuthアプリ",
    settings: "設定",
    newProject: "新規プロジェクト",
    systemHealthy: "コントロールプレーン · 接続完了",
    logout: "ログアウト",
    search: "プロジェクトやアプリを検索...",
    language: "言語",
    primaryWorkspace: "メインワークスペース",

    softwareDirectory: "ソフトウェアディレクトリ＆テンプレート",
    appStoreCatalog: "アプリストア＆カタログ",
    appStoreDesc: "2,550以上のセルフホスト対応オープンソースソフトウェアをゼロ構成で即座に導入できます。",
    oneClickApps: "ワンクリックアプリ",
    starterTemplates: "スターターテンプレート",
    oneClickCatalogTitle: "ワンクリック・セルフホストカタログ",
    oneClickCatalogDesc: "112以上のカテゴリから選択可能。スマートなポート自動検知とボリューム永続化で即時起動します。",
    deployAnyDockerImage: "Dockerイメージのデプロイ (Docker Hub / GHCR)",
    sourceFilter: "ソース:",
    allApps: "すべて",
    verifiedOneClick: "検証済み1クリック",
    searchAppsPlaceholder: "2,550以上のアプリから検索...",
    allCategories: "すべてのカテゴリ",
    readyToDeploy: "デプロイ準備完了",
    analytics: "分析",
    automation: "自動化",
    cicd: "CI / CD",
    blogging: "ブログ",
    bookmarks: "ブックマーク",
    cms: "CMS＆バックエンド",
    databasesCategory: "データベース",
    securityCategory: "セキュリティ",
    aiCategory: "AI・人工知能",
    inspect: "検査",
    launchImage: "イメージ起動",
  },

  pt: {
    dashboard: "Painel",
    projects: "Projetos",
    apps: "Loja de Aplicativos",
    quickDeploy: "Registros",
    deploy: "Implantações",
    deployments: "Implantações",
    jobs: "Tarefas Agendadas",
    domains: "Domínios e SSL",
    databases: "Bancos de Dados",
    servers: "Servidores",
    team: "Equipe & RBAC",
    mail: "Correio",
    activity: "Atividade",
    tokens: "Tokens de API",
    oauth: "Aplicativos OAuth",
    settings: "Configurações",
    newProject: "Novo Projeto",
    systemHealthy: "Plano de Controle · Conectado",
    logout: "Sair",
    search: "Buscar projetos, aplicativos...",
    language: "Idioma",
    primaryWorkspace: "Espaço Principal",

    softwareDirectory: "Diretório de Software e Modelos",
    appStoreCatalog: "Loja de Aplicativos e Catálogo",
    appStoreDesc: "Descubra, instale e execute mais de 2.550 pacotes de software auto-hospedados sem configuração.",
    oneClickApps: "Apps em 1-Clique",
    starterTemplates: "Modelos Iniciais",
    oneClickCatalogTitle: "Catálogo de Software Auto-Hospedado em 1-Clique",
    oneClickCatalogDesc: "Navegue por mais de 112 categorias. Inicie qualquer aplicativo instantaneamente com portas inteligentes e armazenamento persistente.",
    deployAnyDockerImage: "Implantar Qualquer Imagem Docker (Docker Hub / GHCR)",
    sourceFilter: "Origem:",
    allApps: "Todas",
    verifiedOneClick: "Verificadas 1-Clique",
    searchAppsPlaceholder: "Buscar em mais de 2.550 aplicativos...",
    allCategories: "Todas as Categorias",
    readyToDeploy: "Pronto para implantar",
    analytics: "Análise",
    automation: "Automação",
    cicd: "CI / CD",
    blogging: "Blogs",
    bookmarks: "Favoritos",
    cms: "CMS & Backends",
    databasesCategory: "Bancos de Dados",
    securityCategory: "Segurança",
    aiCategory: "Inteligência Artificial",
    inspect: "Inspecionar",
    launchImage: "Lançar Imagem",
  },

  zh: {
    dashboard: "控制面板",
    projects: "项目管理",
    apps: "应用商店",
    quickDeploy: "镜像中心",
    deploy: "部署记录",
    deployments: "部署记录",
    jobs: "定时任务",
    domains: "域名与SSL证书",
    databases: "数据库",
    servers: "计算节点",
    team: "团队与权限",
    mail: "自建邮箱",
    activity: "操作审计日志",
    tokens: "API密钥与令牌",
    oauth: "OAuth应用中心",
    settings: "系统设置",
    newProject: "创建新项目",
    systemHealthy: "控制平面 · 连接正常",
    logout: "退出登录",
    search: "搜索项目、应用、数据库...",
    language: "界面语言",
    primaryWorkspace: "主工作空间",

    softwareDirectory: "自建应用目录与开发模板",
    appStoreCatalog: "应用商店与软件目录",
    appStoreDesc: "浏览、一键安装并运行 2,550+ 经典开源自建应用和微服务模板，全自动端口与卷绑定。",
    oneClickApps: "一键应用商店",
    starterTemplates: "项目起步模板",
    oneClickCatalogTitle: "2,550+ 开源自托管软件目录",
    oneClickCatalogDesc: "涵盖 112+ 标签与分类。支持智能端口探测、持久化卷映射以及自动 HTTPS 域名解析。",
    deployAnyDockerImage: "部署任意 Docker 镜像 (Docker Hub / GHCR / 私有仓库)",
    sourceFilter: "应用来源:",
    allApps: "全部应用",
    verifiedOneClick: "精选一键部署",
    searchAppsPlaceholder: "搜索 2,550+ 款开源自托管应用...",
    allCategories: "全部分类与标签",
    readyToDeploy: "准备就绪，点击即可部署",
    analytics: "数据统计与分析",
    automation: "工作流与自动化",
    cicd: "持续集成与发布",
    blogging: "博客与独立站点",
    bookmarks: "书签与导航",
    cms: "内容管理与后端",
    databasesCategory: "数据库与存储",
    securityCategory: "安全与凭据",
    aiCategory: "人工智能与大模型",
    inspect: "深度探测",
    launchImage: "立即启动镜像",
  },
};

import { startLiveTranslator, updateLiveTranslationLanguage } from "./live-translator";

const STORAGE_KEY = "hosterax_lang_pref";

export function useTranslation() {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode;
      if (saved && TRANSLATIONS[saved]) return saved;
    }
    return "en";
  });

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, code);
      const meta = LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
      document.documentElement.dir = meta.dir;
      document.documentElement.lang = meta.code;
      updateLiveTranslationLanguage(code);
    }
  }, []);

  useEffect(() => {
    const meta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];
    if (typeof document !== "undefined") {
      document.documentElement.dir = meta.dir;
      document.documentElement.lang = meta.code;
      startLiveTranslator(language);
    }
  }, [language]);

  const currentMeta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
      if (dict[key]) return dict[key];
      if (TRANSLATIONS.en[key]) return TRANSLATIONS.en[key];

      // Smart reverse lookup if key is an English string
      for (const [k, v] of Object.entries(TRANSLATIONS.en)) {
        if (v.toLowerCase() === key.toLowerCase()) {
          return dict[k] || v;
        }
      }

      return fallback || key;
    },
    [language],
  );

  return {
    t,
    language,
    currentMeta,
    languages: LANGUAGES,
    setLanguage,
    isRtl: currentMeta.dir === "rtl",
  };
}

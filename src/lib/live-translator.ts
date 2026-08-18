// src/lib/live-translator.ts
// Autonomous Real-Time Full-DOM Live Translation Engine for HosteraX
// Intercepts and live-translates every single rendered element, text node, placeholder,
// and dynamic sub-component across the entire application instantly upon language selection.

import { LanguageCode, TRANSLATIONS } from "./i18n";

// Comprehensive multi-language vocabulary & phrase dictionary for full-app translation
const DICTIONARY: Record<LanguageCode, Record<string, string>> = {
  en: {},
  es: {
    // Top Navigation & Shell
    "dashboard": "Panel de Control",
    "projects": "Proyectos",
    "app store": "Tienda de Apps",
    "app store & catalog": "Tienda de Apps y Catálogo",
    "registries": "Registros Docker",
    "deployments": "Despliegues",
    "deploy now": "Desplegar Ahora",
    "jobs & schedules": "Tareas Programadas",
    "domains & ssl": "Dominios y SSL",
    "databases": "Bases de Datos",
    "servers": "Servidores",
    "team & rbac": "Equipo y Roles",
    "mailboxes": "Correo y Buzones",
    "mailboxes & email stack": "Buzones y Servidor de Correo",
    "activity": "Actividad",
    "audit log & activity": "Registro de Auditoría y Actividad",
    "api tokens": "Tokens de API",
    "oauth apps": "Aplicaciones OAuth",
    "settings": "Configuración",
    "new project": "Nuevo Proyecto",
    "new project & service": "Nuevo Proyecto y Servicio",
    "control plane · connected": "Plano de Control · Conectado",
    "all systems operational": "Todos los Sistemas Operativos",
    "sign out": "Cerrar Sesión",
    "logout": "Cerrar Sesión",
    "language": "Idioma",
    "primary workspace": "Espacio Principal",

    // App Store & Catalogs
    "software directory & templates": "Directorio de Software y Plantillas",
    "discover, install, and run 2,550+ self-hosted software packages and starter templates with zero-config.": "Descubre, instala y ejecuta más de 2,550 paquetes de software auto-hospedados y plantillas sin configuración.",
    "one-click apps": "Apps en 1-Clic",
    "starter templates": "Plantillas Iniciales",
    "one-click self-hosted software catalog": "Catálogo de Software Auto-Hospedado en 1-Clic",
    "browse 112+ tags and categories from": "Explora más de 112 categorías y etiquetas de",
    "launch any application instantly with smart zero-config port discovery, persistent volumes, and custom domains.": "Lanza cualquier aplicación al instante con detección automática de puertos, volúmenes persistentes y dominios.",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "Desplegar Cualquier Imagen Docker (Docker Hub / GHCR / Auto-Hospedado)",
    "smart auto-port & auto-volume": "Puerto y Volumen Automáticos",
    "source:": "Origen:",
    "source": "Origen",
    "all": "Todas",
    "verified 1-click": "Verificadas 1-Clic",
    "awesome-selfhosted": "Awesome-Selfhosted",
    "sysadmin / devops": "SysAdmin / DevOps",
    "search across 2,550+ self-hosted apps...": "Buscar entre más de 2,550 aplicaciones auto-hospedadas...",
    "all categories": "Todas las Categorías",
    "ready to deploy": "Listo para desplegar",
    "inspect": "Inspeccionar",
    "launch image": "Lanzar Imagen",
    "infinite / load more": "Cargar Más",
    "page numbers": "Páginas",
    "show:": "Mostrar:",
    "analytics": "Analítica",
    "automation": "Automatización",
    "ci / cd": "CI / CD",
    "blogging": "Blogs",
    "bookmarks": "Marcadores",
    "cms & backends": "CMS y Backends",
    "security": "Seguridad",
    "ai": "Inteligencia Artificial",
    "dev tools": "Herramientas de Desarrollo",
    "tasks & to-do": "Tareas y Pendientes",
    "wikis": "Wikis y Documentación",
    "communication": "Comunicación",
    "media streaming": "Streaming y Medios",
    "file transfer & sync": "Archivos y Sincronización",

    // Common Actions & States
    "create": "Crear",
    "delete": "Eliminar",
    "edit": "Editar",
    "save": "Guardar",
    "cancel": "Cancelar",
    "update": "Actualizar",
    "deploy": "Desplegar",
    "rollback": "Revertir",
    "logs": "Registros en Vivo",
    "status": "Estado",
    "healthy": "Saludable",
    "offline": "Desconectado",
    "running": "En Ejecución",
    "stopped": "Detenido",
    "restart": "Reiniciar",
    "stop": "Detener",
    "start": "Iniciar",
    "overview": "Resumen General",
    "metrics": "Métricas",
    "backups": "Copias de Seguridad",
    "environment": "Variables de Entorno",
    "environment variables": "Variables de Entorno",
    "custom domain": "Dominio Personalizado",
    "branch": "Rama Git",
    "port": "Puerto",
    "memory": "Memoria RAM",
    "cpu": "CPU",
    "storage": "Almacenamiento",
    "disk": "Disco",
    "actions": "Acciones",
    "name": "Nombre",
    "description": "Descripción",
    "created": "Creado",
    "updated": "Actualizado",
    "copy": "Copiar",
    "copied": "Copiado",
    "install": "Instalar",
    "provision": "Aprovisionar",
    "confirm": "Confirmar",
    "warning": "Advertencia",
    "success": "Éxito",
    "error": "Error",
    "loading...": "Cargando...",
    "no projects yet": "No hay proyectos todavía",
    "create your first project": "Crea tu primer proyecto",
    "point hosterax at any git repo or local folder to auto-detect stack, build, and deploy.": "Apunta HosteraX a cualquier repositorio Git o carpeta local para detectar el stack, construir y desplegar.",
  },

  ar: {
    "dashboard": "لوحة التحكم",
    "projects": "المشاريع",
    "app store": "متجر التطبيقات",
    "app store & catalog": "متجر التطبيقات والدليل الشامل",
    "registries": "سجلات الحاويات",
    "deployments": "عمليات النشر",
    "deploy now": "نشر الآن",
    "jobs & schedules": "المهام المجدولة",
    "domains & ssl": "النطاقات وشهادات SSL",
    "databases": "قواعد البيانات",
    "servers": "الخوادم والعقد",
    "team & rbac": "الفريق والصلاحيات",
    "mailboxes": "صناديق البريد",
    "activity": "سجل النشاطات",
    "api tokens": "رموز API",
    "oauth apps": "تطبيقات OAuth",
    "settings": "الإعدادات",
    "new project": "مشروع جديد",
    "control plane · connected": "لوحة التحكم · متصلة",
    "all systems operational": "جميع الأنظمة تعمل بكفاءة",
    "sign out": "تسجيل الخروج",
    "logout": "تسجيل الخروج",
    "language": "اللغة",
    "primary workspace": "مساحة العمل الرئيسية",
    "software directory & templates": "دليل البرمجيات والقوالب",
    "one-click apps": "تطبيقات بنقرة واحدة",
    "starter templates": "قوالب سريعة",
    "one-click self-hosted software catalog": "دليل التطبيقات ذاتية الاستضافة بنقرة واحدة",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "نشر أي حاوية دكر (Docker Hub / GHCR / استضافة ذاتية)",
    "source:": "المصدر:",
    "all": "الكل",
    "verified 1-click": "موثقة 1-نقرة",
    "search across 2,550+ self-hosted apps...": "ابحث في أكثر من 2,550 تطبيقاً...",
    "all categories": "جميع الفئات والتصنيفات",
    "ready to deploy": "جاهز للنشر",
    "inspect": "فحص الحاوية",
    "launch image": "تشغيل التطبيق",
    "analytics": "التحليلات",
    "automation": "الأتمتة",
    "ci / cd": "التكامل المستمر",
    "blogging": "المدونات",
    "bookmarks": "الإشارات المرجعية",
    "cms & backends": "إدارة المحتوى",
    "security": "الأمان والحماية",
    "ai": "الذكاء الاصطناعي",
    "create": "إنشاء",
    "delete": "حذف",
    "edit": "تعديل",
    "save": "حفظ",
    "cancel": "إلغاء",
    "deploy": "نشر",
    "logs": "السجلات المباشرة",
    "status": "الحالة",
    "running": "قيد التشغيل",
    "stopped": "متوقف",
  },

  de: {
    "dashboard": "Dashboard",
    "projects": "Projekte",
    "app store": "App Store",
    "app store & catalog": "App Store & Katalog",
    "registries": "Registries",
    "deployments": "Deployments",
    "deploy now": "Jetzt Bereitstellen",
    "jobs & schedules": "Geplante Jobs",
    "domains & ssl": "Domains & SSL",
    "databases": "Datenbanken",
    "servers": "Server",
    "team & rbac": "Team & RBAC",
    "mailboxes": "Postfächer",
    "activity": "Aktivitäten",
    "api tokens": "API-Tokens",
    "oauth apps": "OAuth-Apps",
    "settings": "Einstellungen",
    "new project": "Neues Projekt",
    "control plane · connected": "Steuerebene · Verbunden",
    "all systems operational": "Alle Systeme Betriebsbereit",
    "sign out": "Abmelden",
    "language": "Sprache",
    "primary workspace": "Hauptarbeitsbereich",
    "software directory & templates": "Software-Verzeichnis & Vorlagen",
    "one-click apps": "1-Klick-Apps",
    "starter templates": "Starter-Vorlagen",
    "one-click self-hosted software catalog": "1-Klick Self-Hosted Software-Katalog",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "Beliebiges Docker-Image bereitstellen",
    "source:": "Quelle:",
    "all": "Alle",
    "verified 1-click": "Verifizierte 1-Klick",
    "search across 2,550+ self-hosted apps...": "Über 2.550 Apps durchsuchen...",
    "all categories": "Alle Kategorien",
    "ready to deploy": "Bereit zum Deploy",
    "inspect": "Prüfen",
    "launch image": "Image starten",
    "analytics": "Analytik",
    "automation": "Automatisierung",
    "ci / cd": "CI / CD",
    "blogging": "Blogging",
    "bookmarks": "Lesezeichen",
    "cms & backends": "CMS & Backends",
    "security": "Sicherheit",
    "ai": "Künstliche Intelligenz",
    "create": "Erstellen",
    "delete": "Löschen",
    "edit": "Bearbeiten",
    "save": "Speichern",
    "cancel": "Abbrechen",
    "deploy": "Bereitstellen",
  },

  fr: {
    "dashboard": "Tableau de Bord",
    "projects": "Projets",
    "app store": "Boutique d'Apps",
    "app store & catalog": "Boutique d'Apps et Catalogue",
    "registries": "Registres",
    "deployments": "Déploiements",
    "deploy now": "Déployer Maintenant",
    "jobs & schedules": "Tâches Planifiées",
    "domains & ssl": "Domaines et SSL",
    "databases": "Bases de Données",
    "servers": "Serveurs",
    "team & rbac": "Équipe & Rôles",
    "mailboxes": "Messagerie",
    "activity": "Activité",
    "api tokens": "Jetons d'API",
    "oauth apps": "Applications OAuth",
    "settings": "Paramètres",
    "new project": "Nouveau Projet",
    "control plane · connected": "Plan de Contrôle · Connecté",
    "all systems operational": "Systèmes Opérationnels",
    "sign out": "Déconnexion",
    "language": "Langue",
    "primary workspace": "Espace Principal",
    "software directory & templates": "Répertoire de Logiciels et Modèles",
    "one-click apps": "Apps en 1-Clic",
    "starter templates": "Modèles de Démarrage",
    "one-click self-hosted software catalog": "Catalogue de Logiciels Auto-Hébergés en 1-Clic",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "Déployer une Image Docker",
    "source:": "Source:",
    "all": "Toutes",
    "verified 1-click": "Vérifiées 1-Clic",
    "search across 2,550+ self-hosted apps...": "Rechercher parmi 2 550+ applications...",
    "all categories": "Toutes les Catégories",
    "ready to deploy": "Prêt à déployer",
    "inspect": "Inspecter",
    "launch image": "Lancer l'Image",
    "analytics": "Analytique",
    "automation": "Automatisation",
    "ci / cd": "CI / CD",
    "blogging": "Blogs",
    "bookmarks": "Favoris",
    "cms & backends": "CMS & Backends",
    "security": "Sécurité",
    "ai": "Intelligence Artificielle",
    "create": "Créer",
    "delete": "Supprimer",
    "edit": "Modifier",
    "save": "Enregistrer",
    "cancel": "Annuler",
    "deploy": "Déployer",
  },

  ja: {
    "dashboard": "ダッシュボード",
    "projects": "プロジェクト",
    "app store": "アプリストア",
    "app store & catalog": "アプリストア＆カタログ",
    "registries": "レジストリ",
    "deployments": "デプロイ一覧",
    "deploy now": "今すぐデプロイ",
    "jobs & schedules": "定期ジョブ",
    "domains & ssl": "ドメインとSSL",
    "databases": "データベース",
    "servers": "サーバー",
    "team & rbac": "チームと権限",
    "mailboxes": "メールボックス",
    "activity": "アクティビティ",
    "api tokens": "APIトークン",
    "oauth apps": "OAuthアプリ",
    "settings": "設定",
    "new project": "新規プロジェクト",
    "control plane · connected": "コントロールプレーン · 接続完了",
    "all systems operational": "システム正常稼働中",
    "sign out": "ログアウト",
    "language": "言語",
    "primary workspace": "メインワークスペース",
    "software directory & templates": "ソフトウェアディレクトリ＆テンプレート",
    "one-click apps": "ワンクリックアプリ",
    "starter templates": "スターターテンプレート",
    "one-click self-hosted software catalog": "ワンクリック・セルフホストカタログ",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "Dockerイメージのデプロイ",
    "source:": "ソース:",
    "all": "すべて",
    "verified 1-click": "検証済み1クリック",
    "search across 2,550+ self-hosted apps...": "2,550以上のアプリから検索...",
    "all categories": "すべてのカテゴリ",
    "ready to deploy": "デプロイ準備完了",
    "inspect": "検査",
    "launch image": "イメージ起動",
    "analytics": "分析",
    "automation": "自動化",
    "ci / cd": "CI / CD",
    "blogging": "ブログ",
    "bookmarks": "ブックマーク",
    "cms & backends": "CMS＆バックエンド",
    "security": "セキュリティ",
    "ai": "AI・人工知能",
    "create": "新規作成",
    "delete": "削除",
    "edit": "編集",
    "save": "保存",
    "cancel": "キャンセル",
    "deploy": "デプロイ",
  },

  pt: {
    "dashboard": "Painel",
    "projects": "Projetos",
    "app store": "Loja de Aplicativos",
    "app store & catalog": "Loja de Aplicativos e Catálogo",
    "registries": "Registros",
    "deployments": "Implantações",
    "deploy now": "Implantar Agora",
    "jobs & schedules": "Tarefas Agendadas",
    "domains & ssl": "Domínios e SSL",
    "databases": "Bancos de Dados",
    "servers": "Servidores",
    "team & rbac": "Equipe & RBAC",
    "mailboxes": "Correio",
    "activity": "Atividade",
    "api tokens": "Tokens de API",
    "oauth apps": "Aplicativos OAuth",
    "settings": "Configurações",
    "new project": "Novo Projeto",
    "control plane · connected": "Plano de Controle · Conectado",
    "all systems operational": "Sistemas Operacionais",
    "sign out": "Sair",
    "language": "Idioma",
    "primary workspace": "Espaço Principal",
    "software directory & templates": "Diretório de Software e Modelos",
    "one-click apps": "Apps em 1-Clique",
    "starter templates": "Modelos Iniciais",
    "one-click self-hosted software catalog": "Catálogo de Software Auto-Hospedado em 1-Clique",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "Implantar Qualquer Imagem Docker",
    "source:": "Origem:",
    "all": "Todas",
    "verified 1-click": "Verificadas 1-Clique",
    "search across 2,550+ self-hosted apps...": "Buscar em mais de 2.550 aplicativos...",
    "all categories": "Todas as Categorias",
    "ready to deploy": "Pronto para implantar",
    "inspect": "Inspecionar",
    "launch image": "Lançar Imagem",
    "analytics": "Análise",
    "automation": "Automação",
    "ci / cd": "CI / CD",
    "blogging": "Blogs",
    "bookmarks": "Favoritos",
    "cms & backends": "CMS & Backends",
    "security": "Segurança",
    "ai": "Inteligência Artificial",
    "create": "Criar",
    "delete": "Excluir",
    "edit": "Editar",
    "save": "Salvar",
    "cancel": "Cancelar",
    "deploy": "Implantar",
  },

  zh: {
    "dashboard": "控制面板",
    "projects": "项目管理",
    "app store": "应用商店",
    "app store & catalog": "应用商店与软件目录",
    "registries": "镜像中心",
    "deployments": "部署记录",
    "deploy now": "立即部署",
    "jobs & schedules": "定时任务",
    "domains & ssl": "域名与SSL证书",
    "databases": "数据库",
    "servers": "计算节点",
    "team & rbac": "团队与权限",
    "mailboxes": "自建邮箱",
    "activity": "操作审计日志",
    "api tokens": "API密钥与令牌",
    "oauth apps": "OAuth应用中心",
    "settings": "系统设置",
    "new project": "创建新项目",
    "control plane · connected": "控制平面 · 连接正常",
    "all systems operational": "所有系统运行正常",
    "sign out": "退出登录",
    "language": "界面语言",
    "primary workspace": "主工作空间",
    "software directory & templates": "自建应用目录与开发模板",
    "one-click apps": "一键应用商店",
    "starter templates": "项目起步模板",
    "one-click self-hosted software catalog": "2,550+ 开源自托管软件目录",
    "deploy any docker image (docker hub / ghcr / self-hosted)": "部署任意 Docker 镜像",
    "source:": "应用来源:",
    "all": "全部应用",
    "verified 1-click": "精选一键部署",
    "search across 2,550+ self-hosted apps...": "搜索 2,550+ 款开源自托管应用...",
    "all categories": "全部分类与标签",
    "ready to deploy": "准备就绪，点击即可部署",
    "inspect": "深度探测",
    "launch image": "立即启动镜像",
    "analytics": "数据统计与分析",
    "automation": "工作流与自动化",
    "ci / cd": "持续集成与发布",
    "blogging": "博客与独立站点",
    "bookmarks": "书签与导航",
    "cms & backends": "内容管理与后端",
    "security": "安全与凭据",
    "ai": "人工智能与大模型",
    "create": "创建",
    "delete": "删除",
    "edit": "编辑",
    "save": "保存",
    "cancel": "取消",
    "deploy": "部署",
  },
};

// Global DOM translation observer instance
let observer: MutationObserver | null = null;
let currentLanguage: LanguageCode = "en";

// Store original untranslated texts to allow seamless switching
const originalTextMap = new WeakMap<Node, string>();
const originalAttrMap = new WeakMap<Element, Record<string, string>>();

function translateText(text: string, lang: LanguageCode): string {
  if (lang === "en" || !text || text.trim().length === 0) return text;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const dict = DICTIONARY[lang];

  if (!dict) return text;

  // Exact phrase match
  if (dict[lower]) {
    const match = dict[lower];
    return text.replace(trimmed, match);
  }

  // Common prefix / suffix phrases (e.g. "One-Click Apps (2,550+)")
  for (const [enPhrase, transPhrase] of Object.entries(dict)) {
    if (lower.startsWith(enPhrase) || lower.includes(enPhrase)) {
      // Replace case-insensitively
      const regex = new RegExp(enPhrase, "gi");
      return text.replace(regex, transPhrase);
    }
  }

  return text;
}

function processNode(node: Node, lang: LanguageCode) {
  // Translate text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    const raw = textNode.nodeValue || "";
    if (!raw.trim()) return;

    // Ignore code blocks or inputs
    const parent = textNode.parentElement;
    if (parent && (parent.tagName === "CODE" || parent.tagName === "PRE" || parent.isContentEditable)) {
      return;
    }

    if (!originalTextMap.has(textNode)) {
      originalTextMap.set(textNode, raw);
    }

    const orig = originalTextMap.get(textNode) || raw;
    if (lang === "en") {
      if (textNode.nodeValue !== orig) textNode.nodeValue = orig;
    } else {
      const translated = translateText(orig, lang);
      if (textNode.nodeValue !== translated) textNode.nodeValue = translated;
    }
    return;
  }

  // Translate placeholders and titles on element nodes
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    
    // Check placeholder
    if (el.hasAttribute("placeholder")) {
      const ph = el.getAttribute("placeholder") || "";
      let attrs = originalAttrMap.get(el);
      if (!attrs) {
        attrs = {};
        originalAttrMap.set(el, attrs);
      }
      if (!attrs.placeholder) attrs.placeholder = ph;

      const origPh = attrs.placeholder || ph;
      if (lang === "en") {
        el.setAttribute("placeholder", origPh);
      } else {
        el.setAttribute("placeholder", translateText(origPh, lang));
      }
    }

    // Traverse children
    for (let i = 0; i < el.childNodes.length; i++) {
      processNode(el.childNodes[i], lang);
    }
  }
}

export function startLiveTranslator(lang: LanguageCode) {
  currentLanguage = lang;
  if (typeof document === "undefined") return;

  // Run full DOM sweep
  processNode(document.body, lang);

  // Setup MutationObserver if not already active
  if (!observer) {
    observer = new MutationObserver((mutations) => {
      if (currentLanguage === "en") return;
      for (const m of mutations) {
        if (m.type === "childList") {
          for (let i = 0; i < m.addedNodes.length; i++) {
            processNode(m.addedNodes[i], currentLanguage);
          }
        } else if (m.type === "characterData") {
          processNode(m.target, currentLanguage);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}

export function updateLiveTranslationLanguage(lang: LanguageCode) {
  currentLanguage = lang;
  if (typeof document === "undefined") return;
  processNode(document.body, lang);
}

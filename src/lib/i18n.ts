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
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", dir: "rtl" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", dir: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", dir: "ltr" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", dir: "ltr" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", dir: "ltr" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇧🇷", dir: "ltr" },
  { code: "zh", name: "Chinese", nativeName: "简体中文", flag: "🇨🇳", dir: "ltr" },
];

export const TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  en: {
    dashboard: "Dashboard",
    projects: "Projects",
    apps: "App Store",
    databases: "Databases",
    servers: "Servers",
    jobs: "Jobs & Schedules",
    team: "Team & RBAC",
    mail: "Mailboxes",
    settings: "Settings",
    newProject: "New Project",
    systemHealthy: "All Systems Operational",
    deploy: "Deploy Now",
    search: "Search projects, apps, databases...",
    clusterNodes: "Cluster Nodes",
    activeContainers: "Active Containers",
    totalRam: "RAM Usage",
    storageUsage: "Storage Used",
    logout: "Log Out",
    quickDeploy: "Quick Deploy",
    ephemeralPreviews: "Ephemeral PR Previews",
    autoHealing: "Autonomous Self-Healing",
    backupRestore: "Backup & Restore",
  },
  ar: {
    dashboard: "لوحة التحكم",
    projects: "المشاريع",
    apps: "متجر التطبيقات",
    databases: "قواعد البيانات",
    servers: "الخوادم والعقد",
    jobs: "المهام المجدولة",
    team: "الفريق والصلاحيات",
    mail: "صناديق البريد",
    settings: "الإعدادات",
    newProject: "مشروع جديد",
    systemHealthy: "جميع الأنظمة تعمل بكفاءة",
    deploy: "نشر الآن",
    search: "ابحث في المشاريع والتطبيقات...",
    clusterNodes: "عقد الحوسبة",
    activeContainers: "الحاويات النشطة",
    totalRam: "استهلاك الذاكرة",
    storageUsage: "المساحة المستخدمة",
    logout: "تسجيل الخروج",
    quickDeploy: "نشر سريع",
    ephemeralPreviews: "معاينات طلبات السحب",
    autoHealing: "التعافي الذاتي التلقائي",
    backupRestore: "النسخ الاحتياطي والاستعادة",
  },
  es: {
    dashboard: "Panel de Control",
    projects: "Proyectos",
    apps: "Tienda de Apps",
    databases: "Bases de Datos",
    servers: "Servidores",
    jobs: "Tareas Programadas",
    team: "Equipo y Roles",
    mail: "Correo y Buzones",
    settings: "Configuración",
    newProject: "Nuevo Proyecto",
    systemHealthy: "Sistemas Operativos",
    deploy: "Desplegar",
    search: "Buscar proyectos, apps...",
    clusterNodes: "Nodos del Clúster",
    activeContainers: "Contenedores Activos",
    totalRam: "Uso de RAM",
    storageUsage: "Espacio Usado",
    logout: "Cerrar Sesión",
    quickDeploy: "Despliegue Rápido",
    ephemeralPreviews: "Vistas Previas de PR",
    autoHealing: "Auto-Recuperación Autónoma",
    backupRestore: "Copias de Seguridad",
  },
  de: {
    dashboard: "Dashboard",
    projects: "Projekte",
    apps: "App Store",
    databases: "Datenbanken",
    servers: "Server & Knoten",
    jobs: "Geplante Jobs",
    team: "Team & RBAC",
    mail: "Postfächer",
    settings: "Einstellungen",
    newProject: "Neues Projekt",
    systemHealthy: "Alle Systeme Betriebsbereit",
    deploy: "Jetzt Bereitstellen",
    search: "Projekte, Apps durchsuchen...",
    clusterNodes: "Cluster-Knoten",
    activeContainers: "Aktive Container",
    totalRam: "RAM-Auslastung",
    storageUsage: "Speicherplatz",
    logout: "Abmelden",
    quickDeploy: "Schnellstart",
    ephemeralPreviews: "PR-Vorschauumgebungen",
    autoHealing: "Autonome Selbstheilung",
    backupRestore: "Sichern & Wiederherstellen",
  },
  fr: {
    dashboard: "Tableau de Bord",
    projects: "Projets",
    apps: "Boutique d'Apps",
    databases: "Bases de Données",
    servers: "Serveurs",
    jobs: "Tâches Planifiées",
    team: "Équipe & Rôles",
    mail: "Messagerie",
    settings: "Paramètres",
    newProject: "Nouveau Projet",
    systemHealthy: "Systèmes Opérationnels",
    deploy: "Déployer",
    search: "Rechercher des projets...",
    clusterNodes: "Nœuds de Cluster",
    activeContainers: "Conteneurs Actifs",
    totalRam: "Utilisation RAM",
    storageUsage: "Stockage Utilisé",
    logout: "Déconnexion",
    quickDeploy: "Déploiement Rapide",
    ephemeralPreviews: "Prévisualisations PR",
    autoHealing: "Auto-Guérison Autonome",
    backupRestore: "Sauvegardes",
  },
  ja: {
    dashboard: "ダッシュボード",
    projects: "プロジェクト",
    apps: "アプリストア",
    databases: "データベース",
    servers: "サーバー",
    jobs: "定期ジョブ",
    team: "チームと権限",
    mail: "メールボックス",
    settings: "設定",
    newProject: "新規作成",
    systemHealthy: "システム正常稼働中",
    deploy: "今すぐデプロイ",
    search: "プロジェクトやアプリを検索...",
    clusterNodes: "クラスタノード",
    activeContainers: "稼働中コンテナ",
    totalRam: "メモリ使用量",
    storageUsage: "ストレージ容量",
    logout: "ログアウト",
    quickDeploy: "クイックデプロイ",
    ephemeralPreviews: "PRプレビュー環境",
    autoHealing: "自律的自己修復",
    backupRestore: "バックアップと復元",
  },
  pt: {
    dashboard: "Painel",
    projects: "Projetos",
    apps: "Loja de Aplicativos",
    databases: "Bancos de Dados",
    servers: "Servidores",
    jobs: "Tarefas Agendadas",
    team: "Equipe & RBAC",
    mail: "Correio",
    settings: "Configurações",
    newProject: "Novo Projeto",
    systemHealthy: "Sistemas Operacionais",
    deploy: "Implantar Agora",
    search: "Buscar projetos, apps...",
    clusterNodes: "Nós do Cluster",
    activeContainers: "Contêineres Ativos",
    totalRam: "Uso de RAM",
    storageUsage: "Armazenamento",
    logout: "Sair",
    quickDeploy: "Implantação Rápida",
    ephemeralPreviews: "Pré-visualizações PR",
    autoHealing: "Auto-Cura Autônoma",
    backupRestore: "Backup & Restauração",
  },
  zh: {
    dashboard: "控制面板",
    projects: "项目管理",
    apps: "应用商店",
    databases: "数据库",
    servers: "计算节点",
    jobs: "定时任务",
    team: "团队与权限",
    mail: "自建邮箱",
    settings: "系统设置",
    newProject: "创建新项目",
    systemHealthy: "所有系统运行正常",
    deploy: "立即部署",
    search: "搜索项目、应用、数据库...",
    clusterNodes: "集群节点",
    activeContainers: "运行中容器",
    totalRam: "内存占用",
    storageUsage: "已用存储",
    logout: "退出登录",
    quickDeploy: "一键部署",
    ephemeralPreviews: "PR 临时预览环境",
    autoHealing: "全自动自愈引擎",
    backupRestore: "备份与容灾恢复",
  },
};

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
    }
  }, []);

  useEffect(() => {
    const meta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];
    if (typeof document !== "undefined") {
      document.documentElement.dir = meta.dir;
      document.documentElement.lang = meta.code;
    }
  }, [language]);

  const currentMeta = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  const t = useCallback(
    (key: keyof typeof TRANSLATIONS.en, fallback?: string): string => {
      const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
      return dict[key] || TRANSLATIONS.en[key] || fallback || key;
    },
    [language]
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

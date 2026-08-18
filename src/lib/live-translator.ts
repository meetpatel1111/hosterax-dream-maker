// src/lib/live-translator.ts
// Dynamic Real-Time Full-DOM Live Translation Library for HosteraX
// Translates any arbitrary text, sentences, descriptions, third-party catalogs,
// and UI elements dynamically using an intelligent live translation bridge with LRU caching.

import { LanguageCode } from "./i18n";

// In-memory + LocalStorage Cache to guarantee 0ms latency for repeated strings
const MEMORY_CACHE = new Map<string, string>();
const CACHE_PREFIX = "hx_trans_v1_";

// WeakMaps to store original untranslated text and attributes for lossless restoration
const originalTextMap = new WeakMap<Node, string>();
const originalAttrMap = new WeakMap<Element, Record<string, string>>();

let currentLanguage: LanguageCode = "en";
let observer: MutationObserver | null = null;
let pendingBatch = new Set<Text>();
let batchTimeout: any = null;

// Technical strings & patterns to NOT translate (code, ports, URLs, versions, emails)
const SKIP_PATTERNS = [
  /^https?:\/\//i,
  /^ghcr\.io\//i,
  /^docker\.io\//i,
  /^[a-z0-9_.-]+@[a-z0-9_.-]+\.[a-z]+$/i, // emails
  /^v?\d+(\.\d+)*(-[a-z0-9.]+)?$/i, // version numbers like v1.0.0
  /^:\d{2,5}$/, // ports like :8080
  /^[0-9\s.,:%/\\_+-]+$/, // pure numbers & symbols
  /^[$#]\s/, // shell commands like $ npm run dev
  /^hx$/i,
  /^hosterax$/i,
];

function shouldSkip(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return true;
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

function getCachedTranslation(text: string, lang: LanguageCode): string | null {
  const key = `${lang}:${text.trim()}`;
  if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key)!;

  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(CACHE_PREFIX + key);
      if (stored) {
        MEMORY_CACHE.set(key, stored);
        return stored;
      }
    }
  } catch (e) {}

  return null;
}

function setCachedTranslation(text: string, lang: LanguageCode, translated: string) {
  const key = `${lang}:${text.trim()}`;
  MEMORY_CACHE.set(key, translated);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CACHE_PREFIX + key, translated);
    }
  } catch (e) {}
}

/**
 * Dynamic Live Translation Request via Google GTX / MyMemory translation bridge
 */
async function fetchLiveTranslation(text: string, targetLang: LanguageCode): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || targetLang === "en" || shouldSkip(trimmed)) return text;

  const cached = getCachedTranslation(trimmed, targetLang);
  if (cached) return text.replace(trimmed, cached);

  try {
    // High-speed GTX dynamic translation endpoint
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(
      trimmed,
    )}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Result format: [[["Translated Text", "Original Text", ...]]]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0].map((item: any) => item[0]).join("");
      if (translated) {
        setCachedTranslation(trimmed, targetLang, translated);
        return text.replace(trimmed, translated);
      }
    }
  } catch (err) {
    // Fallback: try alternative MyMemory translation bridge
    try {
      const altUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        trimmed,
      )}&langpair=en|${targetLang}`;
      const altRes = await fetch(altUrl);
      const altData = await altRes.json();
      if (altData?.responseData?.translatedText) {
        const translated = altData.responseData.translatedText;
        setCachedTranslation(trimmed, targetLang, translated);
        return text.replace(trimmed, translated);
      }
    } catch (e) {}
  }

  return text;
}

/**
 * Process a batch of pending text nodes asynchronously
 */
function flushPendingBatch() {
  if (pendingBatch.size === 0 || currentLanguage === "en") return;

  const nodes = Array.from(pendingBatch);
  pendingBatch.clear();

  nodes.forEach(async (textNode) => {
    if (!textNode.isConnected) return;
    const raw = originalTextMap.get(textNode) || textNode.nodeValue || "";
    const trimmed = raw.trim();
    if (!trimmed || shouldSkip(trimmed)) return;

    // Check instant cache
    const cached = getCachedTranslation(trimmed, currentLanguage);
    if (cached) {
      const replaced = raw.replace(trimmed, cached);
      if (textNode.nodeValue !== replaced) textNode.nodeValue = replaced;
      return;
    }

    // Otherwise fetch live translation
    const translated = await fetchLiveTranslation(raw, currentLanguage);
    if (textNode.isConnected && textNode.nodeValue !== translated) {
      textNode.nodeValue = translated;
    }
  });
}

function queueNodeForTranslation(textNode: Text) {
  pendingBatch.add(textNode);
  if (batchTimeout) clearTimeout(batchTimeout);
  batchTimeout = setTimeout(flushPendingBatch, 30);
}

function processNode(node: Node, lang: LanguageCode) {
  // 1. Text Node Processing
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    const raw = textNode.nodeValue || "";
    if (!raw.trim()) return;

    // Skip code, pre, script, style, editable nodes
    const parent = textNode.parentElement;
    if (
      parent &&
      (parent.tagName === "CODE" ||
        parent.tagName === "PRE" ||
        parent.tagName === "SCRIPT" ||
        parent.tagName === "STYLE" ||
        parent.isContentEditable ||
        parent.classList.contains("font-mono"))
    ) {
      return;
    }

    if (!originalTextMap.has(textNode)) {
      originalTextMap.set(textNode, raw);
    }

    const orig = originalTextMap.get(textNode) || raw;

    if (lang === "en") {
      if (textNode.nodeValue !== orig) textNode.nodeValue = orig;
      return;
    }

    const trimmed = orig.trim();
    if (shouldSkip(trimmed)) return;

    // If already in instant cache, apply immediately
    const cached = getCachedTranslation(trimmed, lang);
    if (cached) {
      const replaced = orig.replace(trimmed, cached);
      if (textNode.nodeValue !== replaced) textNode.nodeValue = replaced;
    } else {
      // Queue for dynamic live API translation
      queueNodeForTranslation(textNode);
    }
    return;
  }

  // 2. Element Node (Placeholders & Child nodes)
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;

    if (
      el.tagName === "CODE" ||
      el.tagName === "PRE" ||
      el.tagName === "SCRIPT" ||
      el.tagName === "STYLE"
    ) {
      return;
    }

    // Dynamic translate input placeholders
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
        const cached = getCachedTranslation(origPh.trim(), lang);
        if (cached) {
          el.setAttribute("placeholder", cached);
        } else {
          fetchLiveTranslation(origPh, lang).then((trans) => {
            if (el.isConnected) el.setAttribute("placeholder", trans);
          });
        }
      }
    }

    // Traverse all child nodes
    for (let i = 0; i < el.childNodes.length; i++) {
      processNode(el.childNodes[i], lang);
    }
  }
}

/**
 * Start or update the Live Translation Engine for the entire app
 */
export function startLiveTranslator(lang: LanguageCode) {
  currentLanguage = lang;
  if (typeof document === "undefined") return;

  // Run full DOM sweep
  processNode(document.body, lang);

  // Setup dynamic MutationObserver
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

// StageType shared browser primitives. Zero dependencies, loaded by every page that needs them.
(() => {
  const LANGUAGES = [
    ["en-AU", "English (Australia)"],
    ["en-GB", "English (UK)"],
    ["en-US", "English (US)"],
    ["en-IN", "English (India)"],
    ["es-ES", "Español (España)"],
    ["es-MX", "Español (México)"],
    ["fr-FR", "Français"],
    ["de-DE", "Deutsch"],
    ["it-IT", "Italiano"],
    ["pt-BR", "Português (Brasil)"],
    ["nl-NL", "Nederlands"],
    ["pl-PL", "Polski"],
    ["tr-TR", "Türkçe"],
    ["ru-RU", "Русский"],
    ["ar-SA", "العربية"],
    ["hi-IN", "हिन्दी"],
    ["id-ID", "Bahasa Indonesia"],
    ["vi-VN", "Tiếng Việt"],
    ["th-TH", "ไทย"],
    ["zh-CN", "中文 (普通话)"],
    ["zh-TW", "中文 (台灣)"],
    ["yue-Hant-HK", "粵語 (香港)"],
    ["ja-JP", "日本語"],
    ["ko-KR", "한국어"],
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); return true; } catch { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
    json: (k, fallback) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || "null");
        if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
        return parsed && typeof parsed === "object" ? parsed : fallback;
      } catch {
        return fallback;
      }
    },
  };

  const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const fileStem = (title, roomId, when = Date.now()) => {
    const base = slug(title) || (roomId ? `stagetype-${slug(roomId) || roomId}` : "stagetype-talk");
    return `${base}-${new Date(when || Date.now()).toISOString().split("T")[0]}`;
  };

  const words = (lines) =>
    (Array.isArray(lines) ? lines : []).reduce((n, l) => n + String(l || "").split(/\s+/).filter(Boolean).length, 0);

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const LINK_RE =
    /(?:https?:\/\/[^\s<>"']+|(?<!@)www\.[^\s<>"']+\b|(?<![@\w.-])\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|app|org|net|dev|io|club|fm|co|edu|gov|xyz|art|sh|me|tv|studio|ai|to)\b(?:\/[^\s<>"']*)?)/gi;

  function linkTarget(raw) {
    const cleaned = String(raw || "").trim().replace(/[.,;:!?)\]]+$/, "");
    if (!cleaned) return null;
    const explicit = /^https?:\/\//i.test(cleaned);
    if (!explicit && !/\.[a-z]{2,}/i.test(cleaned)) return null;
    const href = explicit ? cleaned : `https://${cleaned.replace(/^www\./i, "")}`;
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      const host = u.hostname.toLowerCase();
      const isLocal = explicit && (host === "localhost" || host === "127.0.0.1");
      const isDomain = host.includes(".") && /\.[a-z]{2,}$/i.test(host) && !host.startsWith(".") && !host.includes("..");
      return isLocal || isDomain ? u.href : null;
    } catch {
      return null;
    }
  }

  function extractLinks(lines, pinned = []) {
    const out = [];
    for (const p of Array.isArray(pinned) ? pinned : []) {
      const href = linkTarget(typeof p === "string" ? p : p?.url);
      if (href && !out.includes(href)) out.push(href);
    }
    for (const l of Array.isArray(lines) ? lines : []) {
      for (const m of String(l || "").matchAll(LINK_RE)) {
        const href = linkTarget(m[0]);
        if (href && !out.includes(href)) out.push(href);
      }
    }
    return out;
  }

  function applyRoomWords(text, terms = []) {
    if (!text || !terms?.length) return text;
    let out = text;
    for (const term of terms.slice(0, 20)) {
      const clean = String(term || "").trim().slice(0, 40);
      if (clean.length < 2) continue;
      const escTerm = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escTerm}(?![\\p{L}\\p{N}])`, "giu"), () => clean);
      if (/[a-z][A-Z]/.test(clean)) {
        const splitPat = escTerm.replace(/([a-z])([A-Z])/g, "$1\\s+$2");
        out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${splitPat}(?![\\p{L}\\p{N}])`, "giu"), () => clean);
      }
    }
    return out;
  }

  // Pause-based prose paragraphing (8s breath) + ~420-char sentence break + speaker turn transitions.
  function prose(lines, times = [], speakers = [], md = false) {
    const arr = Array.isArray(lines) ? lines : [];
    const paras = [];
    let para = [];
    let paraChars = 0;
    let lastSpeaker = "";
    for (let i = 0; i < arr.length; i++) {
      const gap = i > 0 && times?.[i] && times?.[i - 1] ? times[i] - times[i - 1] : 0;
      const spk = speakers?.[i] || "";
      const spkChanged = i > 0 && spk !== lastSpeaker;
      const sentenceEnd = para.length > 0 && /[.!?。！？]["'’”)]?$/.test(para[para.length - 1]);
      if ((gap > 8000 || spkChanged || (paraChars >= 420 && sentenceEnd)) && para.length) {
        paras.push(para.join(" "));
        para = [];
        paraChars = 0;
      }
      let lineText = arr[i];
      if (spk && spk !== lastSpeaker) {
        lineText = md ? `**${spk}:** ${lineText}` : `${spk}: ${lineText}`;
      }
      lastSpeaker = spk;
      para.push(lineText);
      paraChars += lineText.length;
    }
    if (para.length) paras.push(para.join(" "));
    return paras.join("\n\n");
  }

  function fillLanguages(selectEl, initialValue) {
    if (!selectEl) return;
    if (!selectEl.options.length) {
      for (const [val, label] of LANGUAGES) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        selectEl.append(opt);
      }
    }
    if (initialValue && [...selectEl.options].some((o) => o.value === initialValue)) {
      selectEl.value = initialValue;
    }
  }

  const isRtlLang = (lang) => /^(ar|he|fa|ur)\b/i.test(String(lang || ""));

  window.StageTypeShared = {
    LANGUAGES,
    LINK_RE,
    esc,
    store,
    slug,
    fileStem,
    words,
    download,
    linkTarget,
    extractLinks,
    applyRoomWords,
    prose,
    fillLanguages,
    isRtlLang,
  };
})();

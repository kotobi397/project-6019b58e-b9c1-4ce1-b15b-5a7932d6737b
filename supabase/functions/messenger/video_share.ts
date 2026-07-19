// Analyze video/link attachments shared in Messenger (Facebook reels, YouTube,
// TikTok, Instagram, direct MP4s, etc). We combine what Messenger already sent
// in the webhook (title, url) with any Open Graph metadata we can scrape.

export type ShareItem = {
  url: string;
  title?: string;
  siteName?: string;
  description?: string;
  image?: string;
  uploader?: string;
  duration?: string;
  kind?: "video" | "fallback" | "template";
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function pickMeta(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

function metaRe(prop: string, attr: "property" | "name" = "property"): RegExp {
  return new RegExp(
    `<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
}

// Unwrap l.facebook.com/l.php?u=<real_url> redirect wrappers.
function unwrapFbRedirect(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)facebook\.com$/i.test(u.hostname) && u.pathname === "/l.php") {
      const real = u.searchParams.get("u");
      if (real) return decodeURIComponent(real);
    }
  } catch { /* ignore */ }
  return url;
}

function isDirectMedia(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.(mp4|m4v|mov|webm|mp3|m4a|wav|ogg)(\?|$)/i.test(u.pathname)) return true;
    if (/(^|\.)fbcdn\.net$/i.test(u.hostname)) return true;
    if (/(^|\.)cdninstagram\.com$/i.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

async function scrapeMeta(url: string, out: ShareItem): Promise<void> {
  if (isDirectMedia(url)) return; // CDN mp4s have no HTML
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9,ar;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return;
    const html = (await res.text()).slice(0, 500_000);
    out.title ??= pickMeta(html, [
      metaRe("og:title"),
      metaRe("twitter:title", "name"),
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);
    out.description ??= pickMeta(html, [
      metaRe("og:description"),
      metaRe("description", "name"),
      metaRe("twitter:description", "name"),
    ]);
    out.siteName ??= pickMeta(html, [metaRe("og:site_name")]);
    out.image ??= pickMeta(html, [metaRe("og:image"), metaRe("twitter:image", "name")]);
    out.duration ??= pickMeta(html, [metaRe("og:video:duration"), metaRe("video:duration")]);
    out.uploader ??= pickMeta(html, [
      metaRe("og:video:tag"),
      metaRe("author", "name"),
      metaRe("article:author"),
    ]);
  } catch (e) {
    console.warn("[video_share] scrape failed", url, (e as Error)?.message);
  }
}

function inferSiteName(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/fbcdn\.net$/.test(host) || /facebook\.com$/.test(host)) return "Facebook";
    if (/instagram\.com$|cdninstagram\.com$/.test(host)) return "Instagram";
    if (/tiktok\.com$/.test(host)) return "TikTok";
    if (/youtube\.com$|youtu\.be$/.test(host)) return "YouTube";
    if (/twitter\.com$|x\.com$/.test(host)) return "Twitter/X";
    return host;
  } catch { return undefined; }
}

/**
 * Extract shared items from Messenger attachments. Uses the metadata Facebook
 * already includes in the webhook (title / url / kind) — that's often the only
 * signal available for reels whose payload.url is a CDN mp4.
 */
export function extractShareItems(attachments: any[]): ShareItem[] {
  const items: ShareItem[] = [];
  const seen = new Set<string>();
  for (const a of attachments ?? []) {
    const t = a?.type;
    if (t !== "video" && t !== "fallback" && t !== "template") continue;
    const rawUrl: string | undefined = a?.payload?.url ?? a?.url;
    if (!rawUrl) continue;
    const url = unwrapFbRedirect(rawUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const title: string | undefined = a?.title ?? a?.payload?.title;
    items.push({
      url,
      title: title && title !== url ? title : undefined,
      siteName: inferSiteName(url),
      kind: t,
    });
    if (items.length >= 2) break;
  }
  return items;
}

/**
 * Build a compact Arabic context block describing the shared video(s) for the LLM.
 * Always returns a non-empty string when items are provided so the bot can still
 * respond even if scraping yields nothing (e.g. login-walled Facebook pages).
 */
export async function buildVideoShareContextFromItems(items: ShareItem[]): Promise<string> {
  if (items.length === 0) return "";
  await Promise.all(items.map((it) => scrapeMeta(it.url, it)));

  const parts: string[] = [];
  for (const info of items) {
    const lines: string[] = [];
    lines.push(`رابط: ${info.url}`);
    if (info.siteName) lines.push(`المصدر: ${info.siteName}`);
    if (info.title) lines.push(`العنوان: ${info.title}`);
    if (info.description) lines.push(`الوصف: ${info.description}`);
    if (info.uploader) lines.push(`الناشر: ${info.uploader}`);
    if (info.duration) lines.push(`المدة: ${info.duration} ثانية`);
    if (lines.length === 1) {
      lines.push("(تعذّر استخراج بيانات إضافية من الصفحة — على الأرجح مقطع فيديو من فيسبوك/إنستغرام يحتاج تسجيل دخول)");
    }
    parts.push(lines.join("\n"));
  }
  return [
    "[شارك المستخدم مقطع فيديو/رابط عبر ماسنجر. اعتمد على البيانات التالية للإجابة عن سؤاله (اسم الفيلم/الأغنية/الفنان/المحتوى…). إن لم تحتوِ البيانات على المعلومة المطلوبة صراحةً حاول الاستنتاج من العنوان أو الوصف أو الوسوم أو اسم الناشر، وإلا اعتذر بوضوح واقترح على المستخدم إرسال عنوان الفيديو أو لقطة شاشة له.]",
    ...parts,
  ].join("\n\n");
}

// --- Back-compat wrappers (older imports) ---
export function extractShareUrls(attachments: any[]): string[] {
  return extractShareItems(attachments).map((i) => i.url);
}
export async function buildVideoShareContext(urls: string[]): Promise<string> {
  return await buildVideoShareContextFromItems(urls.map((u) => ({ url: u, siteName: inferSiteName(u) })));
}

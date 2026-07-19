// URL scanning via VirusTotal Public API v3.
// Free tier: 4 req/min, 500/day, 15,500/month.
// We cache each URL for 24 hours to preserve quota.

const VT_API = "https://www.virustotal.com/api/v3";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

// Base64url without padding — VirusTotal's id format for URLs.
function urlToId(url: string): string {
  const b64 = btoa(url);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/[),.;!?»"']+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return u;
  }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  const uniq = new Set<string>();
  for (const m of matches) uniq.add(normalizeUrl(m));
  return Array.from(uniq).slice(0, 3); // فحص حتى 3 روابط في الرسالة
}

type Verdict = "clean" | "suspicious" | "malicious";
type ScanResult = {
  url: string;
  verdict: Verdict;
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  total: number;
};

function classify(malicious: number, suspicious: number): Verdict {
  if (malicious > 0) return "malicious";
  if (suspicious > 0) return "suspicious";
  return "clean";
}

async function vtFetch(path: string, init?: RequestInit) {
  const key = Deno.env.get("VIRUSTOTAL_API_KEY");
  if (!key) throw new Error("VIRUSTOTAL_API_KEY missing");
  return await fetch(`${VT_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-apikey": key,
      "accept": "application/json",
    },
  });
}

async function scanOne(url: string): Promise<ScanResult | null> {
  const id = urlToId(url);

  // 1) try existing report
  let res = await vtFetch(`/urls/${id}`);
  if (res.status === 404) {
    // 2) submit for scanning
    const form = new URLSearchParams();
    form.set("url", url);
    const sub = await vtFetch("/urls", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!sub.ok) {
      console.warn("[virustotal] submit failed", sub.status);
      return null;
    }
    // small wait for analysis (VT usually returns partial fast)
    await new Promise((r) => setTimeout(r, 3000));
    res = await vtFetch(`/urls/${id}`);
  }
  if (!res.ok) {
    console.warn("[virustotal] fetch report failed", res.status);
    return null;
  }
  const json = await res.json();
  const stats = json?.data?.attributes?.last_analysis_stats ?? {};
  const malicious = Number(stats.malicious ?? 0);
  const suspicious = Number(stats.suspicious ?? 0);
  const harmless = Number(stats.harmless ?? 0);
  const undetected = Number(stats.undetected ?? 0);
  const total = malicious + suspicious + harmless + undetected;
  return {
    url,
    verdict: classify(malicious, suspicious),
    malicious,
    suspicious,
    harmless,
    undetected,
    total,
  };
}

async function getCached(admin: any, url: string): Promise<ScanResult | null> {
  const { data } = await admin
    .from("virustotal_cache")
    .select("url,verdict,malicious_count,suspicious_count,harmless_count,undetected_count,updated_at")
    .eq("url", url)
    .maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  const total =
    data.malicious_count + data.suspicious_count + data.harmless_count + data.undetected_count;
  return {
    url,
    verdict: data.verdict,
    malicious: data.malicious_count,
    suspicious: data.suspicious_count,
    harmless: data.harmless_count,
    undetected: data.undetected_count,
    total,
  };
}

async function saveCache(admin: any, r: ScanResult, raw: unknown) {
  await admin.from("virustotal_cache").upsert(
    {
      url: r.url,
      verdict: r.verdict,
      malicious_count: r.malicious,
      suspicious_count: r.suspicious,
      harmless_count: r.harmless,
      undetected_count: r.undetected,
      raw: raw ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "url" },
  );
}

function formatReply(results: ScanResult[]): string {
  const lines: string[] = ["🛡️ *نتيجة فحص الروابط*", ""];
  for (const r of results) {
    const shortUrl = r.url.length > 60 ? r.url.slice(0, 57) + "…" : r.url;
    let head = "";
    if (r.verdict === "malicious") {
      head = `⛔ *خبيث* — ${r.malicious} من أصل ${r.total} محرك حماية رصدَ تهديداً.`;
    } else if (r.verdict === "suspicious") {
      head = `⚠️ *مشبوه* — ${r.suspicious} من أصل ${r.total} محرك حماية أبدى شبهةً في الرابط.`;
    } else {
      head = `✅ *نظيف* — لم يرصد أيٌّ من ${r.total} محرك حماية تهديداً.`;
    }
    lines.push(`🔗 ${shortUrl}`);
    lines.push(head);
    lines.push("");
  }
  const anyBad = results.some((r) => r.verdict !== "clean");
  lines.push(anyBad ? "🔒 يُنصح بعدم فتح الروابط المشبوهة أو الخبيثة." : "📡 مدعوم بـ VirusTotal.");
  return lines.join("\n");
}

/**
 * If the text contains any URLs, scans them via VirusTotal, sends the reply,
 * and returns true. Otherwise returns false without side effects.
 */
export async function maybeScanUrls(
  admin: any,
  text: string,
  send: (msg: string) => Promise<unknown>,
): Promise<boolean> {
  const urls = extractUrls(text);
  if (urls.length === 0) return false;

  const results: ScanResult[] = [];
  for (const url of urls) {
    try {
      const cached = await getCached(admin, url);
      if (cached) {
        results.push(cached);
        continue;
      }
      const r = await scanOne(url);
      if (r) {
        results.push(r);
        await saveCache(admin, r, null);
      }
    } catch (e) {
      console.error("[virustotal] scan failed", url, e);
    }
  }

  if (results.length === 0) {
    await send("⚠️ تعذّر فحص الرابط في الوقت الحالي، حاول لاحقاً.");
    return true;
  }

  await send(formatReply(results));
  return true;
}

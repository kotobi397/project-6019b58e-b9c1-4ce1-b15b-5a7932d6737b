// YouTube video summarizer — pulls the auto/manual transcript from the public
// YouTube watch page (no API key needed) and asks Mistral to produce an
// Arabic bullet-point summary that is safe to send back over Messenger.

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const SUMMARY_MODEL = "mistral-small-latest";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const YT_URL_RE =
  /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

export function extractYoutubeId(text: string): string | null {
  if (!text) return null;
  const m = text.match(YT_URL_RE);
  return m?.[1] ?? null;
}

// Loose intent check — either an explicit summary keyword or "just a YouTube
// link on its own" is treated as a summary request.
export function isYoutubeSummaryIntent(text: string): boolean {
  if (!text) return false;
  const id = extractYoutubeId(text);
  if (!id) return false;
  const stripped = text.replace(YT_URL_RE, " ").trim();
  if (stripped.length === 0) return true; // bare link
  return /(?:لخّص|لخص|تلخيص|ملخّص|ملخص|اختصر|شنو|ماذا|عن ماذا|about|summary|summarize|tl;dr|tldr)/iu
    .test(stripped);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

type CaptionTrack = { baseUrl: string; languageCode?: string; kind?: string };

async function fetchWatchPage(id: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      signal: ctl.signal,
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9,ar;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.warn("[yt] watch fetch failed", (e as Error)?.message);
    return null;
  }
}

function extractTitle(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<title>([^<]+)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s*-\s*YouTube\s*$/i, "").trim() : undefined;
}

function extractCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/"captionTracks":(\[[^\]]+\])/);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1]);
    return raw
      .map((t: any) => ({
        baseUrl: String(t?.baseUrl || "").replace(/\\u0026/g, "&"),
        languageCode: t?.languageCode,
        kind: t?.kind,
      }))
      .filter((t: CaptionTrack) => t.baseUrl);
  } catch {
    return [];
  }
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  const ar = tracks.find((t) => t.languageCode?.startsWith("ar"));
  if (ar) return ar;
  const en = tracks.find((t) => t.languageCode?.startsWith("en"));
  if (en) return en;
  return tracks[0];
}

async function fetchTranscript(track: CaptionTrack): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(track.baseUrl, {
      signal: ctl.signal,
      headers: { "user-agent": UA },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const xml = await res.text();
    const chunks: string[] = [];
    const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const line = decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (line) chunks.push(line);
    }
    return chunks.join(" ").trim() || null;
  } catch (e) {
    console.warn("[yt] transcript fetch failed", (e as Error)?.message);
    return null;
  }
}

async function summarize(
  text: string,
  title: string | undefined,
  mistralKey: string,
): Promise<string | null> {
  const capped = text.slice(0, 18000); // stay well under context limits
  const sys =
    "أنت مساعد يلخّص مقاطع الفيديو بالعربية الفصحى بأسلوب واضح ومحايد. " +
    "أعطِ ملخصاً مركّزاً على شكل نقاط قصيرة (5 إلى 10 نقاط بحسب الطول)، " +
    "ثم سطراً أخيراً بعنوان «الخلاصة:» في جملة أو جملتين. " +
    "التزم بلغة مهذّبة عامة الاستخدام تحترم سياسات ميتا (لا سبّ، لا تحريض، " +
    "لا محتوى جنسي أو عنيف، ولا ادعاءات طبية/سياسية غير موثّقة). " +
    "إن لم يحتوِ النص على معلومات كافية اذكر ذلك بأمانة.";

  const user =
    (title ? `عنوان الفيديو: ${title}\n\n` : "") +
    `النص المستخرج من الفيديو (قد يحتوي أخطاء تفريغ):\n"""\n${capped}\n"""\n\n` +
    "لخّص المحتوى في نقاط بالعربية الفصحى.";

  try {
    const res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${mistralKey}`,
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("[yt] mistral failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch (e) {
    console.warn("[yt] mistral error", (e as Error)?.message);
    return null;
  }
}

export type YoutubeSummaryResult =
  | { ok: true; text: string }
  | { ok: false; reason: "no_transcript" | "no_video" | "llm_failed" };

export async function summarizeYoutube(
  videoId: string,
  mistralKey: string,
): Promise<YoutubeSummaryResult> {
  const html = await fetchWatchPage(videoId);
  if (!html) return { ok: false, reason: "no_video" };
  const title = extractTitle(html);
  const tracks = extractCaptionTracks(html);
  const track = pickTrack(tracks);
  if (!track) return { ok: false, reason: "no_transcript" };
  const transcript = await fetchTranscript(track);
  if (!transcript || transcript.length < 40) return { ok: false, reason: "no_transcript" };
  const summary = await summarize(transcript, title, mistralKey);
  if (!summary) return { ok: false, reason: "llm_failed" };
  const header = title ? `📺 ${title}\n\n` : "";
  const footer = `\n\n🔗 https://youtu.be/${videoId}`;
  return { ok: true, text: header + summary + footer };
}

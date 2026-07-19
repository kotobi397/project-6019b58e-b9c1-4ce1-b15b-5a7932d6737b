// Temp email (disposable inbox) module.
// Prefer providers that currently create working inboxes quickly. Older public
// providers are kept as fallbacks because they can recover intermittently.

const SECMAIL_API = "https://www.1secmail.com/api/v1/";
const TEMPMAILC_API = "https://tempmailc.com/api/v1";
const TEMPMAILPRO_API = "https://tempmailpro.us/api/v1";
const MAILGW_API = "https://api.mail.gw";
const MAILTM_COMPAT_API = "https://api.mail.tm";
const MAIL_API_ENDPOINTS = [MAILGW_API, MAILTM_COMPAT_API];
const GUERRILLA_API = "https://api.guerrillamail.com/ajax.php";
const SECMAIL_PROVIDER = "secmail";
const TEMPMAILC_PROVIDER = "tempmailc";
const TEMPMAILPRO_PROVIDER = "tempmailpro";
const GUERRILLA_PROVIDER = "guerrilla";
const MAILTM_PROVIDER = "mailtm";
const SECMAIL_EXPIRES_MS = 24 * 60 * 60 * 1000;
const TEMPMAILC_EXPIRES_MS = 24 * 60 * 60 * 1000;
const GUERRILLA_EXPIRES_MS = 55 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function ua() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "SolveBot/1.0",
  };
}

export class MailTmError extends Error {
  status: number;
  body: string;
  endpoint: string;
  constructor(status: number, body: string, path: string, endpoint = MAILGW_API) {
    super(`Mail.gw compatible API ${status} on ${path} via ${endpoint}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

export class TempEmailProviderError extends Error {
  provider: string;
  status: number;
  body: string;
  constructor(provider: string, status: number, body: string, path: string) {
    super(`${provider} ${status} on ${path}: ${body.slice(0, 200)}`);
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

function isAccountGone(e: any): boolean {
  if (!e) return false;
  if (e instanceof MailTmError) {
    if (e.status === 401 || e.status === 404) return true;
    if (/no longer exists|not found|disabled|deleted/i.test(e.body)) return true;
  }
  if (e instanceof TempEmailProviderError) {
    if (e.status === 401 || e.status === 404) return true;
    if (/expired|invalid|not found|disabled|deleted/i.test(e.body)) return true;
  }
  const msg = String(e?.message ?? e);
  return /no longer exists|401|404|expired|invalid session|disabled|deleted account/i.test(msg);
}

function isGuerrillaAddress(address: string): boolean {
  return /@(guerrillamail|guerrillamailblock|sharklasers|grr\.la|guerrillamail\.org|guerrillamail\.net|guerrillamail\.biz|spam4\.me)\b/i.test(address || "");
}

function isSecMailAddress(address: string): boolean {
  return /@(1secmail\.com|1secmail\.org|1secmail\.net|esiix\.com|xojxe\.com|yoggm\.com|wuuvo\.com)\b/i.test(address || "");
}

function isMailTmAddress(address: string): boolean {
  const domain = String(address || "").split("@").pop()?.toLowerCase() ?? "";
  return !!domain && !MAILTM_DOMAIN_BLOCKLIST.has(domain);
}

function isSupportedTempAddress(address: string): boolean {
  return isSecMailAddress(address) || isGuerrillaAddress(address) || isMailTmAddress(address);
}

function providerForRow(row: any): "secmail" | "tempmailc" | "tempmailpro" | "guerrilla" | "mailtm" {
  const marker = String(row?.mail_tm_account_id ?? "");
  if (marker.startsWith(`${SECMAIL_PROVIDER}:`) || isSecMailAddress(String(row?.address ?? ""))) return SECMAIL_PROVIDER;
  if (marker.startsWith(`${TEMPMAILC_PROVIDER}:`)) return TEMPMAILC_PROVIDER;
  if (marker.startsWith(`${TEMPMAILPRO_PROVIDER}:`)) return TEMPMAILPRO_PROVIDER;
  if (marker.startsWith(`${GUERRILLA_PROVIDER}:`) || isGuerrillaAddress(String(row?.address ?? ""))) return GUERRILLA_PROVIDER;
  return MAILTM_PROVIDER;
}

async function secmailFetch(params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const path = `?${qs.toString()}`;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchWithTimeout(`${SECMAIL_API}${path}`, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SolveBot/1.0",
        },
      }, 5_000);
      const text = await r.text();
      if (!r.ok) {
        const err = new TempEmailProviderError(SECMAIL_PROVIDER, r.status, text, path);
        lastErr = err;
        if ((r.status === 429 || r.status >= 500) && attempt < 1) {
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      try { return JSON.parse(text); } catch { return text; }
    } catch (e) {
      lastErr = e;
      if (e instanceof TempEmailProviderError && e.status !== 429 && e.status < 500) throw e;
      if (attempt < 1) {
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`SecMail request failed: ${path}`);
}

async function mailtmFetch(path: string, init: RequestInit = {}): Promise<any> {
  let lastErr: any = null;
  for (const endpoint of MAIL_API_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetchWithTimeout(`${endpoint}${path}`, {
          ...init,
          headers: { ...ua(), ...(init.headers || {}) },
        }, 6_000);
        const text = await r.text();
        if (!r.ok) {
          const err = new MailTmError(r.status, text, path, endpoint);
          lastErr = err;
          // Retry transient provider failures, then try the compatible endpoint.
          if ((r.status === 429 || r.status >= 500) && attempt < 1) {
            await new Promise((res) => setTimeout(res, 350 * (attempt + 1)));
            continue;
          }
          // A token/account may belong to the compatible endpoint, so do not
          // treat auth/not-found from the first endpoint as final.
          if (r.status === 401 || r.status === 404 || r.status === 429 || r.status >= 500) break;
          throw err;
        }
        try { return JSON.parse(text); } catch { return text; }
      } catch (e) {
        lastErr = e;
        if (e instanceof MailTmError && e.status !== 401 && e.status !== 404 && e.status !== 429 && e.status < 500) throw e;
        if (attempt < 1) {
          await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
          continue;
        }
      }
    }
  }
  throw lastErr ?? new Error(`Mail.gw compatible request failed: ${path}`);
}

async function guerrillaFetch(params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const path = `?${qs.toString()}`;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(`${GUERRILLA_API}${path}`, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SolveBot/1.0",
        },
      }, 5_000);
      const text = await r.text();
      if (!r.ok) {
        if ((r.status === 429 || r.status >= 500) && attempt < 2) {
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        throw new TempEmailProviderError(GUERRILLA_PROVIDER, r.status, text, path);
      }
      const data = JSON.parse(text);
      if (data?.auth && data.auth.success === false) {
        throw new TempEmailProviderError(GUERRILLA_PROVIDER, 401, JSON.stringify(data.auth), path);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e instanceof TempEmailProviderError && e.status !== 429 && e.status < 500) throw e;
      if (attempt < 2) {
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`GuerrillaMail request failed: ${path}`);
}


// Some mail.tm domains (e.g. tempmail.dev) are aggressively blocked by many
// registration sites as "disposable". Skip them so we never hand a user an
// address that gets rejected at signup.
const MAILTM_DOMAIN_BLOCKLIST = new Set<string>([
  "web-library.net",
  "tempmail.dev",
  "tempmailo.com",
  "tempmail.us.com",
  "10minutemail.com",
]);

async function getDomain(): Promise<string> {
  const res = await mailtmFetch("/domains?page=1");
  const list: any[] = Array.isArray(res)
    ? res
    : (res?.["hydra:member"] ?? res?.member ?? res?.data ?? []);
  console.log("[temp_email] domains raw", JSON.stringify(res).slice(0, 400));
  const usable = list.filter((d: any) =>
    (d?.isActive ?? true) &&
    !(d?.isPrivate ?? false) &&
    d?.domain &&
    !MAILTM_DOMAIN_BLOCKLIST.has(String(d.domain).toLowerCase())
  );
  const active = usable[0] ?? list.find((d: any) => d?.domain && !MAILTM_DOMAIN_BLOCKLIST.has(String(d.domain).toLowerCase()));
  if (!active?.domain) throw new Error(`No mail.tm domain available (got ${list.length} items)`);
  return active.domain as string;
}


function randLocal(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randPass(len = 16) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

type TempAccount = { address: string; password: string; id: string; token: string; provider: string; expiresAt: string; lastMessageId: string | null };

async function tempmailcFetch(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetchWithTimeout(`${TEMPMAILC_API}${path}`, {
    ...init,
    headers: { ...ua(), ...(init.headers || {}) },
  }, 6_000);
  const text = await r.text();
  if (!r.ok) throw new TempEmailProviderError(TEMPMAILC_PROVIDER, r.status, text, path);
  try { return JSON.parse(text); } catch { return text; }
}

async function tempmailproFetch(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetchWithTimeout(`${TEMPMAILPRO_API}${path}`, {
    ...init,
    headers: { ...ua(), ...(init.headers || {}) },
  }, 6_000);
  const text = await r.text();
  if (!r.ok) throw new TempEmailProviderError(TEMPMAILPRO_PROVIDER, r.status, text, path);
  try { return JSON.parse(text); } catch { return text; }
}

function parseSecMailAddress(address: string): { login: string; domain: string } | null {
  const [login, domain] = String(address || "").trim().split("@");
  if (!login || !domain) return null;
  return { login, domain };
}

function parseSecMailToken(token: string): { login: string; domain: string } | null {
  const parts = String(token || "").split(":");
  if (parts.length >= 3 && parts[0] === SECMAIL_PROVIDER && parts[1] && parts[2]) {
    return { login: parts[1], domain: parts.slice(2).join(":") };
  }
  return parseSecMailAddress(token);
}

async function createSecMailAccount(): Promise<TempAccount> {
  const data = await secmailFetch({ action: "genRandomMailbox", count: 1 });
  const address = String(Array.isArray(data) ? data[0] : data?.[0] ?? "").trim();
  const parsed = parseSecMailAddress(address);
  if (!address || !parsed) throw new Error("SecMail did not return an inbox");
  if (!isSupportedTempAddress(address)) throw new Error(`Unsupported temporary email domain returned: ${address}`);
  const marker = `${SECMAIL_PROVIDER}:${parsed.login}:${parsed.domain}`;
  return {
    address,
    password: "secmail-session",
    id: marker,
    token: marker,
    provider: SECMAIL_PROVIDER,
    expiresAt: new Date(Date.now() + SECMAIL_EXPIRES_MS).toISOString(),
    lastMessageId: null,
  };
}

async function createGuerrillaAccount(): Promise<TempAccount> {
  const data = await guerrillaFetch({ f: "get_email_address", agent: "SolveBot" });
  const address = String(data?.email_addr ?? "").trim();
  const token = String(data?.sid_token ?? "").trim();
  if (!address || !token) throw new Error("GuerrillaMail did not return an inbox");
  if (!isSupportedTempAddress(address)) throw new Error(`Unsupported temporary email domain returned: ${address}`);
  let lastMessageId: string | null = null;
  try {
    const inbox = await guerrillaFetch({ f: "check_email", sid_token: token, seq: 0 });
    const welcome = Array.isArray(inbox?.list) ? inbox.list : [];
    if (welcome.length) {
      welcome.sort((a: any, b: any) => Number(b?.mail_id ?? 0) - Number(a?.mail_id ?? 0));
      lastMessageId = String(welcome[0]?.mail_id ?? "") || null;
    }
  } catch (_e) { /* welcome watermark is best-effort */ }
  return {
    address,
    password: "guerrilla-session",
    id: `${GUERRILLA_PROVIDER}:${token}`,
    token,
    provider: GUERRILLA_PROVIDER,
    expiresAt: new Date(Date.now() + GUERRILLA_EXPIRES_MS).toISOString(),
    lastMessageId,
  };
}

async function createTempmailcAccount(): Promise<TempAccount> {
  const data = await tempmailcFetch("/new");
  const address = String(data?.email ?? "").trim();
  if (!data?.ok || !address || !address.includes("@")) throw new Error("TempMailC did not return an inbox");
  const marker = `${TEMPMAILC_PROVIDER}:${address}`;
  return {
    address,
    password: "tempmailc-session",
    id: marker,
    token: marker,
    provider: TEMPMAILC_PROVIDER,
    expiresAt: new Date(Date.now() + TEMPMAILC_EXPIRES_MS).toISOString(),
    lastMessageId: null,
  };
}

async function createTempmailproAccount(): Promise<TempAccount> {
  const data = await tempmailproFetch("/mailbox/create", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const box = data?.data ?? data;
  const address = String(box?.address ?? "").trim();
  const token = String(box?.token ?? "").trim();
  if (!data?.success || !address || !token) throw new Error("TempMailPro did not return an inbox");
  const expiresAt = box?.expires_at
    ? new Date(Number(box.expires_at) * 1000).toISOString()
    : new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return {
    address,
    password: "tempmailpro-session",
    id: `${TEMPMAILPRO_PROVIDER}:${token}`,
    token,
    provider: TEMPMAILPRO_PROVIDER,
    expiresAt,
    lastMessageId: null,
  };
}

async function createMailTmAccount(): Promise<TempAccount> {
  const domain = await getDomain();
  // Try up to 3 times in case of collision
  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    const address = `${randLocal(10 + i)}@${domain}`;
    const password = randPass(16);
    try {
      const acc = await mailtmFetch("/accounts", {
        method: "POST",
        body: JSON.stringify({ address, password }),
      });
      const tok = await mailtmFetch("/token", {
        method: "POST",
        body: JSON.stringify({ address, password }),
      });
      return {
        address,
        password,
        id: acc?.id ?? "",
        token: tok?.token ?? "",
        provider: MAILTM_PROVIDER,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        lastMessageId: null,
      };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr ?? new Error("Failed to create mail.tm account");
}

async function createAccount(): Promise<TempAccount> {
  const creators = [createTempmailcAccount, createTempmailproAccount, createGuerrillaAccount, createSecMailAccount, createMailTmAccount];
  let lastErr: any = null;
  for (const create of creators) {
    try {
      const account = await create();
      if (!isSupportedTempAddress(account.address)) {
        throw new Error(`Rejected unsupported temporary email address: ${account.address}`);
      }
      return account;
    } catch (e) {
      lastErr = e;
      console.warn("[temp_email] provider create failed, trying next", e);
    }
  }
  throw lastErr ?? new Error("Failed to create a temporary email account");
}



async function listSecMailMessages(token: string): Promise<any[]> {
  const parsed = parseSecMailToken(token);
  if (!parsed) throw new TempEmailProviderError(SECMAIL_PROVIDER, 401, "invalid secmail token", "listMessages");
  const res = await secmailFetch({ action: "getMessages", login: parsed.login, domain: parsed.domain });
  const list = Array.isArray(res) ? res : [];
  return list
    .map((m: any) => ({
      id: String(m?.id ?? ""),
      from: { address: m?.from ?? "unknown" },
      subject: m?.subject ?? "(بلا موضوع)",
      intro: m?.date ?? "",
      createdAt: m?.date ?? "",
      _provider: SECMAIL_PROVIDER,
    }))
    .filter((m: any) => m.id)
    .sort((a: any, b: any) => Number(b.id) - Number(a.id));
}

async function getSecMailMessage(token: string, id: string): Promise<any> {
  const parsed = parseSecMailToken(token);
  if (!parsed) throw new TempEmailProviderError(SECMAIL_PROVIDER, 401, "invalid secmail token", "readMessage");
  const full = await secmailFetch({ action: "readMessage", login: parsed.login, domain: parsed.domain, id });
  return {
    id: String(full?.id ?? id),
    from: { address: full?.from ?? "unknown" },
    subject: full?.subject ?? "(بلا موضوع)",
    text: full?.textBody ?? "",
    html: full?.htmlBody ?? undefined,
    _provider: SECMAIL_PROVIDER,
  };
}

function parseTempmailcToken(token: string): string {
  return String(token || "").startsWith(`${TEMPMAILC_PROVIDER}:`)
    ? String(token).slice(`${TEMPMAILC_PROVIDER}:`.length)
    : String(token || "");
}

async function listTempmailcMessages(token: string): Promise<any[]> {
  const email = parseTempmailcToken(token);
  if (!email.includes("@")) throw new TempEmailProviderError(TEMPMAILC_PROVIDER, 401, "invalid tempmailc token", "listMessages");
  const res = await tempmailcFetch(`/inbox?email=${encodeURIComponent(email)}`);
  const list = Array.isArray(res?.messages) ? res.messages : [];
  return list
    .map((m: any) => ({
      id: String(m?.id ?? m?.msg_id ?? ""),
      from: { address: m?.from ?? "unknown" },
      subject: m?.subject ?? "(بلا موضوع)",
      intro: m?.text ?? m?.intro ?? "",
      createdAt: m?.ts ?? m?.created_at ?? "",
      _provider: TEMPMAILC_PROVIDER,
    }))
    .filter((m: any) => m.id)
    .sort((a: any, b: any) => Number(b.createdAt || b.id || 0) - Number(a.createdAt || a.id || 0));
}

async function getTempmailcMessage(token: string, id: string): Promise<any> {
  const email = parseTempmailcToken(token);
  const full = await tempmailcFetch(`/message?email=${encodeURIComponent(email)}&msg_id=${encodeURIComponent(id)}`);
  return {
    id: String(full?.id ?? id),
    from: { address: full?.from ?? "unknown" },
    subject: full?.subject ?? "(بلا موضوع)",
    text: full?.text ?? "",
    html: full?.html ?? undefined,
    _provider: TEMPMAILC_PROVIDER,
  };
}

async function listTempmailproMessages(token: string): Promise<any[]> {
  const res = await tempmailproFetch(`/mailbox/${encodeURIComponent(token)}/emails`);
  const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.emails) ? res.emails : (Array.isArray(res) ? res : []));
  return list
    .map((m: any) => ({
      id: String(m?.id ?? ""),
      from: { address: m?.from ?? m?.fromAddr ?? m?.from_addr ?? "unknown" },
      subject: m?.subject ?? m?.headerSubject ?? m?.header_subject ?? "(بلا موضوع)",
      intro: m?.text ?? m?.preview ?? "",
      createdAt: m?.received_at ?? m?.receivedAt ?? m?.created_at ?? m?.id ?? "",
      _provider: TEMPMAILPRO_PROVIDER,
    }))
    .filter((m: any) => m.id)
    .sort((a: any, b: any) => Number(b.createdAt || b.id || 0) - Number(a.createdAt || a.id || 0));
}

async function getTempmailproMessage(token: string, id: string): Promise<any> {
  const fullRes = await tempmailproFetch(`/mailbox/${encodeURIComponent(token)}/emails/${encodeURIComponent(id)}`);
  const full = fullRes?.data ?? fullRes;
  return {
    id: String(full?.id ?? id),
    from: { address: full?.from ?? full?.fromAddr ?? full?.from_addr ?? "unknown" },
    subject: full?.subject ?? full?.headerSubject ?? full?.header_subject ?? "(بلا موضوع)",
    text: full?.text ?? full?.text_body ?? "",
    html: full?.html ?? full?.html_body ?? undefined,
    _provider: TEMPMAILPRO_PROVIDER,
  };
}

async function listMailTmMessages(token: string): Promise<any[]> {
  const res = await mailtmFetch("/messages?page=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res?.["hydra:member"] ?? res?.member ?? [];
}

async function getMailTmMessage(token: string, id: string): Promise<any> {
  return await mailtmFetch(`/messages/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function listGuerrillaMessages(token: string): Promise<any[]> {
  const res = await guerrillaFetch({ f: "check_email", sid_token: token, seq: 0 });
  const list = Array.isArray(res?.list) ? res.list : [];
  return list
    .map((m: any) => ({
      id: String(m?.mail_id ?? ""),
      from: { address: m?.mail_from ?? "unknown" },
      subject: m?.mail_subject ?? "(بلا موضوع)",
      intro: m?.mail_excerpt ?? "",
      createdAt: Number(m?.mail_timestamp ?? 0),
      _provider: GUERRILLA_PROVIDER,
    }))
    .filter((m: any) => m.id)
    .sort((a: any, b: any) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

async function getGuerrillaMessage(token: string, id: string): Promise<any> {
  const full = await guerrillaFetch({ f: "fetch_email", sid_token: token, email_id: id });
  const body = String(full?.mail_body ?? full?.mail_excerpt ?? "");
  const hasHtml = /<[^>]+>|&[a-z#0-9]+;/i.test(body);
  return {
    id: String(full?.mail_id ?? id),
    from: { address: full?.mail_from ?? "unknown" },
    subject: full?.mail_subject ?? "(بلا موضوع)",
    text: hasHtml ? stripHtml(body) : body,
    html: hasHtml ? body : undefined,
    _provider: GUERRILLA_PROVIDER,
  };
}

async function listMessages(provider: "secmail" | "tempmailc" | "tempmailpro" | "guerrilla" | "mailtm", token: string): Promise<any[]> {
  if (provider === SECMAIL_PROVIDER) return await listSecMailMessages(token);
  if (provider === TEMPMAILC_PROVIDER) return await listTempmailcMessages(token);
  if (provider === TEMPMAILPRO_PROVIDER) return await listTempmailproMessages(token);
  return provider === GUERRILLA_PROVIDER ? await listGuerrillaMessages(token) : await listMailTmMessages(token);
}

async function getMessage(provider: "secmail" | "tempmailc" | "tempmailpro" | "guerrilla" | "mailtm", token: string, id: string): Promise<any> {
  if (provider === SECMAIL_PROVIDER) return await getSecMailMessage(token, id);
  if (provider === TEMPMAILC_PROVIDER) return await getTempmailcMessage(token, id);
  if (provider === TEMPMAILPRO_PROVIDER) return await getTempmailproMessage(token, id);
  return provider === GUERRILLA_PROVIDER ? await getGuerrillaMessage(token, id) : await getMailTmMessage(token, id);
}

async function refreshToken(address: string, password: string): Promise<string> {
  const tok = await mailtmFetch("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  return tok?.token ?? "";
}

// ==================== Bot integration ====================

type SendFn = (text: string) => Promise<void>;
export type TempEmailIntent = "create" | "check" | "delete" | "mine";

const TEMP_EMAIL_RE = {
  create: /(?:\b(?:temp|temporary|fake|disposable|throwaway)\b.*\b(?:e?[- ]?mail|inbox)\b|\b(?:e?[- ]?mail|inbox)\b.*\b(?:temp|temporary|fake|disposable|throwaway)\b|(?:اعط(?:ني|يني|ينى|يني)|أعط(?:ني|يني|ينى|يني)|بد?ي|اريد|أريد|ابغى|انشئ|أنشئ|جيب(?:\s*ل?ي)?|هات|اصنع|اعمل|ابغي|اعطينى)\s*(?:لي\s*)?(?:بريد[اً]?|ايميل[اً]?|إيميل[اً]?|ايميل|إيميل|e?mail)(?:\s*(?:الكتروني|إلكتروني|الكتروني|الإلكتروني|email|mail))?\s*(?:مؤقت[اً]?|وهمي[اً]?|مزيف[اً]?|مؤقتة|وهمية|مزيفة))/iu,
  check: /(?:\b(?:check|show|read|open)\b.*\b(?:inbox|mail|email|messages)\b|(?:تحقق|شوف|افحص|اطلع|شيك|شيّك|ارني|أرني|اعرض)\s*(?:على\s*)?(?:البريد|الايميل|الإيميل|الرسائل|الوارد|inbox|صندوق))/iu,
  del: /(?:\b(?:delete|remove|destroy|kill)\b.*\b(?:inbox|mail|email|address)\b|(?:احذف|امسح|الغي|ألغي|امح)\s*(?:ال)?(?:بريد|ايميل|إيميل|inbox))/iu,
  mine: /(?:\bmy\s+(?:temp\s+)?(?:e?mail|inbox)\b|(?:ما\s*هو\s*)?(?:بريدي|ايميلي|إيميلي)(?:\s*(?:المؤقت|الوهمي))?)/iu,
};

const TEMP_EMAIL_CREATE_WORDS_RE = /(?:اعطني|اعطيني|اعطينى|اريد|ابغي|ابغى|هات|جيب|سوي|سوّي|اعط|انشئ|انشا|اصنع|اعمل|ابعت|ابعث|ارسل|وفر|وفرلي|ممكن|احتاج|أحتاج|بدي|بدى|give|create|make|generate|new|need|want)/iu;
const TEMP_EMAIL_WORDS_RE = /(?:\b(?:email|e-mail|mail|inbox|address)\b|بريد|ايميل|اميل|ايمال|ايمِل|الايميل|البريد|عنوان\s*بريد|صندوق\s*بريد)/iu;
const TEMP_EMAIL_TEMP_WORDS_RE = /(?:\b(?:temp|temporary|fake|disposable|throwaway|burner)\b|مؤقت|موقت|وهمي|مزيف|عشوائي|مهمل|Disposable|فاك)/iu;
const TEMP_EMAIL_PURPOSE_RE = /(?:تسجيل|اسجل|أسجل|نسجل|signup|sign\s*up|verify|verification|تحقق|تفعيل|كود|رمز|حساب|موقع|استعمله|استخدمه|نستعمله|نستخدمه)/iu;

function normalizeArabicIntent(text: string): string {
  return String(text || "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[\u200f\u200e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isTempEmailIntent(text: string): TempEmailIntent | null {
  if (!text) return null;
  const t = text.trim();
  const n = normalizeArabicIntent(t);
  if (TEMP_EMAIL_RE.del.test(t)) return "delete";
  if (TEMP_EMAIL_RE.create.test(t)) return "create";
  const hasEmailWord = TEMP_EMAIL_WORDS_RE.test(n);
  const hasTempWord = TEMP_EMAIL_TEMP_WORDS_RE.test(n);
  const hasCreateWord = TEMP_EMAIL_CREATE_WORDS_RE.test(n);
  const hasPurposeWord = TEMP_EMAIL_PURPOSE_RE.test(n);
  if (hasEmailWord && hasTempWord && (hasCreateWord || n.length <= 80)) return "create";
  if (hasEmailWord && hasCreateWord && hasPurposeWord && n.length <= 140) return "create";
  if (hasTempWord && hasCreateWord && hasPurposeWord && n.length <= 140) return "create";
  if (TEMP_EMAIL_RE.check.test(t)) return "check";
  if (TEMP_EMAIL_RE.mine.test(t)) return "mine";
  return null;
}

export async function createTempEmailInbox(admin: any, senderId: string): Promise<{ address: string; expires_at: string; duration: string }> {
  await admin.from("temp_emails").update({ active: false }).eq("facebook_user_id", senderId).eq("active", true);
  const fresh = await createAccount();
  await admin.from("temp_emails").insert({
    facebook_user_id: senderId,
    address: fresh.address,
    password: fresh.password,
    mail_tm_account_id: fresh.id,
    token: fresh.token,
    expires_at: fresh.expiresAt,
    last_message_id: fresh.lastMessageId,
  });
  return {
    address: fresh.address,
    expires_at: fresh.expiresAt,
    duration: fresh.provider === GUERRILLA_PROVIDER ? "حوالي ساعة واحدة" : "24 ساعة",
  };
}

async function extractVerification(mistralApiKey: string, subject: string, from: string, body: string): Promise<string> {
  // Ask Mistral to extract the key info (code / link / short summary in Arabic).
  const prompt = `أنت مساعد ذكي. المستخدم ينتظر رسالة تحقق أو كود من بريد إلكتروني. استخرج المعلومة المهمة فقط من الرسالة التالية وقدمها بشكل مختصر جداً بالعربية.\n\nالقواعد:\n- إذا وُجد كود تحقق (رقم أو رمز) اكتبه بوضوح: "الكود: 123456"\n- إذا وُجد رابط تحقق/تفعيل انسخه كاملاً: "رابط التحقق: https://..."\n- إذا كانت رسالة ترحيب أو إشعار عام لخّصها في سطر واحد.\n- لا تضف مقدمات أو تعليقات. أجب مباشرة.\n\nمن: ${from}\nالموضوع: ${subject}\n\nنص الرسالة:\n${body.slice(0, 4000)}`;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mistralApiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-small-2603",
        temperature: 0.1,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`mistral ${r.status}`);
    const j = await r.json();
    const out = String(j?.choices?.[0]?.message?.content ?? "").trim();
    return out || "";
  } catch (e) {
    console.warn("[temp_email] extract failed", e);
    // Fallback: regex for 4-8 digit code
    const codeMatch = body.match(/\b(\d{4,8})\b/);
    if (codeMatch) return `الكود: ${codeMatch[1]}`;
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; } });
}

function stripHtml(html: string): string {
  let s = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  // Decode entities repeatedly in case of double-encoding
  for (let i = 0; i < 3; i++) s = decodeEntities(s);
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Check if the user has messaged us within the last 24 hours (Facebook policy). */
async function isWithin24hWindow(admin: any, facebookUserId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from("messages")
      .select("id")
      .eq("facebook_user_id", facebookUserId)
      .eq("sender_type", "user")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** Poll new messages for one account and forward each to the user. */
export async function pollAndForward(admin: any, row: any, sendAndLog: (text: string) => Promise<void>): Promise<void> {
  const mistralKey = Deno.env.get("MISTRAL_API_KEY") ?? "";
  let token: string = row.token || "";
  const provider = providerForRow(row);
  const tryList = async (): Promise<any[]> => {
    try {
      return await listMessages(provider, token);
    } catch (e) {
      // If a provider invalidated the inbox, auto-recover with a fresh account.
      if (isAccountGone(e)) {
        console.warn("[temp_email] account gone, recreating for", row.facebook_user_id);
        await admin.from("temp_emails").update({ active: false }).eq("id", row.id);
        try {
          const fresh = await createAccount();
          await admin.from("temp_emails").insert({
            facebook_user_id: row.facebook_user_id,
            address: fresh.address,
            password: fresh.password,
            mail_tm_account_id: fresh.id,
            token: fresh.token,
            expires_at: fresh.expiresAt,
            last_message_id: fresh.lastMessageId,
          });
          if (await isWithin24hWindow(admin, row.facebook_user_id)) {
            await sendAndLog(
              [
                `⚠️ بريدك المؤقت السابق (${row.address}) تم إلغاؤه من مزوّد الخدمة.`,
                ``,
                `✅ أنشأت لك بريداً جديداً:`,
                `📧 ${fresh.address}`,
                ``,
                `استخدم هذا الجديد للتسجيل، وسأرسل لك أي رسالة تصل تلقائياً.`,
              ].join("\n"),
            );
          } else {
            console.log("[temp_email] skip recreate notice (outside 24h window)", row.facebook_user_id);
          }
        } catch (e2) {
          console.error("[temp_email] auto-recreate failed", e2);
        }
        return [];
      }
      if (provider === GUERRILLA_PROVIDER) throw e;
      // token might have expired — refresh once
      try {
        token = await refreshToken(row.address, row.password);
        await admin.from("temp_emails").update({ token }).eq("id", row.id);
        return await listMessages(provider, token);
      } catch (e2) {
        if (isAccountGone(e2)) {
          // same recovery path
          await admin.from("temp_emails").update({ active: false }).eq("id", row.id);
          try {
            const fresh = await createAccount();
            await admin.from("temp_emails").insert({
              facebook_user_id: row.facebook_user_id,
              address: fresh.address,
              password: fresh.password,
              mail_tm_account_id: fresh.id,
              token: fresh.token,
              expires_at: fresh.expiresAt,
              last_message_id: fresh.lastMessageId,
            });
            if (await isWithin24hWindow(admin, row.facebook_user_id)) {
              await sendAndLog(
                `⚠️ بريدك المؤقت السابق انتهى. أنشأت لك بريداً جديداً:\n📧 ${fresh.address}`,
              );
            } else {
              console.log("[temp_email] skip expired notice (outside 24h window)", row.facebook_user_id);
            }
          } catch (e3) { console.error("[temp_email] auto-recreate failed", e3); }
          return [];
        }
        throw e2;
      }
    }
  };

  const msgs = await tryList();
  if (!msgs.length) return;

  // messages come newest first; process those newer than last_message_id
  const lastId: string | null = row.last_message_id || null;
  const fresh: any[] = [];
  for (const m of msgs) {
    if (lastId && m.id === lastId) break;
    fresh.push(m);
  }
  if (!fresh.length) return;

  // Process oldest → newest
  fresh.reverse();
  for (const m of fresh) {
    try {
      const full = await getMessage(provider, token, m.id);
      const from = full?.from?.address ?? m?.from?.address ?? "unknown";
      const subject = full?.subject ?? m?.subject ?? "(بلا موضوع)";
      let bodyRaw = full?.text ?? (full?.html ? stripHtml(Array.isArray(full.html) ? full.html.join("\n") : full.html) : m?.intro ?? "");
      // Safety net: if text still looks like HTML (some providers return HTML in the text field), strip it.
      if (/<[a-z!/][\s\S]*?>|&[a-z#0-9]+;/i.test(bodyRaw)) bodyRaw = stripHtml(bodyRaw);
      const extracted = mistralKey ? await extractVerification(mistralKey, subject, from, bodyRaw) : "";
      const preview = bodyRaw.slice(0, 500);
      const parts = [
        `📩 وصلتك رسالة جديدة على بريدك المؤقت`,
        `📧 من: ${from}`,
        `📌 الموضوع: ${subject}`,
      ];
      if (extracted) parts.push(`\n✨ ${extracted}`);
      else if (preview) parts.push(`\n📝 ${preview}`);
      await sendAndLog(parts.join("\n"));
    } catch (e) {
      console.warn("[temp_email] forward failed", e);
    }
  }

  // Update watermark to newest id (first item in original list)
  await admin.from("temp_emails")
    .update({ last_message_id: msgs[0].id, token })
    .eq("id", row.id);
}

/** Handle a user intent. Returns true if the intent was consumed. */
export async function handleTempEmailIntent(
  admin: any,
  senderId: string,
  intent: "create" | "check" | "delete" | "mine",
  sendAndLog: (text: string) => Promise<void>,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("temp_emails")
    .select("*")
    .eq("facebook_user_id", senderId)
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && !isSupportedTempAddress(String(existing.address ?? ""))) {
    await admin.from("temp_emails").update({ active: false }).eq("id", existing.id);
    if (intent !== "delete") {
      try {
        const fresh = await createAccount();
        await admin.from("temp_emails").insert({
          facebook_user_id: senderId,
          address: fresh.address,
          password: fresh.password,
          mail_tm_account_id: fresh.id,
          token: fresh.token,
          expires_at: fresh.expiresAt,
          last_message_id: fresh.lastMessageId,
        });
        await sendAndLog(
          [
            `⚠️ البريد السابق (${existing.address}) كان من نطاق غير مقبول وتم إلغاؤه.`,
            ``,
            `✅ أنشأت لك بريداً صالحاً جديداً:`,
            `📧 ${fresh.address}`,
            ``,
            `استخدمه الآن، وسأرسل لك أي رسالة تصل تلقائياً.`,
          ].join("\n"),
        );
      } catch (e) {
        console.error("[temp_email] replace unsupported address failed", e);
        await sendAndLog("تعذر إنشاء بريد مؤقت موثوق الآن. حاول بعد قليل.");
      }
      return true;
    }
  }

  if (intent === "delete") {
    if (!existing) { await sendAndLog("لا يوجد بريد مؤقت نشط لديك حالياً."); return true; }
    await admin.from("temp_emails").update({ active: false }).eq("id", existing.id);
    await sendAndLog(`تم حذف البريد المؤقت: ${existing.address} ✅\nلن تصلك رسائل عليه بعد الآن.`);
    return true;
  }

  if (intent === "mine" || intent === "check") {
    if (!existing) {
      await sendAndLog("ليس لديك بريد مؤقت حالياً. قل \"أعطني بريد مؤقت\" لإنشاء واحد.");
      return true;
    }
    if (intent === "mine") {
      const remainingMs = Math.max(0, new Date(existing.expires_at).getTime() - Date.now());
      const expiresInHours = Math.floor(remainingMs / 3600000);
      const expiresText = expiresInHours >= 1
        ? `${expiresInHours} ساعة تقريباً`
        : `${Math.max(1, Math.ceil(remainingMs / 60000))} دقيقة تقريباً`;
      await sendAndLog(`📧 بريدك المؤقت الحالي:\n${existing.address}\n\n⏳ ينتهي خلال ${expiresText}.\nأي رسالة تصل ستُرسل لك تلقائياً.`);
      return true;
    }
    // check inbox: poll now
    await sendAndLog("جاري فحص بريدك... 🔍");
    try {
      await pollAndForward(admin, existing, sendAndLog);
      // If nothing was forwarded, tell them
      const { data: updated } = await admin.from("temp_emails").select("last_message_id").eq("id", existing.id).maybeSingle();
      if (!updated?.last_message_id || updated.last_message_id === existing.last_message_id) {
        await sendAndLog("لا توجد رسائل جديدة. سأخبرك فور وصول أي رسالة.");
      }
    } catch (e) {
      console.error("[temp_email] check failed", e);
      await sendAndLog("تعذر فحص البريد الآن، حاول بعد قليل.");
    }
    return true;
  }

  // create
  try {
    // Deactivate previous active email(s) for this user
    if (existing) {
      await admin.from("temp_emails").update({ active: false }).eq("facebook_user_id", senderId).eq("active", true);
    }
    const fresh = await createAccount();
    await admin.from("temp_emails").insert({
      facebook_user_id: senderId,
      address: fresh.address,
      password: fresh.password,
      mail_tm_account_id: fresh.id,
      token: fresh.token,
      expires_at: fresh.expiresAt,
      last_message_id: fresh.lastMessageId,
    });
    const duration = fresh.provider === GUERRILLA_PROVIDER ? "حوالي ساعة واحدة" : "24 ساعة";
    await sendAndLog(
      [
        `✅ تم إنشاء بريد مؤقت لك:`,
        ``,
        `📧 ${fresh.address}`,
        ``,
        `استخدمه للتسجيل في أي موقع، وأي رسالة تصله (كود تحقق، رابط تفعيل، إلخ) سأرسلها لك تلقائياً هنا.`,
        ``,
        `⏳ مدة الصلاحية: ${duration}.`,
        `للحذف قل: "احذف بريدي"`,
      ].join("\n"),
    );
    return true;
  } catch (e) {
    console.error("[temp_email] create failed", e);
    await sendAndLog("تعذر إنشاء بريد مؤقت الآن. حاول بعد قليل.");
    return true;
  }
}

/** Poll ALL active temp emails and forward new messages. Used by cron. */
export async function pollAllActive(admin: any, sendForUser: (senderId: string, text: string) => Promise<void>): Promise<{ checked: number; forwarded: number }> {
  const now = new Date().toISOString();
  const { data: rows } = await admin
    .from("temp_emails")
    .select("*")
    .eq("active", true)
    .gt("expires_at", now);
  let checked = 0, forwarded = 0;
  for (const row of rows ?? []) {
    checked++;
    try {
      const before = row.last_message_id;
      await pollAndForward(admin, row, (t) => sendForUser(row.facebook_user_id, t));
      const { data: after } = await admin.from("temp_emails").select("last_message_id").eq("id", row.id).maybeSingle();
      if (after?.last_message_id && after.last_message_id !== before) forwarded++;
    } catch (e) {
      console.warn("[temp_email] poll row failed", row.address, e);
    }
  }
  // Expire old ones
  await admin.from("temp_emails").update({ active: false }).eq("active", true).lt("expires_at", now);
  return { checked, forwarded };
}

import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Lookup-Secret",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

function checkSecret(request: Request, url: URL): boolean {
  const expected = process.env.PHONE_LOOKUP_SECRET;
  if (!expected) return false;
  const provided =
    request.headers.get("x-lookup-secret") ||
    url.searchParams.get("secret") ||
    "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

function buildMessage(status: string, owner: string | null, carrier: string | null): string {
  if (status === "done" && owner && carrier) {
    return `🕵️ بحثت لك في دفاتري السرية وجبتلك قراره..\nالرقم ده تابع لشركة ${carrier} ومسجل باسم ${owner}..\nروح قوله البوت قفشك! 👀💀`;
  }
  if (status === "done" && carrier) {
    return `📡 الرقم ده تابع لشركة ${carrier}، بس صاحبه عامل فيها شبح ومخفي اسمه من الدفاتر..\nغالباً هربان من الديون! 🤫🕵️‍♂️`;
  }
  return `🕸️ الموقع اللي بغش منه شكله قفشني أو الرقم ده مش مسجل في كوكب الأرض أصلاً..\nجرب تاني كمان شوية! 😂`;
}

async function sendMessengerText(psid: string, text: string) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN_2;
  if (!token) return;
  try {
    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      }),
    });
  } catch (e) {
    console.error("[phone-lookup] messenger send failed", e);
  }
}

export const Route = createFileRoute("/api/public/phone-lookup")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // Scraper polls this to fetch pending lookups
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!checkSecret(request, url)) return json({ error: "unauthorized" }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const limit = Math.min(Number(url.searchParams.get("limit") || 10), 50);
        const { data, error } = await supabaseAdmin
          .from("phone_lookups")
          .select("id, phone, country, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(limit);
        if (error) return json({ error: error.message }, 500);
        return json({ pending: data ?? [] });
      },

      // Scraper posts result here
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (!checkSecret(request, url)) return json({ error: "unauthorized" }, 401);

        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid json" }, 400);
        }

        const lookupId: string | undefined = body.lookup_id || body.id;
        const phone: string | undefined = body.phone;
        const ownerName: string | null = body.owner_name ?? null;
        const carrier: string | null = body.carrier ?? null;
        const country: string | null = body.country ?? null;
        const rawStatus: string = String(body.status || (ownerName || carrier ? "done" : "failed")).toLowerCase();
        const status = rawStatus === "done" || rawStatus === "success" || rawStatus === "ok" ? "done"
          : rawStatus === "not_found" ? "failed" : rawStatus === "failed" || rawStatus === "error" ? "failed"
          : ownerName || carrier ? "done" : "failed";
        const error: string | null = body.error ?? null;

        if (!lookupId && !phone) return json({ error: "lookup_id or phone required" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find target row
        let target: { id: string; facebook_user_id: string | null; page_id: string | null } | null = null;
        if (lookupId) {
          const { data } = await supabaseAdmin
            .from("phone_lookups")
            .select("id, facebook_user_id, page_id")
            .eq("id", lookupId)
            .maybeSingle();
          target = data;
        } else if (phone) {
          const { data } = await supabaseAdmin
            .from("phone_lookups")
            .select("id, facebook_user_id, page_id")
            .eq("phone", phone)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          target = data;
        }

        if (!target) return json({ error: "lookup not found" }, 404);

        const update = { status, owner_name: ownerName, carrier, error, ...(country ? { country } : {}) };
        const { error: upErr } = await supabaseAdmin
          .from("phone_lookups")
          .update(update)
          .eq("id", target.id);
        if (upErr) return json({ error: upErr.message }, 500);

        // Notify Messenger user (if this lookup originated from the bot)
        if (target.facebook_user_id) {
          const text = buildMessage(status, ownerName, carrier);
          await sendMessengerText(target.facebook_user_id, text);
        }

        return json({ ok: true, id: target.id, status });
      },
    },
  },
});

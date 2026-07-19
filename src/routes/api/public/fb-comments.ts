import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

function target(requestUrl: string) {
  const incoming = new URL(requestUrl);
  const supabaseUrl = process.env.SUPABASE_URL || "https://znepqljtvkumdqlohbwq.supabase.co";
  const t = new URL("/functions/v1/fb-comments", supabaseUrl);
  t.search = incoming.search;
  return t;
}

async function proxy(request: Request) {
  const t = target(request.url);
  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const response = await fetch(t, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
  });
  const responseHeaders = new Headers(corsHeaders);
  const upCt = response.headers.get("content-type");
  if (upCt) responseHeaders.set("content-type", upCt);
  return new Response(await response.text(), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const Route = createFileRoute("/api/public/fb-comments")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => proxy(request),
      POST: async ({ request }) => proxy(request),
    },
  },
});
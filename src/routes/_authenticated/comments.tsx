import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Copy, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/comments")({
  head: () => ({ meta: [{ title: "الرد على التعليقات · SolveBot GPT" }] }),
  component: CommentsPage,
});

type Setting = {
  id: string;
  page_id: string | null;
  is_enabled: boolean;
  system_prompt: string | null;
  reply_delay_ms: number;
};

function getWebhookUrl() {
  if (typeof window === "undefined") return "";
  const { hostname, origin } = window.location;
  const previewMatch = hostname.match(/^id-preview--([0-9a-f-]{36})\.lovable\.app$/);
  if (previewMatch) return `https://project--${previewMatch[1]}-dev.lovable.app/api/public/fb-comments`;
  return `${origin}/api/public/fb-comments`;
}

function CommentsPage() {
  const [items, setItems] = useState<Setting[]>([]);
  const [form, setForm] = useState({ page_id: "", system_prompt: "", reply_delay_ms: 0 });
  const [busy, setBusy] = useState(false);
  const webhookUrl = getWebhookUrl();

  async function load() {
    const { data } = await supabase
      .from("comment_reply_settings")
      .select("*")
      .order("page_id", { ascending: true, nullsFirst: true });
    setItems((data ?? []) as Setting[]);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.system_prompt.trim()) return toast.error("يجب إدخال نص الـ prompt");
    setBusy(true);
    const { error } = await supabase.from("comment_reply_settings").insert({
      page_id: form.page_id.trim() || null,
      system_prompt: form.system_prompt.trim(),
      reply_delay_ms: +form.reply_delay_ms || 0,
      is_enabled: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setForm({ page_id: "", system_prompt: "", reply_delay_ms: 0 });
    load();
  }

  async function toggle(s: Setting) {
    const { error } = await supabase.from("comment_reply_settings")
      .update({ is_enabled: !s.is_enabled }).eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function updatePrompt(s: Setting, prompt: string) {
    const { error } = await supabase.from("comment_reply_settings")
      .update({ system_prompt: prompt }).eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحفظ");
  }

  async function remove(s: Setting) {
    if (!confirm("حذف هذا الإعداد؟")) return;
    const { error } = await supabase.from("comment_reply_settings").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-3">
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <div className="ml-auto font-semibold flex items-center gap-2">
            <MessageCircle className="w-4 h-4" /> الرد التلقائي على التعليقات
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <Card className="p-6">
          <h2 className="font-semibold mb-3">إعداد Webhook فيسبوك</h2>
          <p className="text-sm text-muted-foreground mb-3">
            في Meta App Dashboard → Webhooks → Page، أضف هذا الـ Callback URL واختر حقل <Badge variant="outline">feed</Badge>،
            ثم اشترك بصفحاتك.
          </p>
          <div className="flex gap-2 items-center">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("نُسخ"); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            استخدم Verify Token: <code>FB_VERIFY_TOKEN</code> أو <code>FB_VERIFY_TOKEN_2</code> حسب الصفحة.
          </p>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="p-6 h-fit">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4" /> إعداد جديد</h2>
            <div className="space-y-3">
              <div>
                <Label>Page ID (اتركه فارغاً للتطبيق على كل الصفحات)</Label>
                <Input value={form.page_id} onChange={e => setForm({ ...form, page_id: e.target.value })} placeholder="123456789" />
              </div>
              <div>
                <Label>System Prompt للردود</Label>
                <Textarea rows={6} className="font-mono text-sm"
                  value={form.system_prompt}
                  onChange={e => setForm({ ...form, system_prompt: e.target.value })}
                  placeholder="أنت مساعد ودود يمثل الصفحة. رد باختصار ولطف بالعربية…" />
              </div>
              <div>
                <Label>تأخير الرد (بالميلي ثانية — لتجنب الرد الفوري)</Label>
                <Input type="number" min={0} value={form.reply_delay_ms}
                  onChange={e => setForm({ ...form, reply_delay_ms: +e.target.value || 0 })} />
              </div>
              <Button onClick={create} disabled={busy} className="w-full">
                {busy ? "جارٍ…" : "إضافة"}
              </Button>
            </div>
          </Card>

          <div className="space-y-3">
            {items.length === 0 && (
              <Card className="p-6 text-sm text-muted-foreground">لا توجد إعدادات بعد.</Card>
            )}
            {items.map(s => (
              <SettingCard key={s.id} setting={s} onToggle={() => toggle(s)} onDelete={() => remove(s)} onSavePrompt={(p) => updatePrompt(s, p)} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingCard({ setting, onToggle, onDelete, onSavePrompt }: {
  setting: Setting;
  onToggle: () => void;
  onDelete: () => void;
  onSavePrompt: (p: string) => void;
}) {
  const [prompt, setPrompt] = useState(setting.system_prompt ?? "");
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-semibold flex items-center gap-2">
            {setting.page_id ? `📘 Page ${setting.page_id}` : "🌐 كل الصفحات (افتراضي)"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {setting.is_enabled ? "مفعّل" : "متوقف"} · تأخير {setting.reply_delay_ms}ms
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={setting.is_enabled} onCheckedChange={onToggle} />
          <Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>
      <Textarea rows={4} className="font-mono text-xs" value={prompt} onChange={e => setPrompt(e.target.value)} />
      <Button size="sm" variant="outline" className="mt-2" onClick={() => onSavePrompt(prompt)}>حفظ الـ Prompt</Button>
    </Card>
  );
}
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { detectCarrier } from "@/lib/phone-carrier";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, Phone, User, Radio, ArrowRight, RadarIcon, Ghost } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/phone-lookup")({
  head: () => ({ meta: [{ title: "كاشف الأرقام · SolveBot GPT" }] }),
  component: PhoneLookupPage,
});

type Lookup = {
  id: string;
  phone: string;
  country: string | null;
  status: string;
  owner_name: string | null;
  carrier: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COUNTRIES = [
  { code: "+212", label: "🇲🇦 المغرب (+212)" },
  { code: "+20", label: "🇪🇬 مصر (+20)" },
  { code: "+966", label: "🇸🇦 السعودية (+966)" },
  { code: "+971", label: "🇦🇪 الإمارات (+971)" },
  { code: "+213", label: "🇩🇿 الجزائر (+213)" },
  { code: "+216", label: "🇹🇳 تونس (+216)" },
  { code: "+962", label: "🇯🇴 الأردن (+962)" },
  { code: "+961", label: "🇱🇧 لبنان (+961)" },
  { code: "+964", label: "🇮🇶 العراق (+964)" },
  { code: "+974", label: "🇶🇦 قطر (+974)" },
  { code: "+965", label: "🇰🇼 الكويت (+965)" },
  { code: "+973", label: "🇧🇭 البحرين (+973)" },
  { code: "+968", label: "🇴🇲 عُمان (+968)" },
  { code: "+967", label: "🇾🇪 اليمن (+967)" },
  { code: "+970", label: "🇵🇸 فلسطين (+970)" },
  { code: "+963", label: "🇸🇾 سوريا (+963)" },
  { code: "+1", label: "🇺🇸 أمريكا (+1)" },
  { code: "+33", label: "🇫🇷 فرنسا (+33)" },
  { code: "+44", label: "🇬🇧 بريطانيا (+44)" },
];

function PhoneLookupPage() {
  const [country, setCountry] = useState("+212");
  const [phone, setPhone] = useState("");
  const [current, setCurrent] = useState<Lookup | null>(null);
  const [history, setHistory] = useState<Lookup[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase
      .from("phone_lookups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setHistory((data as Lookup[]) ?? []));

    const ch = supabase
      .channel("phone_lookups_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "phone_lookups" }, (payload) => {
        const row = payload.new as Lookup;
        if (!row) return;
        setHistory((prev) => {
          const others = prev.filter((r) => r.id !== row.id);
          return [row, ...others].slice(0, 20);
        });
        setCurrent((prev) => (prev && prev.id === row.id ? row : prev));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const waiting = current?.status === "pending";

  const digits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  async function submit() {
    if (digits.length < 5) {
      toast.error("أدخل رقماً صحيحاً");
      return;
    }
    setSubmitting(true);
    try {
      const fullPhone = `${country}${digits}`;
      const { data: userRes } = await supabase.auth.getUser();
      // Resolve carrier locally, then insert an already-resolved row.
      const carrier = detectCarrier(country, digits);
      const row = {
        phone: fullPhone,
        country,
        status: carrier ? "done" : "failed",
        carrier: carrier ?? null,
        owner_name: null,
        error: carrier ? null : "unsupported_country",
        requested_by: userRes.user?.id ?? null,
      };
      const { data, error } = await supabase
        .from("phone_lookups")
        .insert(row)
        .select("*")
        .single();
      if (error) throw error;
      setCurrent(data as Lookup);
      setHistory((prev) => {
        const others = prev.filter((r) => r.id !== (data as Lookup).id);
        return [data as Lookup, ...others].slice(0, 20);
      });
      setPhone("");
      if (carrier) toast.success(`🕵️ الرقم تابع لـ ${carrier}`);
      else toast.error("الدولة غير مدعومة حالياً");
    } catch (e: any) {
      toast.error(e.message || "فشل الإرسال");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white" dir="rtl">
      <header className="border-b border-white/5 backdrop-blur-xl sticky top-0 bg-slate-950/70 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/admin" className="flex items-center gap-2 text-sm text-slate-300 hover:text-white">
            <ArrowRight className="w-4 h-4" /> رجوع
          </Link>
          <div className="flex items-center gap-2 font-semibold">
            <RadarIcon className="w-5 h-5 text-emerald-400" />
            <span>كاشف الأرقام</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            🕵️‍♂️ المخبر السري
          </h1>
          <p className="text-slate-400">اكتب الرقم واختر بلده، ودعني أفتّش في الدفاتر السرية...</p>
        </div>

        <Card className="p-6 bg-white/[0.03] border-white/10 backdrop-blur-xl">
          <div className="grid gap-4">
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">رمز الدولة</Label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full h-10 rounded-md bg-slate-900 border border-white/10 px-3 text-sm text-white"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">رقم الهاتف</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !submitting && submit()}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="612345678"
                  className="bg-slate-900 border-white/10 text-white text-lg tracking-wider text-left"
                  dir="ltr"
                />
              </div>
            </div>
            <Button
              onClick={submit}
              disabled={submitting || waiting}
              size="lg"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-full h-12"
            >
              <Search className="w-4 h-4 ml-2" />
              {waiting ? "جاري البحث..." : submitting ? "إرسال..." : "ابحث عن الرقم / Check Number"}
            </Button>
          </div>
        </Card>

        {current && (
          <ResultCard lookup={current} />
        )}

        {history.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">آخر عمليات البحث</h2>
            <div className="space-y-2">
              {history.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setCurrent(l)}
                  className="w-full text-right p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-500" />
                    <span dir="ltr" className="font-mono text-sm">{l.phone}</span>
                  </div>
                  <StatusBadge status={l.status} />
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">جاري البحث</Badge>;
  if (status === "done") return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">تم</Badge>;
  return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">فشل</Badge>;
}

function ResultCard({ lookup }: { lookup: Lookup }) {
  if (lookup.status === "pending") {
    return (
      <Card className="p-8 bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20 relative overflow-hidden">
        <RadarAnimation />
        <div className="relative text-center space-y-3">
          <p className="text-lg font-semibold text-emerald-300">🕵️ جاري البحث في الدفاتر السرية...</p>
          <p className="text-sm text-slate-400" dir="ltr">{lookup.phone}</p>
          <p className="text-xs text-slate-500">قد تستغرق العملية بضع ثوانٍ</p>
        </div>
      </Card>
    );
  }

  if (lookup.status === "done" && lookup.owner_name && lookup.carrier) {
    return (
      <Card className="p-6 bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/30">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 grid place-items-center shrink-0">
            <User className="w-6 h-6 text-emerald-300" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-xs text-slate-400">الرقم</p>
              <p className="font-mono text-lg" dir="ltr">{lookup.phone}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400">المالك</p>
                <p className="font-semibold">{lookup.owner_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">الشركة</p>
                <p className="font-semibold flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" />{lookup.carrier}</p>
              </div>
            </div>
            <p className="text-sm text-emerald-200 pt-2 border-t border-white/5">
              بحثت لك في دفاتري السرية وجبتلك قراره.. الرقم ده تابع لشركة <b>{lookup.carrier}</b> ومسجل باسم <b>{lookup.owner_name}</b>.. روح قوله البوت قفشك! 👀💀
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (lookup.status === "done" && lookup.carrier) {
    return (
      <Card className="p-6 bg-gradient-to-br from-amber-500/10 to-transparent border-amber-500/30">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 grid place-items-center shrink-0">
            <Ghost className="w-6 h-6 text-amber-300" />
          </div>
          <div className="flex-1 space-y-2">
            <p className="font-mono text-lg" dir="ltr">{lookup.phone}</p>
            <p className="text-sm">شركة: <b>{lookup.carrier}</b></p>
            <p className="text-sm text-amber-200">
              الرقم ده تابع لشركة <b>{lookup.carrier}</b>، بس صاحبه عامل فيها شبح ومخفي اسمه من الدفاتر.. غالباً هربان من الديون! 🤫🕵️‍♂️
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-gradient-to-br from-rose-500/10 to-transparent border-rose-500/30">
      <div className="text-center space-y-2">
        <p className="text-2xl">🕸️😂</p>
        <p className="font-mono text-sm text-slate-400" dir="ltr">{lookup.phone}</p>
        <p className="text-sm text-rose-200">
          الموقع اللي بغش منه شكله قفشني أو الرقم ده مش مسجل في كوكب الأرض أصلاً.. جرب تاني كمان شوية!
        </p>
      </div>
    </Card>
  );
}

function RadarAnimation() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
      <div className="relative w-64 h-64">
        <div className="absolute inset-0 rounded-full border border-emerald-500/40" />
        <div className="absolute inset-4 rounded-full border border-emerald-500/30" />
        <div className="absolute inset-8 rounded-full border border-emerald-500/20" />
        <div className="absolute inset-0 rounded-full overflow-hidden">
          <div
            className="absolute top-1/2 left-1/2 w-1/2 h-1 origin-left bg-gradient-to-r from-emerald-400 to-transparent"
            style={{ animation: "radarSweep 2s linear infinite" }}
          />
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <RadarIcon className="w-8 h-8 text-emerald-400 animate-pulse" />
        </div>
      </div>
      <style>{`@keyframes radarSweep { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}

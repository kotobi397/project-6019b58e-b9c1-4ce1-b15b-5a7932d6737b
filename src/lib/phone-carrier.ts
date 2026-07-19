// Best-effort carrier detection from national mobile prefix.
// Owner name is not publicly available for personal numbers.
export function detectCarrier(country: string, digitsInput: string): string | null {
  const national = digitsInput.replace(/^0+/, "");

  if (country === "+212") {
    const p3 = national.slice(0, 3);
    const p2 = national.slice(0, 2);
    if (["612","613","614","615","616","617","618","619","661","662","663","664","665","666","667","668","669","670","671","672","673","674","675","676","677","678","679"].includes(p3)) return "Maroc Telecom (IAM)";
    if (["620","621","622","623","624","625","626","627","628","629","680","681","682","683","684","685","686","687","688","689"].includes(p3)) return "Orange Maroc";
    if (["650","651","652","653","654","655","656","657","658","659","690","691","692","693","694","695","696","697","698","699","700","701","702","703","704","705","706","707","708","709"].includes(p3)) return "Inwi";
    if (p2 === "05") return "Maroc Telecom (fixe)";
    return "شركة مغربية";
  }
  if (country === "+213") {
    const p = national.slice(0, 3);
    if (p.startsWith("5")) return "Ooredoo Algérie";
    if (p.startsWith("6")) return "Mobilis";
    if (p.startsWith("7")) return "Djezzy";
    return "مشغل جزائري";
  }
  if (country === "+20") {
    const p = national.slice(0, 3);
    if (p.startsWith("10")) return "Vodafone Egypt";
    if (p.startsWith("11")) return "Etisalat Misr";
    if (p.startsWith("12")) return "Orange Egypt";
    if (p.startsWith("15")) return "WE (Telecom Egypt)";
    return "مشغل مصري";
  }
  if (country === "+966") return "STC / Mobily / Zain KSA";
  if (country === "+971") return "Etisalat / du";
  if (country === "+216") return "Ooredoo / Orange / Tunisie Telecom";
  if (country === "+974") return "Ooredoo / Vodafone Qatar";
  if (country === "+965") return "Zain / Ooredoo / STC Kuwait";
  if (country === "+973") return "Batelco / Zain / STC Bahrain";
  if (country === "+968") return "Omantel / Ooredoo";
  if (country === "+962") return "Zain / Orange / Umniah";
  if (country === "+961") return "Alfa / Touch";
  if (country === "+964") return "Zain / Asiacell / Korek";
  if (country === "+967") return "MTN / Sabafon / YouTel";
  if (country === "+970") return "Jawwal / Ooredoo Palestine";
  if (country === "+963") return "Syriatel / MTN Syria";
  if (country === "+1") return "US/Canada Carrier";
  if (country === "+33") return "Orange / SFR / Bouygues / Free";
  if (country === "+44") return "EE / Vodafone / O2 / Three";
  return null;
}

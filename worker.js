// Cloudflare Worker: Yahoo Finance proxy (GET /?symbol=KROSS.NS) + Gemini commentary (POST /ai)
// Setup: Worker > Settings > Variables and Secrets > add secret GEMINI_API_KEY
// Optional variable GEMINI_MODEL (default gemini-2.5-flash)

const SYS = `You are a swing trading analyst for Indian NSE stocks. You get computed daily-chart data as JSON.
Write under 150 words in plain English with short paragraphs:
1. Verdict (one line, bold).
2. Setup quality and why.
3. Two main risks.
4. What to watch on the next candle.
Use only the numbers provided. Never guarantee outcomes. Do not repeat the entry, stop and target table.`;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // ---- Gemini commentary ----
    if (u.pathname === "/ai") {
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      if (!env.GEMINI_API_KEY) return json({ error: "Add the GEMINI_API_KEY secret to your Worker" }, 500);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
      const prompt = `Stock: ${String(body.symbol || "").slice(0, 20)}\nData: ${JSON.stringify(body.facts).slice(0, 4000)}`;
      const model = env.GEMINI_MODEL || "gemini-2.5-flash";
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYS }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
          }),
        }
      );
      const j = await r.json();
      if (!r.ok) {
        const msg = r.status === 429 ? "Gemini free limit reached. Try again later." : (j.error && j.error.message) || "Gemini error";
        return json({ error: msg }, r.status);
      }
      const text = ((j.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      return json({ text: text || "No response from Gemini." });
    }

    // ---- Yahoo Finance proxy ----
    const s = u.searchParams.get("symbol") || "";
    if (!/^[A-Z0-9&.^_-]{1,20}$/i.test(s)) return new Response("Bad symbol", { status: 400, headers: cors });
    const r = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1y&interval=1d",
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    return new Response(r.body, {
      status: r.status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
    });
  },
};

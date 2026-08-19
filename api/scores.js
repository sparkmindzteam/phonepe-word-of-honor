const KEY = "phonepe_scores";

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet() {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json().catch(() => ({}));
  try {
    const parsed = JSON.parse(data.result || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function kvSet(list) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(list)),
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!kvConfigured()) {
    if (req.method === "GET") return res.status(200).json({ ok: true, scores: [], source: "kiosk-local" });
    if (req.method === "POST") return res.status(202).json({ ok: true, source: "kiosk-local" });
    return res.status(405).json({ ok: false });
  }

  if (req.method === "GET") {
    const scores = await kvGet();
    return res.status(200).json({ ok: true, scores, source: "kv" });
  }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.clear) {
        await kvSet([]);
        return res.status(200).json({ ok: true, scores: [], cleared: true, source: "kv" });
      }
      if (!body.name && !body.email) {
      return res.status(400).json({ ok: false, error: "name or email required" });
    }
    const rec = {
      id: body.id || `${Date.now()}`,
      name: String(body.name || "").trim(),
      employeeId: String(body.employeeId || "").trim(),
      email: String(body.email || "").trim(),
      score: Number(body.score) || 0,
      maxScore: Number(body.maxScore) || 0,
      feedback: String(body.feedback || ""),
      at: body.at || new Date().toISOString(),
      rounds: Array.isArray(body.rounds) ? body.rounds : [],
    };
    const scores = await kvGet();
    if (rec.id && scores.some((s) => String(s.id) === String(rec.id))) {
      return res.status(200).json({ ok: true, record: rec, source: "kv", duplicate: true });
    }
    scores.push(rec);
    await kvSet(scores);
    return res.status(201).json({ ok: true, record: rec, source: "kv" });
  }

  return res.status(405).json({ ok: false });
}

const KEY = "phonepe_settings";

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet() {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  const data = await res.json().catch(() => ({}));
  try {
    const parsed = JSON.parse(data.result || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function kvSet(obj) {
  await fetch(`${process.env.KV_REST_API_URL}/set/${KEY}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(obj)),
  });
}

const defaults = {
  keyboardMode: "both",
  quizSeconds: 30,
  wordFindSeconds: 20,
  idleResetSeconds: 7,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!kvConfigured()) {
    if (req.method === "GET") return res.status(200).json({ ok: true, settings: defaults, source: "defaults" });
    if (req.method === "POST") return res.status(202).json({ ok: true, source: "defaults" });
    return res.status(405).json({ ok: false });
  }

  if (req.method === "GET") {
    const settings = (await kvGet()) || defaults;
    return res.status(200).json({ ok: true, settings, source: "kv" });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const settings = {
      keyboardMode: String(body.keyboardMode || defaults.keyboardMode),
      quizSeconds: Number(body.quizSeconds) || defaults.quizSeconds,
      wordFindSeconds: Number(body.wordFindSeconds) || defaults.wordFindSeconds,
      idleResetSeconds: Number(body.idleResetSeconds) || defaults.idleResetSeconds,
    };
    await kvSet(settings);
    return res.status(200).json({ ok: true, settings, source: "kv" });
  }

  return res.status(405).json({ ok: false });
}

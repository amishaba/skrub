export const LLM_MODEL = process.env.SKRUB_MODEL ?? process.env.UNVIBE_MODEL ?? "gemini-2.5-flash";

export function geminiKey(): string | undefined {
  for (const name of ["SKRUB_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"]) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** One JSON-mode call; null on any failure (HTTP error, network, unparseable reply). */
export async function geminiJson(key: string, prompt: string): Promise<Record<string, unknown> | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

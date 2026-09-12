// Envio de e-mail via Resend (https://resend.com) usando a API HTTP direta
// — um POST simples, nao vale uma dependencia nova. Desligado sem
// RESEND_API_KEY (mesma convencao de graceful degradation de ANTHROPIC_API_KEY
// e das integracoes): quem chama deve checar isEmailAvailable() antes.
//
// Remetente: sem dominio verificado na Resend, so "onboarding@resend.dev"
// funciona, e apenas pro e-mail dono da conta — pra mandar pra outras
// pessoas e preciso verificar um dominio la e apontar EMAIL_FROM pra ele.

const FROM_PADRAO = "Gestão de Motoristas <onboarding@resend.dev>";

export function isEmailAvailable(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function hojeEmailDestinatarios(): string[] {
  return (process.env.HOJE_EMAIL_PARA ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export async function sendEmail(input: { to: string[]; subject: string; html: string }): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY não configurada.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? FROM_PADRAO, to: input.to, subject: input.subject, html: input.html }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new Error(`Resend respondeu ${res.status}: ${detalhe.slice(0, 300)}`);
  }
  return (await res.json()) as { id: string };
}

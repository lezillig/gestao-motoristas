// 60 requisições/minuto é o limite real da API do TiqueTaque (confirmado
// por erros 429 reais em produção — "60 per 1 minute" — numa importação com
// mais de 300 motoristas disparando uma chamada cada, em sequência, sem
// pausa nenhuma). Pausar ~1.1s entre cada chamada por motorista mantém a
// taxa em ~54/min, com margem de segurança. Usado pelos dois loops
// client-orchestrated (ponto e afastamentos) que chamam uma server action
// por motorista.
export const TIQUETAQUE_IMPORT_PACE_MS = 1100;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

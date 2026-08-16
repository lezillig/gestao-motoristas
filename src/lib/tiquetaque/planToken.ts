import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET não configurado — importação do TiqueTaque indisponível.");
  }
  return value;
}

// Assina o par (companyId, driverId, employeeId) decidido no servidor na
// fase 1 do import (casamento por CPF). A fase 2 recebe o employeeId de
// volta do CLIENTE (necessário pra fazer uma chamada curta por motorista,
// em vez de rebuscar todos os funcionários a cada chamada) — mas o servidor
// não pode confiar nesse valor sem checar a assinatura: sem isso, qualquer
// ADMIN/GESTOR autenticado (de qualquer empresa cliente deste SaaS, já que
// o token do TiqueTaque é um só, global) poderia trocar o employeeId por um
// id arbitrário e puxar ponto/afastamento (inclusive atestado, dado de
// saúde) de outro funcionário do TiqueTaque pro seu próprio motorista.
export function signTiqueTaquePlanItem(companyId: string, driverId: string, employeeId: string): string {
  return createHmac("sha256", getSecret()).update(`${companyId}:${driverId}:${employeeId}`).digest("hex");
}

export function verifyTiqueTaquePlanItem(
  companyId: string,
  driverId: string,
  employeeId: string,
  token: string
): boolean {
  const expected = signTiqueTaquePlanItem(companyId, driverId, employeeId);
  const expectedBuf = Buffer.from(expected, "hex");
  const tokenBuf = Buffer.from(token, "hex");
  if (expectedBuf.length !== tokenBuf.length) return false;
  return timingSafeEqual(expectedBuf, tokenBuf);
}

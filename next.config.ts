import type { NextConfig } from "next";

// Cabecalhos de seguranca basicos. A CSP fica em src/proxy.ts, porque precisa
// de um nonce novo por requisicao (modo controlado pela variavel CSP_MODO).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  experimental: {
    // Extrato real de combustivel (RFCV) pode passar de 2MB (8mil+ linhas);
    // o limite padrao de Server Actions e 1MB.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;

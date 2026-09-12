import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  // Painel de acao do dia e a porta de entrada — o Painel classico (CNH/
  // sindicatos) continua no menu, so nao e mais a primeira tela.
  redirect(session ? "/hoje" : "/login");
}

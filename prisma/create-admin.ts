// Script avulso para produção: cria a empresa + 1 usuário administrador,
// sem nenhum dado fictício. Idempotente — não faz nada se já existir uma
// empresa. Uso:
//   DATABASE_URL="<url do Neon>" ADMIN_EMAIL="voce@empresa.com" ADMIN_PASSWORD="sua-senha" COMPANY_NAME="Sua Empresa Ltda" npx tsx prisma/create-admin.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.company.findFirst();
  if (existing) {
    console.log(`Já existe uma empresa cadastrada (${existing.name}) — nada foi criado.`);
    return;
  }

  const companyName = process.env.COMPANY_NAME || "Minha Empresa";
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD nas variáveis de ambiente antes de rodar.");
    process.exit(1);
  }

  const company = await prisma.company.create({ data: { name: companyName } });
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Administrador",
      email: adminEmail,
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log("Criado com sucesso:", { empresa: companyName, login: adminEmail });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

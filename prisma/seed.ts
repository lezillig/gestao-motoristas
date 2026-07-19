import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

const PLACEHOLDER_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj
trailer<</Root 1 0 R>>
`;

function daysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function thisWeekDay(offsetFromMonday: number) {
  const d = new Date();
  const day = d.getDay(); // 0=domingo
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset + offsetFromMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const company = await prisma.company.create({
    data: { name: "Fretamento Exemplo Ltda" },
  });

  const passwordHash = await bcrypt.hash("admin123", 10);
  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "Administrador",
      email: "admin@exemplo.com",
      passwordHash,
      role: "ADMIN",
    },
  });

  const [setcepar, fettrominas, setransp] = await Promise.all([
    prisma.sindicato.create({
      data: { companyId: company.id, nome: "SETCEPAR", cidade: "Curitiba", estado: "PR" },
    }),
    prisma.sindicato.create({
      data: { companyId: company.id, nome: "FETTROMINAS", cidade: "Belo Horizonte", estado: "MG" },
    }),
    prisma.sindicato.create({
      data: { companyId: company.id, nome: "SETRANSP", cidade: "Campinas", estado: "SP" },
    }),
  ]);

  const [carlos, marcos, roberto, josenilson, antonio, wellington] = await Promise.all([
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: setcepar.id,
        name: "Carlos Eduardo Souza",
        cpf: "111.111.111-11",
        cnh: "01234567891",
        cnhCategory: "D",
        cnhExpiration: daysFromNow(400),
      },
    }),
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: setcepar.id,
        name: "Marcos Vinicius Lima",
        cpf: "222.222.222-22",
        cnh: "02234567891",
        cnhCategory: "D",
        cnhExpiration: daysFromNow(12),
      },
    }),
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: fettrominas.id,
        name: "Roberto Alves Pereira",
        cpf: "333.333.333-33",
        cnh: "03234567891",
        cnhCategory: "E",
        cnhExpiration: daysFromNow(25),
      },
    }),
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: fettrominas.id,
        name: "Josenilson Cardoso",
        cpf: "444.444.444-44",
        cnh: "04234567891",
        cnhCategory: "D",
        cnhExpiration: daysFromNow(-5),
      },
    }),
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: setransp.id,
        name: "Antonio Ferreira Junior",
        cpf: "555.555.555-55",
        cnh: "05234567891",
        cnhCategory: "D",
        cnhExpiration: daysFromNow(200),
      },
    }),
    prisma.driver.create({
      data: {
        companyId: company.id,
        sindicatoId: null,
        name: "Wellington Santos Rocha",
        cpf: "666.666.666-66",
        cnh: "06234567891",
        cnhCategory: "D",
        cnhExpiration: daysFromNow(180),
      },
    }),
  ]);

  const [onibus01, onibus02, van01] = await Promise.all([
    prisma.vehicle.create({
      data: {
        companyId: company.id,
        plate: "ABC1D23",
        brand: "Marcopolo",
        model: "Paradiso 1200",
        year: 2021,
        type: "Ônibus rodoviário",
      },
    }),
    prisma.vehicle.create({
      data: {
        companyId: company.id,
        plate: "DEF4E56",
        brand: "Comil",
        model: "Svelto",
        year: 2019,
        type: "Ônibus urbano",
      },
    }),
    prisma.vehicle.create({
      data: {
        companyId: company.id,
        plate: "GHI7F89",
        brand: "Mercedes-Benz",
        model: "Sprinter",
        year: 2022,
        type: "Van",
      },
    }),
  ]);

  await prisma.escala.createMany({
    data: [
      { companyId: company.id, driverId: carlos.id, vehicleId: onibus01.id, date: thisWeekDay(0), startTime: "06:00", endTime: "14:00" },
      { companyId: company.id, driverId: carlos.id, vehicleId: onibus01.id, date: thisWeekDay(1), startTime: "06:00", endTime: "14:00" },
      { companyId: company.id, driverId: marcos.id, vehicleId: onibus02.id, date: thisWeekDay(0), startTime: "14:00", endTime: "22:00" },
      { companyId: company.id, driverId: marcos.id, vehicleId: onibus02.id, date: thisWeekDay(2), startTime: "14:00", endTime: "22:00" },
      { companyId: company.id, driverId: roberto.id, vehicleId: van01.id, date: thisWeekDay(1), startTime: "08:00", endTime: "18:00" },
      { companyId: company.id, driverId: antonio.id, vehicleId: onibus01.id, date: thisWeekDay(3), startTime: "06:00", endTime: "14:00" },
      { companyId: company.id, driverId: wellington.id, vehicleId: van01.id, date: thisWeekDay(4), startTime: "08:00", endTime: "18:00" },
    ],
  });
  await prisma.timeClockEntry.createMany({
    data: [
      // Carlos: jornada normal segunda, hora extra terca, e violacao de
      // interjornada entre terca (saida 23:30) e quarta (entrada 06:00, < 11h).
      { companyId: company.id, driverId: carlos.id, date: thisWeekDay(0), clockIn: "06:00", clockOut: "14:00" },
      { companyId: company.id, driverId: carlos.id, date: thisWeekDay(1), clockIn: "14:00", clockOut: "23:30" },
      { companyId: company.id, driverId: carlos.id, date: thisWeekDay(2), clockIn: "06:00", clockOut: "14:00" },
      // Marcos: jornada normal, turno aberto hoje (sem saida ainda).
      { companyId: company.id, driverId: marcos.id, date: thisWeekDay(0), clockIn: "14:00", clockOut: "22:00" },
      { companyId: company.id, driverId: marcos.id, date: thisWeekDay(2), clockIn: "14:00", clockOut: null },
    ],
  });
  void josenilson;

  // Fora de public/: mesmo local privado usado por createConvencao
  // (src/app/(app)/convencoes/actions.ts) — arquivos de CCT/ACT so sao
  // servidos via rota autenticada /api/convencoes/[id]/arquivo.
  const uploadDir = path.join(process.cwd(), "private-uploads", "convencoes", setcepar.id);
  await mkdir(uploadDir, { recursive: true });
  const cctFileName = `${Date.now()}-cct-setcepar-2026.pdf`;
  await writeFile(path.join(uploadDir, cctFileName), PLACEHOLDER_PDF);

  const convencao = await prisma.convencaoColetiva.create({
    data: {
      companyId: company.id,
      sindicatoId: setcepar.id,
      tipo: "CCT",
      vigenciaInicio: daysFromNow(-30),
      vigenciaFim: daysFromNow(335),
      fileName: "CCT-SETCEPAR-2026.pdf",
      fileUrl: `${setcepar.id}/${cctFileName}`,
      uploadedById: admin.id,
    },
  });

  await prisma.regraConvencao.createMany({
    data: [
      {
        companyId: company.id,
        convencaoId: convencao.id,
        tipo: "JORNADA_DIARIA",
        valorNumerico: 9,
        descricao: "Jornada normal ampliada de 8h para 9h, conforme art. 235-C, §1 da Lei 13.103/2015.",
      },
      {
        companyId: company.id,
        convencaoId: convencao.id,
        tipo: "HORA_EXTRA",
        valorNumerico: 60,
        descricao: "Adicional de 60% sobre a hora normal (acima do minimo legal de 50%).",
      },
    ],
  });

  await prisma.vehicle.update({ where: { id: onibus01.id }, data: { currentMileage: 45000, lastMaintenanceMileage: 42000 } });
  await prisma.vehicle.update({ where: { id: onibus02.id }, data: { currentMileage: 30000, lastMaintenanceMileage: 28000 } });
  // Vencida de proposito: mais de 10.000km desde a ultima manutencao, para
  // demonstrar o alerta em /utilizacao.
  await prisma.vehicle.update({ where: { id: van01.id }, data: { currentMileage: 60000, lastMaintenanceMileage: 48000 } });

  const carlosCheckIn = new Date(thisWeekDay(0).getTime() + 6 * 60 * 60 * 1000);
  // Carlos: check-in que bate com a escala ja seedada (mesma data/motorista/veiculo) — sem divergencia.
  await prisma.vehicleUsageLog.create({
    data: {
      companyId: company.id,
      driverId: carlos.id,
      vehicleId: onibus01.id,
      checkInAt: carlosCheckIn,
      checkOutAt: new Date(carlosCheckIn.getTime() + 8 * 60 * 60 * 1000),
      kmInicial: 44850,
      kmFinal: 45000,
    },
  });

  // Josenilson: usou um veiculo sem ter escala planejada nesse dia — divergencia proposital.
  await prisma.vehicleUsageLog.create({
    data: {
      companyId: company.id,
      driverId: josenilson.id,
      vehicleId: onibus02.id,
      checkInAt: new Date(thisWeekDay(2).getTime() + 6 * 60 * 60 * 1000),
      kmInicial: 30000,
    },
  });

  await prisma.telemetryReading.createMany({
    data: [
      { companyId: company.id, vehicleId: onibus01.id, speedKmh: 88, latitude: -25.43, longitude: -49.27, provider: "Simulado (mock)", recordedAt: carlosCheckIn },
      { companyId: company.id, vehicleId: onibus01.id, speedKmh: 112, latitude: -25.42, longitude: -49.28, provider: "Simulado (mock)", recordedAt: new Date(carlosCheckIn.getTime() + 2 * 60 * 60 * 1000) },
      { companyId: company.id, vehicleId: onibus02.id, speedKmh: 76, latitude: -25.41, longitude: -49.26, provider: "Simulado (mock)", recordedAt: thisWeekDay(2) },
    ],
  });

  console.log("Seed concluido:", {
    empresa: company.name,
    login: "admin@exemplo.com / admin123",
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

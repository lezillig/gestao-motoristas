import type {
  ITelemetryProvider,
  TelemetryFetchResult,
  TelemetryReadingInput,
  TelemetryUnmatchedDevice,
  TelemetryVehicleRef,
} from "@/lib/telemetry/types";
import { normalizePlate } from "@/lib/plate";
import { fetchDevices } from "./client";

// Adapter da Cobli para a interface de telemetria do sistema. Toda a
// traducao "dispositivo da Cobli -> veiculo do nosso cadastro" mora aqui;
// nada fora deste arquivo (e do client) precisa saber que a Cobli existe.
//
// Casamento, nesta ordem:
//   1. Vehicle.cobliDeviceId — vinculo ja estabelecido, criterio estavel.
//   2. Placa normalizada — usado na primeira vez; a sincronizacao grava o
//      deviceId no veiculo depois disso (ver src/lib/telemetry/sync.ts).
// Dispositivo que nao casa por nenhum dos dois nao vira leitura: entra na
// lista de "sem vinculo" pra alguem resolver no cadastro, exatamente como a
// importacao de combustivel faz com placa desconhecida (visibilidade antes
// de vinculo estrito).
export class CobliTelemetryProvider implements ITelemetryProvider {
  name = "Cobli";
  real = true;

  constructor(private readonly deadline?: number) {}

  async fetchReadings(vehicles: TelemetryVehicleRef[]): Promise<TelemetryFetchResult> {
    const devices = await fetchDevices(this.deadline);

    const byDeviceId = new Map<string, TelemetryVehicleRef>();
    const byPlate = new Map<string, TelemetryVehicleRef>();
    for (const vehicle of vehicles) {
      if (vehicle.cobliDeviceId) byDeviceId.set(vehicle.cobliDeviceId, vehicle);
      // Placa duplicada no cadastro nao acontece (Vehicle.plate e unico),
      // entao o ultimo a escrever aqui e sempre o mesmo veiculo.
      byPlate.set(normalizePlate(vehicle.plate), vehicle);
    }

    const readings: TelemetryReadingInput[] = [];
    const unmatched: TelemetryUnmatchedDevice[] = [];

    for (const device of devices) {
      const vehicle = byDeviceId.get(device.deviceId) ?? (device.plate ? byPlate.get(device.plate) : undefined);
      if (!vehicle) {
        unmatched.push({
          externalDeviceId: device.deviceId,
          plate: device.plate,
          label: device.label,
          reason: "sem_veiculo_no_cadastro",
        });
        continue;
      }
      if (!device.position) {
        // Rastreador vinculado mas sem posicao valida (nunca reportou, GPS
        // sem fix, resposta sem bloco de posicao) — nao e erro, so nao ha o
        // que gravar nesta rodada.
        unmatched.push({
          externalDeviceId: device.deviceId,
          plate: device.plate,
          label: device.label,
          reason: "sem_posicao",
        });
        continue;
      }
      readings.push({
        vehicleId: vehicle.id,
        speedKmh: device.position.speedKmh,
        latitude: device.position.latitude,
        longitude: device.position.longitude,
        recordedAt: device.position.recordedAt,
        externalDeviceId: device.deviceId,
      });
    }

    return { readings, unmatched };
  }
}

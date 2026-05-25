export type FuelFillup = {
  id: string;
  session_id: string | null;
  bus_reference: string;
  km_at_fillup: number;
  liters: number;
  filled_at: string;
};

export type VehicleConsumption = {
  bus_reference: string;
  totalLiters: number; // litres consumed between fill-ups (excluding first)
  totalKm: number; // km driven between fill-ups
  litersPer100km: number | null;
  fillupCount: number;
};

/**
 * Compute fuel consumption per vehicle.
 *
 * Method: for each vehicle, sort fill-ups by odometer. Between two consecutive
 * fill-ups, the litres of the second one filled up the tank for the km driven
 * since the previous fill-up. So consumption = sum(liters of fill-ups except
 * first) / sum(km diffs) × 100.
 *
 * A vehicle with fewer than 2 fill-ups has no measurable consumption yet.
 */
export function computeVehicleConsumption(fillups: FuelFillup[]): VehicleConsumption[] {
  const byVehicle = new Map<string, FuelFillup[]>();
  for (const f of fillups) {
    const key = f.bus_reference.trim();
    if (!key) continue;
    const arr = byVehicle.get(key) ?? [];
    arr.push(f);
    byVehicle.set(key, arr);
  }
  const out: VehicleConsumption[] = [];
  for (const [bus, arr] of byVehicle) {
    arr.sort((a, b) => a.km_at_fillup - b.km_at_fillup);
    let liters = 0;
    let km = 0;
    for (let i = 1; i < arr.length; i++) {
      const dk = arr[i].km_at_fillup - arr[i - 1].km_at_fillup;
      if (dk <= 0) continue;
      km += dk;
      liters += Number(arr[i].liters) || 0;
    }
    out.push({
      bus_reference: bus,
      totalLiters: liters,
      totalKm: km,
      litersPer100km: km > 0 ? (liters / km) * 100 : null,
      fillupCount: arr.length,
    });
  }
  out.sort((a, b) => a.bus_reference.localeCompare(b.bus_reference, undefined, { numeric: true }));
  return out;
}

export function overallConsumption(fillups: FuelFillup[]): {
  litersPer100km: number | null;
  totalKm: number;
  totalLiters: number;
} {
  const per = computeVehicleConsumption(fillups);
  let liters = 0;
  let km = 0;
  for (const v of per) {
    liters += v.totalLiters;
    km += v.totalKm;
  }
  return {
    totalLiters: liters,
    totalKm: km,
    litersPer100km: km > 0 ? (liters / km) * 100 : null,
  };
}

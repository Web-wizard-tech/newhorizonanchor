export const CROP_DATABASE_VERSION = 'fao56-crops-v1.3.0';

export interface CropParams {
  id: string;
  name: string;
  scientificName: string;
  tBaseC: number;
  tUpperC: number;
  heatThresholdC: number;
  frostThresholdC: number;
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  stageDays: { ini: number; dev: number; mid: number; late: number };
  zrMinM: number;
  zrMaxM: number;
  pBase: number; // soil water depletion fraction for no stress (FAO-56 Table 22)
  optimalPh: [number, number];
  ecThresholdDsM: number;
  sourceRef: string;
}

const CATALOG: CropParams[] = [
  {
    id: 'wheat',
    name: 'Wheat',
    scientificName: 'Triticum aestivum L.',
    tBaseC: 4,
    tUpperC: 26,
    heatThresholdC: 31,
    frostThresholdC: -2,
    kcIni: 0.30,
    kcMid: 1.15,
    kcEnd: 0.30,
    stageDays: { ini: 20, dev: 35, mid: 40, late: 25 },
    zrMinM: 0.30,
    zrMaxM: 1.20,
    pBase: 0.55,
    optimalPh: [6.0, 7.5],
    ecThresholdDsM: 6.0,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'maize',
    name: 'Maize',
    scientificName: 'Zea mays L.',
    tBaseC: 10,
    tUpperC: 30,
    heatThresholdC: 35,
    frostThresholdC: 2,
    kcIni: 0.30,
    kcMid: 1.20,
    kcEnd: 0.35,
    stageDays: { ini: 20, dev: 30, mid: 35, late: 25 },
    zrMinM: 0.30,
    zrMaxM: 1.20,
    pBase: 0.55,
    optimalPh: [5.8, 7.2],
    ecThresholdDsM: 1.7,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'soybean',
    name: 'Soybean',
    scientificName: 'Glycine max (L.) Merr.',
    tBaseC: 10,
    tUpperC: 30,
    heatThresholdC: 34,
    frostThresholdC: 2,
    kcIni: 0.40,
    kcMid: 1.15,
    kcEnd: 0.50,
    stageDays: { ini: 18, dev: 28, mid: 40, late: 22 },
    zrMinM: 0.25,
    zrMaxM: 0.90,
    pBase: 0.50,
    optimalPh: [6.0, 7.0],
    ecThresholdDsM: 5.0,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'barley',
    name: 'Barley',
    scientificName: 'Hordeum vulgare L.',
    tBaseC: 4,
    tUpperC: 26,
    heatThresholdC: 30,
    frostThresholdC: -3,
    kcIni: 0.30,
    kcMid: 1.15,
    kcEnd: 0.25,
    stageDays: { ini: 20, dev: 30, mid: 40, late: 25 },
    zrMinM: 0.30,
    zrMaxM: 1.10,
    pBase: 0.55,
    optimalPh: [6.0, 7.8],
    ecThresholdDsM: 8.0,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'peas',
    name: 'Peas',
    scientificName: 'Pisum sativum L.',
    tBaseC: 4,
    tUpperC: 25,
    heatThresholdC: 28,
    frostThresholdC: -1,
    kcIni: 0.50,
    kcMid: 1.15,
    kcEnd: 0.30,
    stageDays: { ini: 15, dev: 25, mid: 35, late: 15 },
    zrMinM: 0.25,
    zrMaxM: 0.75,
    pBase: 0.35,
    optimalPh: [6.0, 7.2],
    ecThresholdDsM: 1.8,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'sunflowers',
    name: 'Sunflower',
    scientificName: 'Helianthus annuus L.',
    tBaseC: 8,
    tUpperC: 32,
    heatThresholdC: 36,
    frostThresholdC: 1,
    kcIni: 0.35,
    kcMid: 1.10,
    kcEnd: 0.35,
    stageDays: { ini: 20, dev: 30, mid: 40, late: 20 },
    zrMinM: 0.35,
    zrMaxM: 1.40,
    pBase: 0.45,
    optimalPh: [6.0, 7.5],
    ecThresholdDsM: 4.8,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'potato',
    name: 'Potato',
    scientificName: 'Solanum tuberosum L.',
    tBaseC: 7,
    tUpperC: 26,
    heatThresholdC: 30,
    frostThresholdC: 0,
    kcIni: 0.50,
    kcMid: 1.15,
    kcEnd: 0.75,
    stageDays: { ini: 25, dev: 30, mid: 35, late: 25 },
    zrMinM: 0.25,
    zrMaxM: 0.60,
    pBase: 0.35,
    optimalPh: [5.2, 6.4],
    ecThresholdDsM: 1.7,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'tomatoes',
    name: 'Tomatoes',
    scientificName: 'Solanum lycopersicum L.',
    tBaseC: 10,
    tUpperC: 30,
    heatThresholdC: 34,
    frostThresholdC: 2,
    kcIni: 0.60,
    kcMid: 1.15,
    kcEnd: 0.80,
    stageDays: { ini: 30, dev: 40, mid: 40, late: 25 },
    zrMinM: 0.25,
    zrMaxM: 0.85,
    pBase: 0.40,
    optimalPh: [5.8, 7.0],
    ecThresholdDsM: 2.5,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'rice',
    name: 'Rice',
    scientificName: 'Oryza sativa L.',
    tBaseC: 10,
    tUpperC: 32,
    heatThresholdC: 35,
    frostThresholdC: 5,
    kcIni: 1.05,
    kcMid: 1.20,
    kcEnd: 0.90,
    stageDays: { ini: 30, dev: 30, mid: 40, late: 30 },
    zrMinM: 0.20,
    zrMaxM: 0.50,
    pBase: 0.20,
    optimalPh: [5.5, 7.0],
    ecThresholdDsM: 3.0,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
  {
    id: 'cotton',
    name: 'Cotton',
    scientificName: 'Gossypium hirsutum L.',
    tBaseC: 15,
    tUpperC: 34,
    heatThresholdC: 38,
    frostThresholdC: 4,
    kcIni: 0.35,
    kcMid: 1.18,
    kcEnd: 0.60,
    stageDays: { ini: 30, dev: 50, mid: 55, late: 45 },
    zrMinM: 0.35,
    zrMaxM: 1.40,
    pBase: 0.65,
    optimalPh: [5.8, 8.0],
    ecThresholdDsM: 7.7,
    sourceRef: 'FAO Irrigation & Drainage Paper 56 (Tables 11, 12, 22)',
  },
];

export function resolveCropParams(cropNameOrId: string | null | undefined): CropParams | null {
  if (!cropNameOrId || typeof cropNameOrId !== 'string') return null;
  const norm = cropNameOrId.trim().toLowerCase();
  if (!norm || norm === 'unknown' || norm === 'unassigned') return null;
  const aliases: Record<string, string> = {
    corn: 'maize',
    'field peas': 'peas',
    pea: 'peas',
    'winter wheat': 'wheat',
    'spring wheat': 'wheat',
    sunflower: 'sunflowers',
    soybeans: 'soybean',
    tomato: 'tomatoes',
  };
  const target = aliases[norm] || norm;
  return (
    CATALOG.find(
      (c) => c.id === target || c.name.toLowerCase() === target || target.includes(c.id)
    ) ?? null
  );
}

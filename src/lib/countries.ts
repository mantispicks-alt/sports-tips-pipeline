// Country hubs — one landing page per major market we affiliate in. The `code`
// field is the ISO-3166 code used in each bookmaker's `geos` / `restricted`
// arrays; the `slug` is the SEO-friendly URL segment.

export interface Country {
  slug: string;
  code: string;      // ISO-3166 alpha-2
  displayEn: string;
  displayEl: string;
  regulator: string;
  helpline: string;
  currency: string;
  descEn: string;
  descEl: string;
}

export const COUNTRIES: Country[] = [
  {
    slug: 'cyprus',
    code: 'CY',
    displayEn: 'Cyprus',
    displayEl: 'Κύπρος',
    regulator: 'National Betting Authority (NBA)',
    helpline: 'ΚΕΘΕΑ — 210 9237777',
    currency: 'EUR',
    descEn: 'Sports betting in Cyprus is regulated by the National Betting Authority (NBA). Only NBA-licensed sportsbooks may legally accept bets from residents. The 18+ age limit applies.',
    descEl: 'Το αθλητικό στοίχημα στην Κύπρο ρυθμίζεται από την Εθνική Αρχή Στοιχημάτων (NBA). Μόνο αδειοδοτημένοι από την NBA πάροχοι δέχονται νόμιμα στοιχήματα από κατοίκους. Το όριο ηλικίας είναι 18+.',
  },
  {
    slug: 'greece',
    code: 'GR',
    displayEn: 'Greece',
    displayEl: 'Ελλάδα',
    regulator: 'ΕΕΕΠ (Hellenic Gaming Commission)',
    helpline: 'ΚΕΘΕΑ ΑΛΦΑ — 210 9217500',
    currency: 'EUR',
    descEn: 'Sports betting in Greece is regulated by ΕΕΕΠ (Hellenic Gaming Commission). Only operators with a Type 2 licence may legally accept bets from Greek residents. Age limit 21+.',
    descEl: 'Το αθλητικό στοίχημα στην Ελλάδα ρυθμίζεται από την ΕΕΕΠ. Μόνο πάροχοι με άδεια τύπου 2 δέχονται νόμιμα στοιχήματα από Έλληνες κατοίκους. Ηλικιακό όριο 21+.',
  },
  {
    slug: 'uk',
    code: 'GB',
    displayEn: 'United Kingdom',
    displayEl: 'Ηνωμένο Βασίλειο',
    regulator: 'UK Gambling Commission',
    helpline: 'GamCare — 0808 8020 133',
    currency: 'GBP',
    descEn: 'The UK gambling market is licensed and regulated by the UK Gambling Commission (UKGC). Only UKGC-licensed operators may legally offer bets to UK residents. GAMSTOP self-exclusion covers every UKGC licensee.',
    descEl: 'Η αγορά στοιχήματος στο UK ρυθμίζεται από την UK Gambling Commission (UKGC). Μόνο UKGC πάροχοι προσφέρουν νόμιμα στοιχήματα σε κατοίκους UK. Το GAMSTOP self-exclusion καλύπτει όλους τους αδειοδοτημένους.',
  },
  {
    slug: 'italy',
    code: 'IT',
    displayEn: 'Italy',
    displayEl: 'Ιταλία',
    regulator: 'ADM (Agenzia delle Dogane e dei Monopoli)',
    helpline: 'Numero Verde 800 558 822',
    currency: 'EUR',
    descEn: 'Sports betting in Italy is regulated by ADM (Agenzia delle Dogane e dei Monopoli). Only ADM-licensed operators may serve Italian residents. Age limit 18+.',
    descEl: 'Το αθλητικό στοίχημα στην Ιταλία ρυθμίζεται από την ADM. Μόνο αδειοδοτημένοι πάροχοι εξυπηρετούν κατοίκους. Όριο ηλικίας 18+.',
  },
  {
    slug: 'germany',
    code: 'DE',
    displayEn: 'Germany',
    displayEl: 'Γερμανία',
    regulator: 'GGL (Gemeinsame Glücksspielbehörde der Länder)',
    helpline: 'BZgA — 0800 137 27 00',
    currency: 'EUR',
    descEn: 'Sports betting in Germany is regulated by GGL (Gemeinsame Glücksspielbehörde der Länder). Only operators with a licence under the Interstate Treaty on Gambling may serve German residents. Age limit 18+.',
    descEl: 'Το αθλητικό στοίχημα στη Γερμανία ρυθμίζεται από την GGL. Μόνο αδειοδοτημένοι πάροχοι εξυπηρετούν κατοίκους. Όριο ηλικίας 18+.',
  },
  {
    slug: 'spain',
    code: 'ES',
    displayEn: 'Spain',
    displayEl: 'Ισπανία',
    regulator: 'DGOJ (Dirección General de Ordenación del Juego)',
    helpline: 'Federación Española Jugadores Rehabilitados — 900 200 225',
    currency: 'EUR',
    descEn: 'Sports betting in Spain is regulated by DGOJ (Dirección General de Ordenación del Juego). Only DGOJ-licensed operators may serve Spanish residents. Age limit 18+.',
    descEl: 'Το αθλητικό στοίχημα στην Ισπανία ρυθμίζεται από την DGOJ. Μόνο αδειοδοτημένοι πάροχοι εξυπηρετούν κατοίκους. Όριο ηλικίας 18+.',
  },
];

export function getCountryBySlug(slug: string): Country | undefined {
  return COUNTRIES.find((c) => c.slug === slug);
}

export function isBookmakerAvailableIn(
  geos: string[] | undefined,
  restricted: string[] | undefined,
  code: string,
): boolean {
  const r = (restricted ?? []).map((s) => s.toUpperCase());
  if (r.includes(code.toUpperCase())) return false;
  const g = (geos ?? []).map((s) => s.toUpperCase());
  if (g.length === 0) return true; // undefined = worldwide
  if (g.includes('ALL')) return true;
  return g.includes(code.toUpperCase());
}

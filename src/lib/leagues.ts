// Curated list of leagues that get their own static hub page. Each entry
// includes the aliases that the tip-generator uses across the source data so
// spelling variants ("Premier League", "England Premier League") all count
// toward the same hub. Only leagues that have or will have meaningful tip
// volume are here — building a page per every 597 leagues would explode the
// build and waste ranking equity on empty pages.

export interface LeagueHub {
  slug: string;
  displayEn: string;
  displayEl: string;
  country: string;
  aliases: string[]; // exact-match, case-insensitive; matches on tip.league
  tag: 'domestic-top' | 'domestic-second' | 'european-club' | 'international' | 'cup';
  descEn: string;
  descEl: string;
}

export const LEAGUE_HUBS: LeagueHub[] = [
  {
    slug: 'premier-league',
    displayEn: 'Premier League',
    displayEl: 'Premier League',
    country: 'England',
    aliases: ['Premier League', 'England Premier League', 'EPL'],
    tag: 'domestic-top',
    descEn: 'The English Premier League — the most-watched football league in the world, with 20 clubs playing 38 rounds from August to May.',
    descEl: 'H Premier League — η πιο δημοφιλής ποδοσφαιρική λίγκα στον κόσμο, με 20 ομάδες και 38 αγωνιστικές από Αύγουστο μέχρι Μάιο.',
  },
  {
    slug: 'la-liga',
    displayEn: 'La Liga',
    displayEl: 'La Liga',
    country: 'Spain',
    aliases: ['La Liga', 'Spain La Liga', 'Primera Division', 'LaLiga'],
    tag: 'domestic-top',
    descEn: 'Spain\'s top-flight, home to Real Madrid, Barcelona and Atlético — one of the most tactically diverse leagues in Europe.',
    descEl: 'Η κορυφαία ισπανική κατηγορία, με Real Madrid, Barcelona και Atlético — μία από τις πιο τακτικά ποικίλες λίγκες στην Ευρώπη.',
  },
  {
    slug: 'serie-a',
    displayEn: 'Serie A',
    displayEl: 'Serie A',
    country: 'Italy',
    aliases: ['Serie A', 'Italy Serie A'],
    tag: 'domestic-top',
    descEn: 'Italy\'s top-flight — 20 clubs, low-scoring on average, and one of the strongest defensive leagues in world football.',
    descEl: 'Η κορυφαία ιταλική κατηγορία — 20 ομάδες, χαμηλή μέση σκοραρίσματος, μία από τις πιο αμυντικές λίγκες στον κόσμο.',
  },
  {
    slug: 'bundesliga',
    displayEn: 'Bundesliga',
    displayEl: 'Bundesliga',
    country: 'Germany',
    aliases: ['Bundesliga', 'Germany Bundesliga', 'Bundesliga 1'],
    tag: 'domestic-top',
    descEn: 'Germany\'s top-flight, famous for high-tempo, attacking football and the second-highest average goals-per-game of any major European league.',
    descEl: 'Η κορυφαία γερμανική κατηγορία, φημισμένη για γρήγορο, επιθετικό ποδόσφαιρο και τον δεύτερο υψηλότερο μέσο όρο γκολ ανά αγώνα.',
  },
  {
    slug: 'ligue-1',
    displayEn: 'Ligue 1',
    displayEl: 'Ligue 1',
    country: 'France',
    aliases: ['Ligue 1', 'France Ligue 1'],
    tag: 'domestic-top',
    descEn: 'France\'s top-flight — 18 clubs from 2024/25 onwards, dominated by PSG and increasingly tactical outside the top two.',
    descEl: 'Η κορυφαία γαλλική κατηγορία — 18 ομάδες από το 2024/25, με κυριαρχία PSG και τακτική εξέλιξη εκτός των δύο πρώτων.',
  },
  {
    slug: 'champions-league',
    displayEn: 'UEFA Champions League',
    displayEl: 'UEFA Champions League',
    country: 'Europe',
    aliases: ['Champions League', 'UEFA Champions League'],
    tag: 'european-club',
    descEn: 'Europe\'s most prestigious club competition. New league-phase format from 2024/25 — 36 clubs, 8 matches, single table before the knockouts.',
    descEl: 'Η κορυφαία ευρωπαϊκή διοργάνωση συλλόγων. Νέο league-phase format από 2024/25 — 36 ομάδες, 8 αγώνες, ενιαία βαθμολογία.',
  },
  {
    slug: 'europa-league',
    displayEn: 'UEFA Europa League',
    displayEl: 'UEFA Europa League',
    country: 'Europe',
    aliases: ['Europa League', 'UEFA Europa League', 'UEFA - Europa League Qualifiers'],
    tag: 'european-club',
    descEn: 'The second tier of UEFA club football, sharing the same league-phase format as the Champions League.',
    descEl: 'Η δεύτερη UEFA κατηγορία, με το ίδιο league-phase format όπως το Champions League.',
  },
  {
    slug: 'conference-league',
    displayEn: 'UEFA Conference League',
    displayEl: 'UEFA Conference League',
    country: 'Europe',
    aliases: ['Conference League', 'UEFA Conference League', 'UEFA - Conference League Qualifiers'],
    tag: 'european-club',
    descEn: 'UEFA\'s third-tier club competition, launched in 2021 — high variance, plenty of value in the qualifying rounds.',
    descEl: 'Η τρίτη UEFA κατηγορία, από το 2021 — μεγάλη variance, πολύ value στους προκριματικούς γύρους.',
  },
  {
    slug: 'championship',
    displayEn: 'EFL Championship',
    displayEl: 'EFL Championship',
    country: 'England',
    aliases: ['Championship', 'England Championship', 'EFL Championship'],
    tag: 'domestic-second',
    descEn: 'The English second tier — 24 clubs, 46 rounds, and one of the most gruelling leagues in Europe. Deep market inefficiencies make it prime hunting ground.',
    descEl: 'Η αγγλική δεύτερη κατηγορία — 24 ομάδες, 46 αγωνιστικές, η πιο εξαντλητική λίγκα στην Ευρώπη. Βαθιές ανεπάρκειες αγοράς την κάνουν ιδανική για value.',
  },
  {
    slug: 'mls',
    displayEn: 'Major League Soccer (MLS)',
    displayEl: 'Major League Soccer (MLS)',
    country: 'USA / Canada',
    aliases: ['MLS', 'Major League Soccer'],
    tag: 'domestic-top',
    descEn: 'The top league of the United States and Canada — conference-based table with playoffs. Home-field advantage runs larger than in most European leagues.',
    descEl: 'Η κορυφαία λίγκα ΗΠΑ/Καναδά — conference table με playoffs. Πλεονέκτημα έδρας μεγαλύτερο από τις περισσότερες ευρωπαϊκές λίγκες.',
  },
  {
    slug: 'saudi-pro-league',
    displayEn: 'Saudi Pro League',
    displayEl: 'Saudi Pro League',
    country: 'Saudi Arabia',
    aliases: ['Saudi Pro League', 'SPL'],
    tag: 'domestic-top',
    descEn: 'Saudi Arabia\'s top-flight — a growing destination for global stars, with expanding market depth on the exchanges.',
    descEl: 'Η κορυφαία σαουδαραβική κατηγορία — αυξανόμενος προορισμός για παγκόσμιους αστέρες, με βαθύτερη αγορά.',
  },
  {
    slug: 'brazil-serie-a',
    displayEn: 'Brasileirão Série A',
    displayEl: 'Brasileirão Série A',
    country: 'Brazil',
    aliases: ['Brasileirão Serie A', 'Brazil Serie A', 'Brasileirao Serie A'],
    tag: 'domestic-top',
    descEn: 'Brazil\'s top-flight — 20 clubs, 38 rounds, and enormous away-side variance. Late-season fixture congestion regularly produces market mispricings.',
    descEl: 'Η κορυφαία βραζιλιάνικη κατηγορία — 20 ομάδες, 38 αγωνιστικές, τεράστια variance από φιλοξενούμενες. Fixture congestion κατά τη λήξη σεζόν φέρνει mispricings.',
  },
  {
    slug: 'copa-libertadores',
    displayEn: 'Copa Libertadores',
    displayEl: 'Copa Libertadores',
    country: 'South America',
    aliases: ['Copa Libertadores'],
    tag: 'european-club',
    descEn: 'South America\'s top club competition. Group stage plus knockout format, with altitude and travel a real edge factor.',
    descEl: 'Η κορυφαία διασυλλογική διοργάνωση της Νοτίου Αμερικής. Group stage + νοκ-άουτ, υψόμετρο και ταξίδι πραγματικός παράγοντας.',
  },
  {
    slug: 'liga-portugal',
    displayEn: 'Liga Portugal',
    displayEl: 'Liga Portugal',
    country: 'Portugal',
    aliases: ['Portugal Primeira', 'Liga Portugal Betclic', 'Liga Portugal', 'Primeira Liga'],
    tag: 'domestic-top',
    descEn: 'Portugal\'s top-flight — dominated by Benfica, Porto and Sporting, with regular Europa League value plays outside the Big Three.',
    descEl: 'Η κορυφαία πορτογαλική κατηγορία — Benfica, Porto, Sporting κυριαρχούν, τακτικά value spots εκτός των τριών.',
  },
  {
    slug: 'liga-mx',
    displayEn: 'Liga MX',
    displayEl: 'Liga MX',
    country: 'Mexico',
    aliases: ['Liga MX Apertura', 'Liga MX', 'Liga MX Clausura'],
    tag: 'domestic-top',
    descEn: 'Mexico\'s top-flight — apertura and clausura tournaments per season, high-scoring on average, home advantage a persistent edge.',
    descEl: 'Η κορυφαία μεξικάνικη κατηγορία — apertura και clausura ανά σεζόν, υψηλά σκορ κατά μέσο όρο, πλεονέκτημα έδρας σταθερός δείκτης.',
  },
];

export function getLeagueBySlug(slug: string): LeagueHub | undefined {
  return LEAGUE_HUBS.find((l) => l.slug === slug);
}

export function tipMatchesLeague(tipLeague: string | undefined | null, hub: LeagueHub): boolean {
  if (!tipLeague) return false;
  const norm = tipLeague.trim().toLowerCase();
  return hub.aliases.some((a) => a.toLowerCase() === norm);
}

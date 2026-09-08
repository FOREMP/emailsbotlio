// Coverage imported from the query lists previously run locally in
// /Users/eric/google-maps-scraper.  This is deliberately city × niche rather
// than a copy of every wording variant: a completed local search of
// "frisör Göteborg" and "hair salon Göteborg" should prevent the automatic
// planner from spending another Maps job on the same market.
export type LegacyScrapeCoverage = {
  language: 'sv' | 'en'
  city: string
  nicheKey: string
  sourceFile: string
}

function coverage(language: 'sv' | 'en', nicheKey: string, sourceFile: string, cities: string[]): LegacyScrapeCoverage[] {
  return cities.map((city) => ({ language, city, nicheKey, sourceFile }))
}

export const LEGACY_SCRAPE_COVERAGE: LegacyScrapeCoverage[] = [
  ...coverage('sv', 'hair_salon', 'frisorer_skane.txt', ['Malmö', 'Lund', 'Helsingborg', 'Ängelholm']),
  ...coverage('sv', 'hair_salon', 'frisorer_goteborg.txt', [
    'Göteborg', 'Mölndal', 'Kållered', 'Lindome', 'Mölnlycke', 'Partille',
    'Sävedalen', 'Lerum', 'Floda', 'Kungälv', 'Ytterby', 'Torslanda',
    'Hisingen', 'Lindholmen', 'Eriksberg', 'Backaplan', 'Kärra', 'Tuve', 'Angered',
  ]),
  ...coverage('sv', 'hair_salon', 'frisorer_mellanstader.txt', [
    'Växjö', 'Teleborg', 'Hovshaga', 'Sandsbro', 'Kristianstad', 'Nosaby',
    'Vä', 'Åhus', 'Köping', 'Kolsva', 'Munktorp', 'Uppsala',
  ]),
  ...coverage('sv', 'auto_workshop', 'queries.txt', ['Malmö', 'Helsingborg', 'Göteborg']),
  ...coverage('sv', 'electrician', 'elektrikerskane.txt', ['Malmö', 'Lund', 'Helsingborg', 'Lomma']),
  ...coverage('sv', 'electrician', 'trades_goteborg.txt', ['Göteborg', 'Mölndal', 'Partille', 'Kungälv', 'Hisingen', 'Västra Frölunda', 'Majorna']),
  ...coverage('sv', 'plumber', 'trades_goteborg.txt', ['Göteborg', 'Mölndal', 'Partille', 'Kungälv', 'Hisingen', 'Västra Frölunda']),
  ...coverage('sv', 'roofer', 'trades_goteborg.txt', ['Göteborg', 'Mölndal', 'Partille', 'Kungälv', 'Hisingen']),
  ...coverage('sv', 'painter', 'trades_goteborg.txt', ['Göteborg', 'Mölndal', 'Partille', 'Kungälv', 'Hisingen', 'Västra Frölunda', 'Majorna']),
  ...coverage('en', 'hair_salon', 'frisorer_london.txt', ['London', 'Soho', 'Covent Garden', 'Mayfair', 'Marylebone', 'Fitzrovia', 'Chelsea', 'Kensington', 'Fulham', 'Hammersmith', 'Chiswick', 'Richmond', 'Putney', 'Wimbledon', 'Clapham', 'Battersea', 'Brixton', 'Streatham', 'Balham', 'Dulwich', 'Peckham', 'Camberwell', 'Greenwich', 'Lewisham', 'Blackheath', 'Canary Wharf', 'Stratford', 'Bow', 'Hackney', 'Dalston', 'Shoreditch']),
  ...coverage('en', 'garage_doors', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'driveway', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'flooring', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'drainage', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'removals', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'tree_service', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'solar', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'insulation', 'manchester_new_trades.txt', ['Manchester', 'Stockport', 'Bolton', 'Oldham', 'Salford']),
  ...coverage('en', 'trades', 'london_trades.txt', ['Croydon', 'Bromley', 'Sutton', 'Kingston upon Thames']),
  ...coverage('en', 'home_services', 'dfw_home_services.txt', ['Fort Worth', 'Arlington', 'Plano', 'Frisco', 'McKinney', 'Garland', 'Irving']),
]

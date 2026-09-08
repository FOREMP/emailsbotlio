-- Recommended market catalogue for the owned Sweden and UK sourcing lanes.
--
-- Each row is a single, deliberate Google Maps query.  Several query variants
-- may share a niche family (for example restaurant, bistro/cafe and bar), so
-- we retain `search_key` in addition to `niche_key`.  That lets the planner
-- cover the variants once each without treating the first restaurant result as
-- proof that all food venues in a city were searched.

alter table public.lead_markets
  add column if not exists search_key text;

update public.lead_markets
set search_key = 'all'
where search_key is null or btrim(search_key) = '';

alter table public.lead_markets
  alter column search_key set default 'all',
  alter column search_key set not null;

alter table public.lead_scrape_history
  add column if not exists search_key text;

update public.lead_scrape_history
set search_key = 'all'
where search_key is null or btrim(search_key) = '';

alter table public.lead_scrape_history
  alter column search_key set default 'all',
  alter column search_key set not null;

-- Replace the old city x family uniqueness with city x family x query variant.
-- Existing history receives `all`, which deliberately continues to block every
-- new variant for a market that was already comprehensively searched locally.
alter table public.lead_scrape_history
  drop constraint if exists lead_scrape_history_user_id_language_city_key_niche_key_key;

create unique index if not exists lead_scrape_history_user_locale_variant_key
  on public.lead_scrape_history(user_id, language, city_key, niche_key, search_key);

create index if not exists lead_markets_user_locale_variant_idx
  on public.lead_markets(user_id, language, country_code, city, niche_key, search_key);

-- The existing lead-market owners are the only recipients of this operational
-- catalogue.  This avoids creating sourcing plans for unrelated future users.
with owners as (
  select distinct user_id from public.lead_markets
), cities(language, country_code, country_name, city, city_rank) as (
  values
    ('sv', 'SE', 'Sverige', 'Stockholm', 1),
    ('sv', 'SE', 'Sverige', 'Göteborg', 2),
    ('sv', 'SE', 'Sverige', 'Malmö', 3),
    ('sv', 'SE', 'Sverige', 'Uppsala', 4),
    ('sv', 'SE', 'Sverige', 'Västerås', 5),
    ('sv', 'SE', 'Sverige', 'Örebro', 6),
    ('sv', 'SE', 'Sverige', 'Linköping', 7),
    ('sv', 'SE', 'Sverige', 'Helsingborg', 8),
    ('sv', 'SE', 'Sverige', 'Jönköping', 9),
    ('sv', 'SE', 'Sverige', 'Norrköping', 10),
    ('sv', 'SE', 'Sverige', 'Lund', 11),
    ('sv', 'SE', 'Sverige', 'Umeå', 12),
    ('sv', 'SE', 'Sverige', 'Gävle', 13),
    ('sv', 'SE', 'Sverige', 'Borås', 14),
    ('sv', 'SE', 'Sverige', 'Södertälje', 15),
    ('sv', 'SE', 'Sverige', 'Halmstad', 16),
    ('sv', 'SE', 'Sverige', 'Eskilstuna', 17),
    ('sv', 'SE', 'Sverige', 'Växjö', 18),
    ('sv', 'SE', 'Sverige', 'Karlstad', 19),
    ('sv', 'SE', 'Sverige', 'Sundsvall', 20),
    ('sv', 'SE', 'Sverige', 'Kristianstad', 21),
    ('sv', 'SE', 'Sverige', 'Skövde', 22),
    ('sv', 'SE', 'Sverige', 'Kalmar', 23),
    ('sv', 'SE', 'Sverige', 'Falun', 24),
    ('sv', 'SE', 'Sverige', 'Trollhättan', 25),
    ('en', 'GB', 'United Kingdom', 'London', 1),
    ('en', 'GB', 'United Kingdom', 'Birmingham', 2),
    ('en', 'GB', 'United Kingdom', 'Manchester', 3),
    ('en', 'GB', 'United Kingdom', 'Leeds', 4),
    ('en', 'GB', 'United Kingdom', 'Liverpool', 5),
    ('en', 'GB', 'United Kingdom', 'Bristol', 6),
    ('en', 'GB', 'United Kingdom', 'Sheffield', 7),
    ('en', 'GB', 'United Kingdom', 'Newcastle upon Tyne', 8),
    ('en', 'GB', 'United Kingdom', 'Nottingham', 9),
    ('en', 'GB', 'United Kingdom', 'Leicester', 10),
    ('en', 'GB', 'United Kingdom', 'Coventry', 11),
    ('en', 'GB', 'United Kingdom', 'Bradford', 12),
    ('en', 'GB', 'United Kingdom', 'Cardiff', 13),
    ('en', 'GB', 'United Kingdom', 'Belfast', 14),
    ('en', 'GB', 'United Kingdom', 'Edinburgh', 15),
    ('en', 'GB', 'United Kingdom', 'Glasgow', 16),
    ('en', 'GB', 'United Kingdom', 'Southampton', 17),
    ('en', 'GB', 'United Kingdom', 'Portsmouth', 18),
    ('en', 'GB', 'United Kingdom', 'Reading', 19),
    ('en', 'GB', 'United Kingdom', 'Oxford', 20),
    ('en', 'GB', 'United Kingdom', 'Cambridge', 21),
    ('en', 'GB', 'United Kingdom', 'Brighton', 22),
    ('en', 'GB', 'United Kingdom', 'Plymouth', 23),
    ('en', 'GB', 'United Kingdom', 'Derby', 24),
    ('en', 'GB', 'United Kingdom', 'Stoke-on-Trent', 25)
), profiles(language, niche_key, search_key, category, search_term, profile_rank) as (
  values
    ('sv', 'hair_salon', 'hair_salon', 'Frisör & hårsalong', 'frisör', 1),
    ('sv', 'hair_salon', 'barber', 'Frisör & barberare', 'barberare', 2),
    ('sv', 'beauty_salon', 'beauty', 'Skönhet & behandlingar', 'skönhetssalong', 3),
    ('sv', 'beauty_salon', 'nails_lashes', 'Naglar, fransar & bryn', 'nagelsalong', 4),
    ('sv', 'massage_wellness', 'massage', 'Massage & wellness', 'massage', 5),
    ('sv', 'restaurant_food', 'restaurant', 'Restaurang & mat', 'restaurang', 6),
    ('sv', 'restaurant_food', 'bistro_cafe', 'Bistro & café', 'bistro', 7),
    ('sv', 'restaurant_food', 'bar_pub', 'Bar & pub', 'bar', 8),
    ('sv', 'restaurant_food', 'pizzeria', 'Pizzeria', 'pizzeria', 9),
    ('sv', 'auto_workshop', 'repair', 'Bilverkstad & mekaniker', 'bilverkstad', 10),
    ('sv', 'auto_workshop', 'tyres', 'Däck & hjulservice', 'däckverkstad', 11),
    ('sv', 'car_detailing', 'detailing', 'Bilvård & rekond', 'bilvård', 12),
    ('sv', 'builder_renovation', 'builder', 'Bygg & renovering', 'byggfirma', 13),
    ('sv', 'builder_renovation', 'carpenter', 'Snickeri & renovering', 'snickare', 14),
    ('sv', 'electrician', 'electrician', 'Elektriker', 'elektriker', 15),
    ('sv', 'plumber', 'plumber', 'VVS & rörmokare', 'rörmokare', 16),
    ('sv', 'roofer', 'roofer', 'Takläggare', 'takläggare', 17),
    ('sv', 'painter', 'painter', 'Målare', 'målare', 18),
    ('sv', 'cleaning', 'cleaning', 'Städfirma', 'städfirma', 19),
    ('sv', 'landscaping', 'landscaping', 'Trädgård & markarbete', 'trädgårdsskötsel', 20),
    ('sv', 'flooring_exterior', 'flooring', 'Golvläggning', 'golvläggare', 21),
    ('sv', 'flooring_exterior', 'windows_doors', 'Fönster & dörrar', 'fönsterbyte', 22),
    ('sv', 'pet_grooming', 'pet_grooming', 'Hundtrim & djurvård', 'hundtrim', 23),
    ('en', 'hair_salon', 'hair_salon', 'Hair salon', 'hair salon', 1),
    ('en', 'hair_salon', 'barber', 'Barber', 'barber', 2),
    ('en', 'beauty_salon', 'beauty', 'Beauty salon', 'beauty salon', 3),
    ('en', 'beauty_salon', 'nails_lashes', 'Nails, lashes & brows', 'nail salon', 4),
    ('en', 'massage_wellness', 'massage', 'Massage & wellness', 'massage therapist', 5),
    ('en', 'restaurant_food', 'restaurant', 'Restaurant & food', 'restaurant', 6),
    ('en', 'restaurant_food', 'bistro_cafe', 'Bistro & cafe', 'bistro', 7),
    ('en', 'restaurant_food', 'bar_pub', 'Bar & pub', 'bar', 8),
    ('en', 'restaurant_food', 'pizzeria', 'Pizzeria', 'pizzeria', 9),
    ('en', 'auto_workshop', 'repair', 'Auto repair & mechanics', 'auto repair shop', 10),
    ('en', 'auto_workshop', 'tyres', 'Tyres & wheel service', 'tyre shop', 11),
    ('en', 'car_detailing', 'detailing', 'Car detailing & valeting', 'car detailing', 12),
    ('en', 'builder_renovation', 'builder', 'Builders & renovation', 'builder', 13),
    ('en', 'builder_renovation', 'carpenter', 'Carpentry & renovation', 'carpenter', 14),
    ('en', 'electrician', 'electrician', 'Electrician', 'electrician', 15),
    ('en', 'plumber', 'plumber', 'Plumbing & heating', 'plumber', 16),
    ('en', 'roofer', 'roofer', 'Roofing', 'roofer', 17),
    ('en', 'painter', 'painter', 'Painting & decorating', 'painter and decorator', 18),
    ('en', 'cleaning', 'cleaning', 'Cleaning service', 'cleaning service', 19),
    ('en', 'landscaping', 'landscaping', 'Landscaping & gardening', 'landscaper', 20),
    ('en', 'flooring_exterior', 'flooring', 'Flooring', 'flooring contractor', 21),
    ('en', 'flooring_exterior', 'windows_doors', 'Windows & doors', 'window installer', 22),
    ('en', 'pet_grooming', 'pet_grooming', 'Pet grooming', 'dog groomer', 23)
)
insert into public.lead_markets (
  user_id, language, country_code, city, category, niche_key, search_key,
  search_query, is_enabled, priority, max_results, cooldown_days
)
select
  owners.user_id,
  cities.language,
  cities.country_code,
  cities.city,
  profiles.category,
  profiles.niche_key,
  profiles.search_key,
  profiles.search_term || ' ' || cities.city || ' ' || cities.country_name,
  true,
  (cities.city_rank * 30) + profiles.profile_rank,
  75,
  90
from owners
join cities on true
join profiles on profiles.language = cities.language
on conflict (user_id, language, country_code, city, search_query) do nothing;

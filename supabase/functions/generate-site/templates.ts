// Premium hand-crafted section library for the site generator.
// Claude Sonnet 4.5 receives this catalog and remixes 5-7 sections per page
// instead of inventing layouts from scratch. Every section uses CSS variables
// (--primary, --secondary, --accent, --bg, --surface, --text, --text-muted, --font-display, --font-body)
// so brand colors and fonts swap in cleanly. Image slots are {{IMAGE_1}}..{{IMAGE_N}} tokens.
// Text is placeholder — Claude rewrites with the lead's real content.

export interface SectionTemplate {
  name: string
  description: string
  slots: string[] // which pages this fits: 'home' | 'about' | 'services'
  html: string
}

export const SECTION_LIBRARY: Record<string, SectionTemplate> = {
  nav_sticky: {
    name: 'Sticky top navigation',
    description: 'Shared on every page. Logo left, links right, accent CTA. Active page marked.',
    slots: ['home', 'about', 'services'],
    html: `<nav style="position:sticky;top:0;z-index:50;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);background:color-mix(in srgb, var(--bg) 78%, transparent);border-bottom:1px solid color-mix(in srgb, var(--text) 8%, transparent);">
  <div style="max-width:1280px;margin:0 auto;padding:18px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px;">
    <a href="index.html" style="font-family:var(--font-display);font-weight:700;font-size:22px;letter-spacing:-0.02em;color:var(--text);text-decoration:none;">{{BUSINESS_NAME}}</a>
    <div style="display:flex;gap:8px;align-items:center;">
      <a href="index.html" class="nav-link" style="padding:10px 16px;color:var(--text-muted);text-decoration:none;font-weight:500;font-size:15px;border-radius:8px;transition:all .2s;">Hem</a>
      <a href="om-oss.html" class="nav-link" style="padding:10px 16px;color:var(--text-muted);text-decoration:none;font-weight:500;font-size:15px;border-radius:8px;transition:all .2s;">Om oss</a>
      <a href="tjanster.html" class="nav-link" style="padding:10px 16px;color:var(--text-muted);text-decoration:none;font-weight:500;font-size:15px;border-radius:8px;transition:all .2s;">Tjänster</a>
      <a href="index.html#kontakt" style="padding:11px 22px;background:var(--primary);color:var(--bg);text-decoration:none;font-weight:600;font-size:15px;border-radius:10px;transition:all .2s;box-shadow:0 4px 20px color-mix(in srgb, var(--primary) 35%, transparent);">Kontakta oss</a>
    </div>
  </div>
</nav>
<style>.nav-link:hover{color:var(--text);background:color-mix(in srgb, var(--text) 6%, transparent);}.nav-active{color:var(--text) !important;background:color-mix(in srgb, var(--primary) 12%, transparent) !important;}</style>`,
  },

  hero_fullbleed: {
    name: 'Full-bleed hero with gradient overlay',
    description: 'Dramatic full-width image, deep gradient, oversized headline, twin CTAs. Best for homepage.',
    slots: ['home'],
    html: `<section style="position:relative;min-height:88vh;display:flex;align-items:center;overflow:hidden;isolation:isolate;">
  <img src="{{IMAGE_1}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;"/>
  <div style="position:absolute;inset:0;background:linear-gradient(105deg, color-mix(in srgb, var(--bg) 88%, transparent) 30%, color-mix(in srgb, var(--bg) 45%, transparent) 70%, transparent);z-index:-1;"></div>
  <div style="max-width:1280px;margin:0 auto;padding:120px 32px;width:100%;">
    <div style="max-width:720px;">
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:color-mix(in srgb, var(--primary) 18%, transparent);border:1px solid color-mix(in srgb, var(--primary) 35%, transparent);border-radius:100px;font-size:13px;font-weight:600;color:var(--primary);letter-spacing:0.02em;margin-bottom:32px;">
        <span style="width:6px;height:6px;background:var(--primary);border-radius:50%;box-shadow:0 0 12px var(--primary);"></span>{{TRUST_TAGLINE}}
      </div>
      <h1 style="font-family:var(--font-display);font-size:clamp(44px,7vw,84px);font-weight:800;line-height:1.02;letter-spacing:-0.03em;color:var(--text);margin:0 0 28px;">{{HERO_HEADLINE}}</h1>
      <p style="font-size:clamp(17px,1.4vw,20px);line-height:1.55;color:var(--text-muted);max-width:560px;margin:0 0 44px;">{{HERO_SUBLINE}}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <a href="{{CTA_PRIMARY_HREF}}" style="padding:18px 32px;background:var(--primary);color:var(--bg);text-decoration:none;font-weight:600;font-size:16px;border-radius:12px;box-shadow:0 12px 40px color-mix(in srgb, var(--primary) 40%, transparent);transition:transform .2s;">{{CTA_PRIMARY}}</a>
        <a href="#tjanster" style="padding:18px 32px;background:color-mix(in srgb, var(--text) 8%, transparent);color:var(--text);text-decoration:none;font-weight:600;font-size:16px;border-radius:12px;border:1px solid color-mix(in srgb, var(--text) 15%, transparent);backdrop-filter:blur(10px);transition:all .2s;">Se våra tjänster →</a>
      </div>
    </div>
  </div>
</section>`,
  },

  hero_split: {
    name: 'Split hero 55/45 with feature card overlay',
    description: 'Text left, large image right with a floating stats/feature card on the image. Editorial feel.',
    slots: ['home'],
    html: `<section style="padding:80px 32px 100px;background:var(--bg);">
  <div style="max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1.15fr 1fr;gap:80px;align-items:center;">
    <div>
      <div style="font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--primary);margin-bottom:24px;">{{HERO_EYEBROW}}</div>
      <h1 style="font-family:var(--font-display);font-size:clamp(40px,5.5vw,68px);font-weight:800;line-height:1.05;letter-spacing:-0.025em;color:var(--text);margin:0 0 28px;">{{HERO_HEADLINE}}</h1>
      <p style="font-size:19px;line-height:1.6;color:var(--text-muted);margin:0 0 40px;max-width:520px;">{{HERO_SUBLINE}}</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        <a href="{{CTA_PRIMARY_HREF}}" style="padding:16px 30px;background:var(--primary);color:var(--bg);text-decoration:none;font-weight:600;border-radius:12px;box-shadow:0 10px 30px color-mix(in srgb, var(--primary) 35%, transparent);">{{CTA_PRIMARY}}</a>
        <a href="tjanster.html" style="padding:16px 30px;background:transparent;color:var(--text);text-decoration:none;font-weight:600;border-radius:12px;border:1.5px solid color-mix(in srgb, var(--text) 20%, transparent);">Läs mer →</a>
      </div>
    </div>
    <div style="position:relative;">
      <img src="{{IMAGE_1}}" alt="" style="width:100%;height:560px;object-fit:cover;border-radius:20px;box-shadow:0 30px 80px color-mix(in srgb, var(--primary) 25%, transparent);"/>
      <div style="position:absolute;bottom:-30px;left:-30px;background:var(--surface);padding:24px 28px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);border:1px solid color-mix(in srgb, var(--text) 10%, transparent);max-width:260px;">
        <div style="font-family:var(--font-display);font-size:44px;font-weight:800;color:var(--primary);line-height:1;margin-bottom:8px;">{{FEATURE_STAT}}</div>
        <div style="color:var(--text);font-weight:600;font-size:15px;margin-bottom:4px;">{{FEATURE_LABEL}}</div>
        <div style="color:var(--text-muted);font-size:13px;">{{FEATURE_SUB}}</div>
      </div>
    </div>
  </div>
  <style>@media (max-width: 900px){section > div{grid-template-columns:1fr !important;gap:50px !important;}}</style>
</section>`,
  },

  page_header: {
    name: 'Simple page header with backdrop',
    description: 'Compact hero for om-oss and tjanster pages. Big title, sub, on subtle image backdrop.',
    slots: ['about', 'services'],
    html: `<section style="position:relative;padding:120px 32px 100px;overflow:hidden;isolation:isolate;border-bottom:1px solid color-mix(in srgb, var(--text) 8%, transparent);">
  <img src="{{IMAGE_1}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25;z-index:-2;"/>
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 70%, transparent) 100%);z-index:-1;"></div>
  <div style="max-width:1000px;margin:0 auto;text-align:center;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:20px;">{{PAGE_EYEBROW}}</div>
    <h1 style="font-family:var(--font-display);font-size:clamp(44px,6vw,72px);font-weight:800;line-height:1.05;letter-spacing:-0.025em;color:var(--text);margin:0 0 24px;">{{PAGE_TITLE}}</h1>
    <p style="font-size:20px;line-height:1.6;color:var(--text-muted);max-width:640px;margin:0 auto;">{{PAGE_SUB}}</p>
  </div>
</section>`,
  },

  trust_logostrip: {
    name: 'Trust strip — car brand marks',
    description: 'Row of car-brand text/logos they service. Use only brands mentioned in source data.',
    slots: ['home', 'services'],
    html: `<section style="padding:50px 32px;background:var(--surface);border-top:1px solid color-mix(in srgb, var(--text) 6%, transparent);border-bottom:1px solid color-mix(in srgb, var(--text) 6%, transparent);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="text-align:center;font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--text-muted);margin-bottom:28px;">{{TRUST_LABEL}}</div>
    <div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:48px;">
      {{BRAND_ITEMS}}
    </div>
  </div>
</section>
<!-- Each BRAND_ITEM: <span style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text-muted);letter-spacing:0.02em;opacity:.7;">BRAND</span> -->`,
  },

  stats_band: {
    name: 'Stats band — only with real numbers',
    description: 'Four large numbers with labels. ONLY use if source data has real stats (years in business, cars serviced, etc). Skip entirely if not.',
    slots: ['home', 'about'],
    html: `<section style="padding:80px 32px;background:linear-gradient(135deg, var(--surface) 0%, color-mix(in srgb, var(--primary) 12%, var(--surface)) 100%);">
  <div style="max-width:1280px;margin:0 auto;display:grid;grid-template-columns:repeat(4, 1fr);gap:40px;text-align:center;">
    {{STAT_ITEMS}}
  </div>
  <style>@media (max-width: 800px){section > div{grid-template-columns:repeat(2, 1fr) !important;}}</style>
</section>
<!-- Each STAT_ITEM: <div><div style="font-family:var(--font-display);font-size:clamp(40px,5vw,64px);font-weight:800;color:var(--primary);line-height:1;margin-bottom:10px;">NUMBER</div><div style="color:var(--text);font-weight:600;font-size:16px;margin-bottom:4px;">LABEL</div><div style="color:var(--text-muted);font-size:14px;">SUB</div></div> -->`,
  },

  services_grid_3col: {
    name: 'Services 3-column icon cards',
    description: 'Clean 3-column grid, each card has inline SVG icon, title, 2-line description. 3-6 cards.',
    slots: ['home', 'services'],
    html: `<section id="tjanster" style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:64px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">{{SECTION_EYEBROW}}</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0 0 20px;line-height:1.1;">{{SECTION_TITLE}}</h2>
      <p style="font-size:18px;color:var(--text-muted);max-width:600px;margin:0 auto;line-height:1.6;">{{SECTION_SUB}}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:28px;">
      {{SERVICE_CARDS}}
    </div>
  </div>
  <style>@media (max-width: 900px){section#tjanster > div > div:last-child{grid-template-columns:1fr !important;}}</style>
</section>
<!-- Each SERVICE_CARD:
<div style="padding:36px;background:var(--surface);border-radius:18px;border:1px solid color-mix(in srgb, var(--text) 8%, transparent);transition:all .3s;position:relative;overflow:hidden;">
  <div style="width:52px;height:52px;border-radius:12px;background:color-mix(in srgb, var(--primary) 18%, transparent);display:flex;align-items:center;justify-content:center;margin-bottom:24px;color:var(--primary);"><svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><!-- pick relevant icon --></svg></div>
  <h3 style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text);margin:0 0 12px;">TITLE</h3>
  <p style="color:var(--text-muted);line-height:1.6;margin:0;">DESC</p>
</div>
-->`,
  },

  services_bento: {
    name: 'Services asymmetric bento grid',
    description: 'One large feature card + 4 smaller cards in a 2-row bento. Modern editorial look.',
    slots: ['services'],
    html: `<section style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:1280px;margin:0 auto;">
    <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0 0 60px;max-width:640px;line-height:1.1;">{{SECTION_TITLE}}</h2>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:auto auto;gap:20px;">
      <div style="grid-row:span 2;padding:44px;background:linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);border-radius:22px;color:var(--bg);display:flex;flex-direction:column;justify-content:space-between;min-height:420px;position:relative;overflow:hidden;">
        <div>
          <div style="font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;opacity:.85;margin-bottom:20px;">{{FEATURE_EYEBROW}}</div>
          <h3 style="font-family:var(--font-display);font-size:36px;font-weight:800;margin:0 0 16px;line-height:1.15;">{{FEATURE_TITLE}}</h3>
          <p style="font-size:16px;line-height:1.6;opacity:.9;margin:0;">{{FEATURE_DESC}}</p>
        </div>
        <a href="#kontakt" style="align-self:flex-start;padding:12px 22px;background:var(--bg);color:var(--text);text-decoration:none;font-weight:600;border-radius:10px;">{{FEATURE_CTA}} →</a>
      </div>
      {{BENTO_SMALL_CARDS}}
    </div>
  </div>
</section>
<!-- Each BENTO_SMALL_CARD: <div style="padding:32px;background:var(--surface);border-radius:18px;border:1px solid color-mix(in srgb, var(--text) 8%, transparent);"><div style="color:var(--primary);margin-bottom:16px;"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><!--icon--></svg></div><h4 style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);margin:0 0 8px;">TITLE</h4><p style="color:var(--text-muted);font-size:14px;line-height:1.5;margin:0;">DESC</p></div> -->`,
  },

  services_list_detailed: {
    name: 'Services detailed list with numbers',
    description: 'Vertical list with big numbers, titles, descriptions. Great for tjänster page depth.',
    slots: ['services'],
    html: `<section style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:1000px;margin:0 auto;">
    <div style="margin-bottom:60px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">{{SECTION_EYEBROW}}</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0;line-height:1.1;">{{SECTION_TITLE}}</h2>
    </div>
    <div style="display:flex;flex-direction:column;">
      {{SERVICE_ROWS}}
    </div>
  </div>
</section>
<!-- Each SERVICE_ROW:
<div style="display:grid;grid-template-columns:80px 1fr auto;gap:32px;padding:32px 0;border-top:1px solid color-mix(in srgb, var(--text) 10%, transparent);align-items:start;">
  <div style="font-family:var(--font-display);font-size:36px;font-weight:800;color:var(--primary);line-height:1;">01</div>
  <div>
    <h3 style="font-family:var(--font-display);font-size:24px;font-weight:700;color:var(--text);margin:0 0 10px;">TITLE</h3>
    <p style="color:var(--text-muted);line-height:1.6;margin:0;font-size:16px;">DESC</p>
  </div>
  <a href="#kontakt" style="color:var(--primary);text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap;">Boka →</a>
</div>
-->`,
  },

  process_timeline: {
    name: 'Process 4-step horizontal timeline',
    description: '4 numbered steps in a row with connecting line. Boka → Lämna → Vi fixar → Hämta.',
    slots: ['home', 'services'],
    html: `<section style="padding:100px 32px;background:var(--surface);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:64px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">SÅ FUNKAR DET</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0;line-height:1.1;">{{PROCESS_TITLE}}</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:32px;position:relative;">
      <div style="position:absolute;top:26px;left:8%;right:8%;height:2px;background:color-mix(in srgb, var(--primary) 30%, transparent);z-index:0;"></div>
      {{PROCESS_STEPS}}
    </div>
  </div>
  <style>@media (max-width: 800px){section > div > div:last-child{grid-template-columns:1fr !important;}section > div > div:last-child > div:first-child{display:none;}}</style>
</section>
<!-- Each PROCESS_STEP:
<div style="position:relative;z-index:1;text-align:center;">
  <div style="width:54px;height:54px;border-radius:50%;background:var(--primary);color:var(--bg);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:22px;font-weight:800;margin:0 auto 20px;box-shadow:0 8px 24px color-mix(in srgb, var(--primary) 40%, transparent);">1</div>
  <h4 style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text);margin:0 0 10px;">STEP</h4>
  <p style="color:var(--text-muted);font-size:15px;line-height:1.5;margin:0;">DESC</p>
</div>
-->`,
  },

  gallery_masonry: {
    name: 'Gallery masonry 3-column',
    description: 'Varied-height image grid, hover lift. Use real lead images when available.',
    slots: ['home', 'about'],
    html: `<section style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="display:flex;justify-content:space-between;align-items:end;margin-bottom:48px;flex-wrap:wrap;gap:20px;">
      <div>
        <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:12px;">{{GALLERY_EYEBROW}}</div>
        <h2 style="font-family:var(--font-display);font-size:clamp(32px,4vw,48px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0;line-height:1.1;">{{GALLERY_TITLE}}</h2>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:20px;">
      <img src="{{IMAGE_1}}" alt="" style="width:100%;height:320px;object-fit:cover;border-radius:14px;"/>
      <img src="{{IMAGE_2}}" alt="" style="width:100%;height:420px;object-fit:cover;border-radius:14px;grid-row:span 2;"/>
      <img src="{{IMAGE_3}}" alt="" style="width:100%;height:200px;object-fit:cover;border-radius:14px;"/>
      <img src="{{IMAGE_4}}" alt="" style="width:100%;height:240px;object-fit:cover;border-radius:14px;"/>
      <img src="{{IMAGE_5}}" alt="" style="width:100%;height:280px;object-fit:cover;border-radius:14px;"/>
    </div>
  </div>
  <style>@media (max-width: 800px){section > div > div:last-child{grid-template-columns:1fr !important;}section img{height:240px !important;grid-row:auto !important;}}</style>
</section>`,
  },

  about_split: {
    name: 'About split — image left, story right',
    description: 'Large image left, headline + 2-3 paragraphs + value badges right. Om-oss page.',
    slots: ['about', 'home'],
    html: `<section style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1fr 1.1fr;gap:80px;align-items:center;">
    <div style="position:relative;">
      <img src="{{IMAGE_1}}" alt="" style="width:100%;height:600px;object-fit:cover;border-radius:20px;"/>
      <div style="position:absolute;top:24px;left:24px;padding:10px 18px;background:var(--primary);color:var(--bg);border-radius:100px;font-weight:600;font-size:13px;letter-spacing:0.05em;">{{ABOUT_BADGE}}</div>
    </div>
    <div>
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:20px;">{{ABOUT_EYEBROW}}</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0 0 28px;line-height:1.1;">{{ABOUT_TITLE}}</h2>
      <div style="color:var(--text-muted);font-size:17px;line-height:1.75;">{{ABOUT_BODY}}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:32px;">
        {{VALUE_BADGES}}
      </div>
    </div>
  </div>
  <style>@media (max-width: 900px){section > div{grid-template-columns:1fr !important;gap:50px !important;}}</style>
</section>
<!-- Each VALUE_BADGE: <span style="padding:10px 18px;background:var(--surface);border:1px solid color-mix(in srgb, var(--text) 12%, transparent);border-radius:100px;color:var(--text);font-weight:600;font-size:14px;">VALUE</span> -->`,
  },

  values_grid: {
    name: 'Values 3-column icon grid',
    description: '3-4 core values with icon, name, one-line description. Simple, clean.',
    slots: ['about'],
    html: `<section style="padding:100px 32px;background:var(--surface);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:60px;">
      <h2 style="font-family:var(--font-display);font-size:clamp(32px,4vw,44px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0 0 16px;line-height:1.1;">{{VALUES_TITLE}}</h2>
      <p style="color:var(--text-muted);font-size:17px;max-width:560px;margin:0 auto;">{{VALUES_SUB}}</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:32px;">
      {{VALUE_CARDS}}
    </div>
  </div>
  <style>@media (max-width: 800px){section > div > div:last-child{grid-template-columns:1fr !important;}}</style>
</section>
<!-- Each VALUE_CARD:
<div style="text-align:center;padding:20px;">
  <div style="width:64px;height:64px;border-radius:16px;background:color-mix(in srgb, var(--primary) 15%, transparent);color:var(--primary);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;"><svg width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><!--icon--></svg></div>
  <h4 style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--text);margin:0 0 10px;">TITLE</h4>
  <p style="color:var(--text-muted);font-size:15px;line-height:1.6;margin:0;">DESC</p>
</div>
-->`,
  },

  faq_accordion: {
    name: 'FAQ 4-6 questions',
    description: 'Native <details> accordion. Common workshop questions. Uses source data or industry standard.',
    slots: ['services'],
    html: `<section style="padding:100px 32px;background:var(--bg);">
  <div style="max-width:820px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:56px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">VANLIGA FRÅGOR</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(32px,4vw,48px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0;line-height:1.1;">{{FAQ_TITLE}}</h2>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      {{FAQ_ITEMS}}
    </div>
  </div>
</section>
<!-- Each FAQ_ITEM:
<details style="background:var(--surface);border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:14px;padding:22px 26px;">
  <summary style="font-family:var(--font-display);font-size:17px;font-weight:600;color:var(--text);cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;">QUESTION<span style="color:var(--primary);font-size:24px;font-weight:400;">+</span></summary>
  <p style="color:var(--text-muted);line-height:1.7;margin:16px 0 0;font-size:16px;">ANSWER</p>
</details>
-->`,
  },

  cta_band: {
    name: 'Full-width CTA band with backdrop',
    description: 'Bold gradient/image band, large headline, primary CTA. Between sections or before footer.',
    slots: ['home', 'about', 'services'],
    html: `<section style="padding:100px 32px;position:relative;overflow:hidden;isolation:isolate;">
  <img src="{{IMAGE_1}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25;z-index:-2;"/>
  <div style="position:absolute;inset:0;background:linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);opacity:.92;z-index:-1;"></div>
  <div style="max-width:900px;margin:0 auto;text-align:center;color:var(--bg);">
    <h2 style="font-family:var(--font-display);font-size:clamp(36px,5vw,60px);font-weight:800;letter-spacing:-0.025em;margin:0 0 20px;line-height:1.1;">{{CTA_HEADLINE}}</h2>
    <p style="font-size:19px;line-height:1.6;opacity:.92;margin:0 0 40px;max-width:600px;margin-left:auto;margin-right:auto;">{{CTA_SUB}}</p>
    <a href="{{CTA_HREF}}" style="display:inline-block;padding:18px 36px;background:var(--bg);color:var(--text);text-decoration:none;font-weight:700;font-size:17px;border-radius:12px;box-shadow:0 15px 40px rgba(0,0,0,.25);">{{CTA_LABEL}}</a>
  </div>
</section>`,
  },

  contact_split: {
    name: 'Contact — info left, Maps right',
    description: 'Phone/address/email/hours cards left, Google Maps iframe right. Use only real data.',
    slots: ['home'],
    html: `<section id="kontakt" style="padding:100px 32px;background:var(--surface);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:60px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">KONTAKT</div>
      <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0;line-height:1.1;">{{CONTACT_TITLE}}</h2>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:48px;align-items:start;">
      <div style="display:flex;flex-direction:column;gap:16px;">
        {{CONTACT_CARDS}}
      </div>
      <div style="border-radius:18px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.2);min-height:420px;background:var(--bg);">
        {{MAPS_EMBED}}
      </div>
    </div>
  </div>
  <style>@media (max-width: 900px){section#kontakt > div > div:last-child{grid-template-columns:1fr !important;}}</style>
</section>
<!-- Each CONTACT_CARD:
<a href="tel:PHONE" style="display:flex;gap:18px;padding:24px;background:var(--bg);border-radius:14px;text-decoration:none;border:1px solid color-mix(in srgb, var(--text) 8%, transparent);transition:all .2s;">
  <div style="width:44px;height:44px;flex-shrink:0;border-radius:10px;background:color-mix(in srgb, var(--primary) 15%, transparent);color:var(--primary);display:flex;align-items:center;justify-content:center;"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><!--icon--></svg></div>
  <div><div style="color:var(--text-muted);font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px;">LABEL</div><div style="color:var(--text);font-weight:600;font-size:16px;">VALUE</div></div>
</a>
MAPS_EMBED: <iframe src="URL" style="width:100%;height:100%;border:0;min-height:420px;" loading="lazy"></iframe> OR omit whole right column if no maps URL. -->`,
  },

  contact_centered: {
    name: 'Contact centered (no maps)',
    description: 'Simple centered contact block with phone/email/address cards. Use when no Maps URL.',
    slots: ['home'],
    html: `<section id="kontakt" style="padding:100px 32px;background:var(--surface);">
  <div style="max-width:1000px;margin:0 auto;text-align:center;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--primary);margin-bottom:16px;">KONTAKT</div>
    <h2 style="font-family:var(--font-display);font-size:clamp(34px,4.5vw,52px);font-weight:800;letter-spacing:-0.02em;color:var(--text);margin:0 0 20px;line-height:1.1;">{{CONTACT_TITLE}}</h2>
    <p style="font-size:18px;color:var(--text-muted);max-width:520px;margin:0 auto 48px;line-height:1.6;">{{CONTACT_SUB}}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;">
      {{CONTACT_CARDS}}
    </div>
  </div>
</section>`,
  },

  footer: {
    name: 'Footer 3-column',
    description: 'Business name + tagline left, quick links middle, contact right. Copyright bottom.',
    slots: ['home', 'about', 'services'],
    html: `<footer style="padding:70px 32px 40px;background:var(--bg);border-top:1px solid color-mix(in srgb, var(--text) 10%, transparent);">
  <div style="max-width:1280px;margin:0 auto;">
    <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:60px;margin-bottom:50px;">
      <div>
        <div style="font-family:var(--font-display);font-weight:700;font-size:22px;letter-spacing:-0.02em;color:var(--text);margin-bottom:14px;">{{BUSINESS_NAME}}</div>
        <p style="color:var(--text-muted);font-size:15px;line-height:1.6;margin:0;max-width:340px;">{{FOOTER_TAGLINE}}</p>
      </div>
      <div>
        <div style="color:var(--text);font-weight:700;font-size:14px;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:18px;">Navigering</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a href="index.html" style="color:var(--text-muted);text-decoration:none;font-size:15px;">Hem</a>
          <a href="om-oss.html" style="color:var(--text-muted);text-decoration:none;font-size:15px;">Om oss</a>
          <a href="tjanster.html" style="color:var(--text-muted);text-decoration:none;font-size:15px;">Tjänster</a>
          <a href="index.html#kontakt" style="color:var(--text-muted);text-decoration:none;font-size:15px;">Kontakt</a>
        </div>
      </div>
      <div>
        <div style="color:var(--text);font-weight:700;font-size:14px;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:18px;">Kontakt</div>
        <div style="display:flex;flex-direction:column;gap:10px;color:var(--text-muted);font-size:15px;line-height:1.6;">{{FOOTER_CONTACT}}</div>
      </div>
    </div>
    <div style="padding-top:30px;border-top:1px solid color-mix(in srgb, var(--text) 8%, transparent);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;color:var(--text-muted);font-size:13px;">
      <div>© {{YEAR}} {{BUSINESS_NAME}}. Alla rättigheter förbehållna.</div>
      <div style="opacity:.7;">Demo skapad av Botlio</div>
    </div>
  </div>
  <style>@media (max-width: 800px){footer > div > div:first-child{grid-template-columns:1fr !important;gap:36px !important;}}</style>
</footer>`,
  },
}

const GENERATION_TEMPLATE_IDS = [
  'nav_sticky',
  'hero_fullbleed',
  'page_header',
  'services_grid_3col',
  'services_bento',
  'process_timeline',
  'gallery_masonry',
  'about_split',
  'values_grid',
  'faq_accordion',
  'cta_band',
  'contact_split',
  'contact_centered',
  'footer',
] as const

function compactTemplateHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim()
}

export function buildLibraryPrompt(): string {
  const entries = GENERATION_TEMPLATE_IDS.map((id) => {
    const s = SECTION_LIBRARY[id]
    return `### ${id}\n${s.name} — ${s.description}\nPassar: ${s.slots.join(', ')}\n\`\`\`html\n${compactTemplateHtml(s.html)}\n\`\`\``
  })
  return entries.join('\n---\n')
}

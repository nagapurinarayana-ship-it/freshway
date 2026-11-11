import { test, expect } from '@playwright/test';

const searches = [
  { id: 'domain', query: 'site:fwcoldpressed.in' },
  { id: 'brand-mancherial', query: 'FreshWay Mancherial' },
  { id: 'oils-mancherial', query: 'FreshWay cold pressed Mancherial' },
  { id: 'brand-oils-rice', query: 'FreshWay oils and rice' }
];

test('Google search evidence capture for FreshWay (blocked searches are not ranking evidence)', async ({ page }) => {
  test.skip(process.env.FRESHWAY_GOOGLE_SEARCH_AUDIT !== '1', 'Run manually with npm run test:seo-google');
  test.setTimeout(240_000);
  const audit = [];

  for (const search of searches) {
    const record = { id: search.id, query: search.query, status: 'not-run', results: [] };
    try {
      const url = 'https://www.google.com/search?hl=en&gl=in&q=' + encodeURIComponent(search.query);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35_000 });
      record.httpStatus = response?.status() ?? null;
      record.finalUrl = page.url();

      const body = await page.locator('body').innerText({ timeout: 12_000 }).catch(() => '');
      record.challengeOrConsent = /unusual traffic|not a robot|before you continue|consent\.google\.com/i.test(
        record.finalUrl + '\n' + body.slice(0, 3000)
      );

      record.results = await page.locator('#search a[href]').evaluateAll(anchors =>
        anchors.map(anchor => {
          const heading = anchor.querySelector('h3');
          if (!heading) return null;
          const href = anchor.href || '';
          const wrapper = (() => {
            try {
              const parsed = new URL(href);
              if (parsed.hostname.endsWith('google.com')) {
                return parsed.searchParams.get('q') || parsed.searchParams.get('url') || href;
              }
              return href;
            } catch { return href; }
          })();
          return {
            title: (heading.innerText || '').trim(),
            url: wrapper,
            snippet: (anchor.closest('div.MjjYud')?.innerText || anchor.parentElement?.parentElement?.innerText || '').trim().slice(0, 450)
          };
        }).filter(Boolean).slice(0, 10)
      );
      record.freshwayDomainFound = record.results.some(item => {
        try { return new URL(item.url).hostname === 'fwcoldpressed.in' || new URL(item.url).hostname.endsWith('.fwcoldpressed.in'); }
        catch { return false; }
      });
      record.status = record.challengeOrConsent ? 'blocked-or-consent-required' : 'captured';
      record.pageTitle = await page.title();
    } catch (error) {
      record.status = 'navigation-or-capture-error';
      record.error = String(error?.message || error);
    }
    audit.push(record);
  }

  await test.info().attach('freshway-google-search-visibility.json', {
    body: Buffer.from(JSON.stringify(audit, null, 2)),
    contentType: 'application/json'
  });

  // This captures live SERP evidence only. A Google challenge/consent page means
  // visibility is unknown; it must never be reported as a zero-result ranking verdict.
  expect(audit).toHaveLength(searches.length);
  console.log('FreshWay Google visibility audit:', JSON.stringify(audit, null, 2));
});

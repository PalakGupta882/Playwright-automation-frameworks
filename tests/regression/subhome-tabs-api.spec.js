// tests/regression/subhome-tabs-api.spec.js
//
// E2E-NAV-01..06 and E2E-SEC-01..11 — the public app endpoints behind the Sub
// Home Page tab strip. Both are public storefront reads (E2E-SEC-11), so this
// file runs logged out and qualifies for the CI public list.
//
// Measured on production 19 Aug 2026, and every number below came from there:
//
//   GET /apps/home-page/nav                       20 home pages, one carries tabs
//     Home: 8 tabs, sequence 1,2,3,4,5,6,7,9      <- gap at 8
//   GET /apps/home-page/sections?home_page_id=…    71 sections, eager 3
//                             &sub_home_page_id=A  29 sections
//                             &sub_home_page_id=B   9 sections
//                             &sub_home_page_id=<random uuid>   200, 0 sections
//
// NOTHING HERE ASSERTS A TAB NAME. The sheet's fixtures ("Laptop", "5G Phones")
// are a developer machine's data. What is asserted is the contract: which
// fields exist, how they are ordered, and that filtering actually filters.

const { test, expect } = require('../fixtures/pageFixtures');
const {
  navPath,
  sectionsPath,
  unwrap,
  tabsOf,
  inDisplayOrder,
  pageWithTabs,
} = require('../data/subHomeFeature');

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Sub home page tabs — app API', () => {
  let nav;
  let host;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(navPath());
    expect(res.status(), 'the public nav endpoint must answer').toBe(200);
    nav = unwrap(await res.json());
    host = pageWithTabs(nav);
    console.log(
      `nav: ${nav.length} home pages; ` +
        `${nav.filter((p) => tabsOf(p).length).length} carry tabs` +
        (host ? ` — "${host.name}" has ${tabsOf(host).length}` : '')
    );
  });

  // ---- E2E-NAV ---------------------------------------------------------

  test('E2E-NAV-01: every home page carries a tab list, and each tab exposes its full record', () => {
    expect(Array.isArray(nav), 'nav did not return an array').toBe(true);
    expect(nav.length, 'nav returned no home pages').toBeGreaterThan(0);

    // Non-vacuous: prove at least one page actually has tabs before checking
    // the shape of a tab, or this passes on a catalogue with none.
    expect(host, 'no home page carries any sub_home_pages — nothing to check').toBeTruthy();

    const required = ['id', 'name', 'slug', 'sequence', 'entity_type', 'entity_id', 'icon_url'];
    const missing = [];
    for (const tab of tabsOf(host)) {
      for (const field of required) {
        if (!(field in tab)) missing.push(`${host.name}/${tab.name} is missing ${field}`);
      }
    }
    expect(missing, 'tabs in the app nav are missing contract fields').toEqual([]);
  });

  test('E2E-NAV-02: the pre-existing home page fields are unchanged', () => {
    // The tab list is an addition. Existing app builds read these fields and
    // must keep working, so this is the regression half of the contract.
    const broken = nav
      .filter((p) => !['id', 'name', 'slug', 'sequence'].every((f) => f in p))
      .map((p) => `${p.name || p.id}: missing one of id/name/slug/sequence`);
    expect(broken, 'the nav response dropped or renamed an original field').toEqual([]);

    const badTypes = nav
      .filter((p) => typeof p.name !== 'string' || typeof p.slug !== 'string')
      .map((p) => `${p.id}: name=${typeof p.name} slug=${typeof p.slug}`);
    expect(badTypes, 'an original nav field changed type').toEqual([]);
  });

  test('E2E-NAV-03: a home page with no tabs returns an empty list, never null', () => {
    const withoutTabs = nav.filter((p) => tabsOf(p).length === 0);
    expect(
      withoutTabs.length,
      'every home page has tabs, so the empty case is unproven here'
    ).toBeGreaterThan(0);

    const nulls = withoutTabs
      .filter((p) => p.sub_home_pages === null || p.sub_home_pages === undefined)
      .map((p) => `${p.name}: sub_home_pages is ${p.sub_home_pages === null ? 'null' : 'absent'}`);

    console.log(
      `${withoutTabs.length} home pages carry no tabs: ${withoutTabs.map((p) => p.name).join(', ')}`
    );
    expect(nulls, 'a tab-less home page must send [] — the app must not have to null-check').toEqual([]);
  });

  test('E2E-NAV-04: tabs arrive in display order and none is marked inactive', () => {
    const tabs = tabsOf(host);
    const actual = tabs.map((t) => `${t.sequence}:${t.name}`);
    const expected = inDisplayOrder(tabs).map((t) => `${t.sequence}:${t.name}`);
    expect(actual, `${host.name} tabs are not in sequence order`).toEqual(expected);

    // PARTIAL, and deliberately so. Proving that a deactive or deleted tab is
    // EXCLUDED means creating one, which needs the admin API. What is provable
    // from here is the standing invariant: nothing the app is given is inactive.
    const inactive = tabs
      .filter((t) => String(t.status || '').toLowerCase() === 'deactive' || t.deleted_at)
      .map((t) => `${t.name} status=${t.status} deleted_at=${t.deleted_at}`);
    expect(inactive, 'the app nav is serving a deactive or deleted tab').toEqual([]);

    const sequences = tabs.map((t) => t.sequence);
    console.log(
      `sequences served: ${sequences.join(', ')}` +
        (Math.max(...sequences) > sequences.length
          ? ' — the gap is consistent with a hidden tab, which is the expected behaviour'
          : '')
    );
  });

  test('E2E-NAV-05: page_type still filters, and filtered pages keep their tabs', async ({ request }) => {
    const res = await request.get(navPath('home'));
    expect(res.status()).toBe(200);
    const filtered = unwrap(await res.json());

    expect(filtered.length, 'page_type=home returned nothing').toBeGreaterThan(0);
    expect(
      filtered.length,
      'page_type=home returned as much as the unfiltered call — the filter did nothing'
    ).toBeLessThan(nav.length);

    const stillCarriesTabs = pageWithTabs(filtered);
    expect(
      stillCarriesTabs,
      'the filtered nav lost its tab lists — filtering must not strip sub_home_pages'
    ).toBeTruthy();
    console.log(
      `page_type=home: ${filtered.length} of ${nav.length} pages; ` +
        `"${stillCarriesTabs.name}" still carries ${tabsOf(stillCarriesTabs).length} tabs`
    );
  });

  test('E2E-NAV-06: the nav is not served from a stale cache', async ({ request }) => {
    // The sheet's version creates a tab and re-reads it. Without admin access,
    // what is checkable is the weaker half that still catches the reported
    // failure mode: two reads a moment apart must agree, and the response must
    // not ask the client to hold it for minutes.
    const a = await request.get(navPath());
    const b = await request.get(navPath());
    expect(JSON.stringify(unwrap(await a.json())), 'two immediate nav reads disagree').toBe(
      JSON.stringify(unwrap(await b.json()))
    );

    const cacheControl = b.headers()['cache-control'] || '';
    const maxAge = Number((cacheControl.match(/max-age=(\d+)/) || [])[1] || 0);
    console.log(`nav cache-control: "${cacheControl || 'absent'}" (max-age ${maxAge}s)`);
    expect(
      maxAge,
      'the nav is cached for over a minute, so a newly created tab would not appear promptly'
    ).toBeLessThanOrEqual(60);
  });

  // ---- E2E-SEC ---------------------------------------------------------

  test.describe('sections', () => {
    let unfiltered;

    test.beforeAll(async ({ request }) => {
      const res = await request.get(sectionsPath({ home_page_id: host.id }));
      expect(res.status()).toBe(200);
      unfiltered = unwrap(await res.json());
      console.log(
        `unfiltered: ${unfiltered.sections.length} sections, ${unfiltered.eager.length} pre-loaded`
      );
    });

    test('E2E-SEC-01: the page still returns all its sections when no tab is selected', () => {
      expect(Array.isArray(unfiltered.sections), 'sections is not an array').toBe(true);
      expect(unfiltered.sections.length, 'the home page returned no sections at all').toBeGreaterThan(0);
      expect(unfiltered.home_page_id, 'the response does not name the page it answered for').toBe(host.id);
    });

    test('E2E-SEC-02: selecting a tab returns only that tab own sections', async ({ request }) => {
      const tabs = tabsOf(host);
      expect(tabs.length, 'need two tabs to prove filtering').toBeGreaterThan(1);

      const counts = [];
      for (const tab of tabs.slice(0, 2)) {
        const res = await request.get(
          sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id })
        );
        expect(res.status()).toBe(200);
        const body = unwrap(await res.json());
        counts.push({ name: tab.name, count: body.sections.length, ids: body.sections.map((s) => s.id) });
      }
      console.log(counts.map((c) => `${c.name}: ${c.count}`).join(' · '));

      for (const c of counts) {
        expect(
          c.count,
          `${c.name} returned more sections than the unfiltered page — that is not a filter`
        ).toBeLessThanOrEqual(unfiltered.sections.length);
      }

      // If both tabs answer with the same section ids the filter is
      // indistinguishable from no filter, and saying so beats a green tick.
      const [a, b] = counts;
      const identical = JSON.stringify(a.ids) === JSON.stringify(b.ids);
      expect(
        identical,
        `${a.name} and ${b.name} return the same sections, so this check cannot tell ` +
          'the two tabs apart and proves nothing about filtering'
      ).toBe(false);
    });

    test('E2E-SEC-03: both the section list and the pre-loaded list respect the tab', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const res = await request.get(
        sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id, eager: 5 })
      );
      const body = unwrap(await res.json());

      // The two lists are built by separate queries, so both must be filtered.
      const listed = new Set(body.sections.map((s) => s.id));
      const strays = body.eager.filter((s) => !listed.has(s.id)).map((s) => `${s.id} (${s.heading})`);
      expect(
        strays,
        'a pre-loaded section is not in this tab own section list — the eager query is unfiltered'
      ).toEqual([]);
      console.log(`${tab.name}: ${body.sections.length} listed, ${body.eager.length} pre-loaded, 0 strays`);
    });

    test('E2E-SEC-04: eager controls how many sections arrive pre-loaded, capped at five', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const read = async (eager) => {
        const res = await request.get(
          sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id, eager })
        );
        return unwrap(await res.json()).eager.length;
      };

      const omitted = await read(undefined);
      const zero = await read(0);
      const five = await read(5);
      const ninetyNine = await read(99);
      console.log(`eager omitted=${omitted} · 0=${zero} · 5=${five} · 99=${ninetyNine}`);

      expect(zero, 'eager=0 still pre-loaded sections').toBe(0);
      expect(omitted, 'omitting eager should pre-load three').toBe(3);
      expect(five, 'eager=5 did not pre-load five').toBe(5);
      expect(ninetyNine, 'eager=99 was not capped at five').toBe(5);
    });

    test('E2E-SEC-05: an unknown tab id resolves to an empty page, not an error', async ({ request }) => {
      const res = await request.get(
        sectionsPath({
          home_page_id: host.id,
          sub_home_page_id: '00000000-0000-0000-0000-000000000000',
        })
      );
      // 200-with-nothing on purpose: the app shows an empty tab rather than a
      // failure screen.
      expect(res.status(), 'an unknown tab must not error the page').toBe(200);
      const body = unwrap(await res.json());
      expect(body.sections, 'an unknown tab returned sections').toEqual([]);
      expect(body.eager, 'an unknown tab pre-loaded sections').toEqual([]);
    });

    test('E2E-SEC-06: unpublished and deactive sections stay hidden inside a tab', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const body = unwrap(
        await (
          await request.get(sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id }))
        ).json()
      );

      const shouldBeHidden = body.sections
        .filter(
          (s) =>
            String(s.status || '').toLowerCase() === 'deactive' ||
            s.sequence === null ||
            s.sequence === undefined
        )
        .map((s) => `${s.heading || s.id}: status=${s.status} sequence=${s.sequence}`);

      expect(
        shouldBeHidden,
        'the tab is serving a section that is unpublished (no sequence) or deactive'
      ).toEqual([]);
    });

    test('E2E-SEC-07: platform targeting applies on top of the tab filter', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const read = async (platform) => {
        const body = unwrap(
          await (
            await request.get(
              sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id, platform })
            )
          ).json()
        );
        return body.sections.map((s) => s.id);
      };

      const untargeted = await read(undefined);
      const mobile = await read('mobile');
      const desktop = await read('desktop');
      console.log(
        `${tab.name}: untargeted=${untargeted.length} mobile=${mobile.length} desktop=${desktop.length}`
      );

      expect(
        mobile.length,
        'platform=mobile returned more than the untargeted call'
      ).toBeLessThanOrEqual(untargeted.length);
      expect(
        desktop.length,
        'platform=desktop returned more than the untargeted call'
      ).toBeLessThanOrEqual(untargeted.length);

      // Measured 19 Aug: mobile and desktop return the same 28 of 29. Say so
      // rather than letting the assertion above read as proof of targeting.
      console.log(
        JSON.stringify(mobile) === JSON.stringify(desktop)
          ? 'NOTE: mobile and desktop return an identical set on this tab, so this check ' +
              'cannot show which sections are platform-targeted. It proves the parameter ' +
              'is accepted and narrows the set, no more.'
          : `platform targeting is visible: ${mobile.filter((id) => !desktop.includes(id)).length} ` +
              `mobile-only and ${desktop.filter((id) => !mobile.includes(id)).length} desktop-only section(s)`
      );
    });

    test('E2E-SEC-08: a tab can be opened by home page slug as well as id', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const byId = unwrap(
        await (
          await request.get(sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id }))
        ).json()
      );
      const bySlug = unwrap(
        await (
          await request.get(sectionsPath({ home_page_slug: host.slug, sub_home_page_id: tab.id }))
        ).json()
      );

      expect(
        bySlug.sections.map((s) => s.id),
        'opening by slug returned a different set of sections than opening by id'
      ).toEqual(byId.sections.map((s) => s.id));
    });

    test('E2E-SEC-09: delivery pincode is honoured on tiles inside a tab', async ({ request }) => {
      const tab = tabsOf(host)[0];
      const read = async (pincode) => {
        const res = await request.get(
          sectionsPath({ home_page_id: host.id, sub_home_page_id: tab.id, eager: 5 }),
          { headers: { 'x-delivery-pincode': pincode } }
        );
        expect(res.status(), `sections rejected pincode ${pincode}`).toBe(200);
        return unwrap(await res.json());
      };

      const a = await read('110001');
      const b = await read('560001');
      expect(a.eager.length, 'no sections pre-loaded, so there are no tiles to price').toBeGreaterThan(0);
      expect(
        b.eager.length,
        'the two pincodes returned a different number of pre-loaded sections'
      ).toBe(a.eager.length);

      // Pricing itself is owned by the main API and zeros are expected where no
      // pricing row exists, so this asserts the header is accepted and the
      // payload survives it — not a price value.
      console.log(`pincode 110001 and 560001 both return ${a.eager.length} pre-loaded sections`);
    });

    test('E2E-SEC-10: a tab that deep-links to an entity carries a resolvable target', () => {
      const linked = tabsOf(host).filter((t) => t.entity_type && t.entity_type !== 'none');
      const plain = tabsOf(host).filter((t) => !t.entity_type || t.entity_type === 'none');

      expect(linked.length + plain.length, 'no tabs to classify').toBeGreaterThan(0);

      const broken = linked
        .filter((t) => !t.entity_id)
        .map((t) => `${t.name}: entity_type=${t.entity_type} but entity_id is ${t.entity_id}`);
      expect(broken, 'a tab names an entity type with no id to resolve').toEqual([]);

      const dangling = plain
        .filter((t) => t.entity_id)
        .map((t) => `${t.name}: entity_type=none but entity_id=${t.entity_id}`);
      expect(dangling, 'a plain tab still carries an entity id').toEqual([]);

      console.log(
        `${linked.length} deep-link tabs (${linked.map((t) => `${t.name}->${t.entity_type}`).join(', ')}) · ` +
          `${plain.length} plain`
      );
    });

    test('E2E-SEC-11: nav and sections are reachable without signing in', async ({ request }) => {
      // The file already runs with an empty storageState; the point of the case
      // is the explicit statement that both must answer 200 anonymously.
      const navRes = await request.get(navPath());
      const secRes = await request.get(sectionsPath({ home_page_id: host.id }));
      expect(navRes.status(), 'nav is not public').toBe(200);
      expect(secRes.status(), 'sections is not public').toBe(200);
    });
  });
});

// tests/regression/subhome-admin-api.spec.js
//
// E2E-SHP-CREATE-01..10, LIST-01..04, GET-01..03, UPDATE-01..08,
// DELETE-01..05, AUTH-01..02 — the admin API behind the Sub Home Page tabs.
//
// THREE GATES, all deliberate.
//
//   1. BYTEPE_SUBHOME_ADMIN_URL + BYTEPE_ADMIN_JWT, or the whole file skips.
//      The sheet's own base URL is http://localhost:6009/v1/product-service —
//      a developer machine — so there is nothing to default to.
//   2. BYTEPE_ALLOW_WRITES=1 for anything that creates, edits or deletes.
//   3. productionGuard(): pointing this at www.bytepe.com is an ERROR, not a
//      skip. These endpoints rewrite the tab strip every shopper sees on the
//      homepage. A missing token is an accident; a production host is a
//      decision, and it is the wrong one.
//
// Also needs a home page that is safe to add and remove tabs on:
//   BYTEPE_TEST_HOME_PAGE_ID       — the parent for every created tab
//   BYTEPE_TEST_HOME_PAGE_ID_ALT   — a second page, for the ownership cases
//
// Routes and status codes come from the sheet and have NOT been executed
// against a live service. Expect to adjust envelope field names on first run —
// the same caveat video-admin-api.spec.js carried, and it proved accurate.

const { test, expect } = require('../fixtures/pageFixtures');
const {
  adminApi,
  adminConfigured,
  productionGuard,
  ADMIN_SKIP_REASON,
  WRITE_SKIP_REASON,
  NO_HOME_PAGE_REASON,
  NO_SECOND_PAGE_REASON,
  unwrap,
} = require('../data/subHomeFeature');

test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: adminApi.token
    ? { Authorization: `Bearer ${adminApi.token}`, accept: 'application/json' }
    : { accept: 'application/json' },
});

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const tabsUrl = (homePageId) =>
  `${adminApi.baseUrl}/collections/home-pages/${homePageId}/sub-home-pages`;
const tabUrl = (homePageId, tabId) => `${tabsUrl(homePageId)}/${tabId}`;

// Unique per run so a re-run never trips the global slug uniqueness rule.
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.describe('Sub home page admin API', () => {
  test.skip(!adminConfigured(), ADMIN_SKIP_REASON);
  test.beforeAll(() => productionGuard());

  const HOME = adminApi.homePageId;
  const OTHER = adminApi.otherHomePageId;
  const created = [];

  async function createTab(request, overrides = {}, homePageId = HOME) {
    const payload = {
      name: `automation-${stamp()}`,
      slug: `automation-${stamp()}`,
      sequence: 1,
      status: 'active',
      entityType: 'none',
      ...overrides,
    };
    const res = await request.post(tabsUrl(homePageId), { data: payload, failOnStatusCode: false });
    const body = res.status() < 300 ? unwrap(await res.json()) : null;
    if (body && body.id) created.push({ id: body.id, homePageId });
    return { res, payload, body };
  }

  // Leave nothing behind. Delete failures are logged, not thrown: a cleanup
  // error must not mask the result of the test that ran before it.
  test.afterAll(async ({ request }) => {
    for (const t of created) {
      const res = await request.delete(tabUrl(t.homePageId, t.id), { failOnStatusCode: false });
      if (res.status() >= 300) console.log(`cleanup: tab ${t.id} left behind (${res.status()})`);
    }
  });

  // ---- Create ----------------------------------------------------------

  test.describe('create', () => {
    test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
    test.skip(!adminApi.homePageId, NO_HOME_PAGE_REASON);

    test('E2E-SHP-CREATE-01: a tab is created under the home page named in the URL', async ({ request }) => {
      const { res, body } = await createTab(request, { name: '5G Phones', slug: `5g-phones-${stamp()}` });
      expect(res.status(), 'create did not return 201').toBe(201);
      expect(body.homePageId || body.home_page_id, 'the tab was parented to a different page').toBe(HOME);
      expect(body.entityId ?? body.entity_id, 'a plain tab was given an entity id').toBeNull();
      expect(body.entityType ?? body.entity_type, 'a plain tab is not entityType none').toBe('none');
    });

    test('E2E-SHP-CREATE-02: homePageId in the body is rejected outright', async ({ request }) => {
      const res = await request.post(tabsUrl(HOME), {
        data: { name: 'X', slug: `x-${stamp()}`, homePageId: NIL_UUID },
        failOnStatusCode: false,
      });
      expect(res.status(), 'the body was allowed to name a parent page').toBe(400);
      expect(JSON.stringify(await res.json()), 'the rejection does not name the offending property').toMatch(
        /homePageId should not exist/i
      );
    });

    test('E2E-SHP-CREATE-03 / 04: a tab can deep-link to each entity type', async ({ request }) => {
      const entityId = process.env.BYTEPE_TEST_MASTER_CATEGORY_ID;
      test.skip(!entityId, 'Set BYTEPE_TEST_MASTER_CATEGORY_ID to a real master category id');

      const { res, body } = await createTab(request, {
        name: 'Electronics',
        slug: `electronics-${stamp()}`,
        sequence: 2,
        entityType: 'master_category',
        entityId,
      });
      expect(res.status()).toBe(201);
      expect(body.entityType ?? body.entity_type).toBe('master_category');
      expect(body.entityId ?? body.entity_id, 'the supplied entity id was not stored').toBe(entityId);
    });

    test('E2E-SHP-CREATE-05: an entity tab without an entity id is refused', async ({ request }) => {
      const res = await request.post(tabsUrl(HOME), {
        data: { name: 'Bad', slug: `bad-${stamp()}`, entityType: 'brand' },
        failOnStatusCode: false,
      });
      expect(res.status(), 'a brand tab was accepted with no brand to point at').toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/entityId is required/i);
    });

    test('E2E-SHP-CREATE-06: an entity id that does not exist is refused', async ({ request }) => {
      const res = await request.post(tabsUrl(HOME), {
        data: { name: 'Bad', slug: `bad-${stamp()}`, entityType: 'category', entityId: NIL_UUID },
        failOnStatusCode: false,
      });
      expect(res.status(), 'a tab was created pointing at a category that does not exist').toBe(404);
    });

    test('E2E-SHP-CREATE-07: creating under a home page that does not exist', async ({ request }) => {
      const res = await request.post(tabsUrl(NIL_UUID), {
        data: { name: 'Orphan', slug: `orphan-${stamp()}` },
        failOnStatusCode: false,
      });
      expect(res.status(), 'the parent page was not checked before writing').toBe(404);
    });

    test('E2E-SHP-CREATE-08: slug uniqueness is global, not per home page', async ({ request }) => {
      const slug = `dupe-${stamp()}`;
      const first = await createTab(request, { slug });
      expect(first.res.status(), 'the first create failed, so the conflict case cannot run').toBe(201);

      const sameParent = await request.post(tabsUrl(HOME), {
        data: { name: 'Dupe', slug },
        failOnStatusCode: false,
      });
      expect(sameParent.status(), 'a duplicate slug was accepted under the same page').toBe(409);

      test.skip(!OTHER, NO_SECOND_PAGE_REASON);
      const otherParent = await request.post(tabsUrl(OTHER), {
        data: { name: 'Dupe', slug },
        failOnStatusCode: false,
      });
      expect(
        otherParent.status(),
        'a duplicate slug was accepted under a different page — uniqueness is only per parent'
      ).toBe(409);
    });

    test('E2E-SHP-CREATE-09: optional fields fall back to defaults', async ({ request }) => {
      const res = await request.post(tabsUrl(HOME), {
        data: { name: 'Minimal', slug: `minimal-${stamp()}` },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(201);
      const body = unwrap(await res.json());
      if (body.id) created.push({ id: body.id, homePageId: HOME });

      expect(body.sequence, 'sequence did not default to 0').toBe(0);
      expect(body.status, 'status did not default to active').toBe('active');
      expect(body.entityId ?? body.entity_id, 'entityId did not default to null').toBeNull();
      expect(body.iconUrl ?? body.icon_url, 'iconUrl did not default to null').toBeNull();
    });

    test('E2E-SHP-CREATE-10: field-level validation names the offending field', async ({ request }) => {
      const cases = [
        { label: 'no name', data: { slug: `v-${stamp()}` }, field: /name/i },
        { label: 'name over 255', data: { name: 'a'.repeat(256), slug: `v-${stamp()}` }, field: /name/i },
        { label: 'slug over 280', data: { name: 'v', slug: 'a'.repeat(281) }, field: /slug/i },
        { label: 'bad status', data: { name: 'v', slug: `v-${stamp()}`, status: 'foo' }, field: /status/i },
        { label: 'bad entityType', data: { name: 'v', slug: `v-${stamp()}`, entityType: 'foo' }, field: /entityType|entity_type/i },
      ];

      const wrong = [];
      for (const c of cases) {
        const res = await request.post(tabsUrl(HOME), { data: c.data, failOnStatusCode: false });
        const text = await res.text();
        if (res.status() !== 400) wrong.push(`${c.label}: got ${res.status()}, expected 400`);
        else if (!c.field.test(text)) wrong.push(`${c.label}: 400 but the message never names the field — ${text.slice(0, 120)}`);
      }
      expect(wrong, 'the create payload is not validated field by field').toEqual([]);
    });
  });

  // ---- List and get ----------------------------------------------------

  test.describe('read', () => {
    test.skip(!adminApi.homePageId, NO_HOME_PAGE_REASON);

    test('E2E-SHP-LIST-01: tabs of one page come back in display order', async ({ request }) => {
      const res = await request.get(tabsUrl(HOME), { failOnStatusCode: false });
      expect(res.status()).toBe(200);
      const list = unwrap(await res.json());

      expect(Array.isArray(list), 'the list is paginated — the sheet expects a plain array').toBe(true);

      const sorted = [...list].sort((a, b) =>
        a.sequence === b.sequence ? String(a.name).localeCompare(String(b.name)) : a.sequence - b.sequence
      );
      expect(
        list.map((t) => t.id),
        'the tab list is not sorted by sequence then name'
      ).toEqual(sorted.map((t) => t.id));

      const foreign = list
        .filter((t) => (t.homePageId ?? t.home_page_id) !== HOME)
        .map((t) => `${t.name} belongs to ${t.homePageId ?? t.home_page_id}`);
      expect(foreign, 'the list contains a tab from another home page').toEqual([]);
    });

    test('E2E-SHP-LIST-02: the list can be filtered by status', async ({ request }) => {
      const [active, deactive, all] = await Promise.all(
        ['active', 'deactive', ''].map((status) =>
          request.get(`${tabsUrl(HOME)}${status ? `?status=${status}` : ''}`, { failOnStatusCode: false })
        )
      );
      const [a, d, everything] = await Promise.all([active, deactive, all].map(async (r) => unwrap(await r.json())));

      console.log(`active=${a.length} deactive=${d.length} unfiltered=${everything.length}`);
      expect(a.every((t) => t.status === 'active'), 'status=active returned a non-active tab').toBe(true);
      expect(d.every((t) => t.status === 'deactive'), 'status=deactive returned an active tab').toBe(true);
      expect(everything.length, 'the unfiltered list is smaller than its own subsets').toBeGreaterThanOrEqual(
        a.length + d.length
      );
    });

    test('E2E-SHP-LIST-03: listing tabs of a page that does not exist is a 404, not an empty list', async ({ request }) => {
      const res = await request.get(tabsUrl(NIL_UUID), { failOnStatusCode: false });
      // Deliberately not 200-with-[]: an admin deep-linking a deleted page must
      // not be shown an "Add tab" screen that fails on submit.
      expect(res.status(), 'a deleted parent page answered as if it were empty').toBe(404);
    });

    test('E2E-SHP-GET-01: a single tab reads back with its parent', async ({ request }) => {
      const list = unwrap(await (await request.get(tabsUrl(HOME))).json());
      test.skip(list.length === 0, 'the home page has no tabs to read');

      const res = await request.get(tabUrl(HOME, list[0].id), { failOnStatusCode: false });
      expect(res.status()).toBe(200);
      const tab = unwrap(await res.json());
      expect(tab.homePageId ?? tab.home_page_id, 'the record names a different parent than the URL').toBe(HOME);
    });

    test('E2E-SHP-GET-03: malformed ids are rejected before any lookup', async ({ request }) => {
      const badParent = await request.get(`${adminApi.baseUrl}/collections/home-pages/abc/sub-home-pages/${NIL_UUID}`, {
        failOnStatusCode: false,
      });
      const badChild = await request.get(tabUrl(HOME, 'abc'), { failOnStatusCode: false });
      expect(badParent.status(), 'a non-uuid home page id was not rejected').toBe(400);
      expect(badChild.status(), 'a non-uuid tab id was not rejected').toBe(400);
    });
  });

  // ---- Update ----------------------------------------------------------

  test.describe('update', () => {
    test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
    test.skip(!adminApi.homePageId, NO_HOME_PAGE_REASON);

    test('E2E-SHP-UPDATE-01: editing one field leaves the rest untouched', async ({ request }) => {
      const { body } = await createTab(request, { sequence: 1, status: 'active' });
      const res = await request.put(tabUrl(HOME, body.id), {
        data: { name: `${body.name} (Updated)`, sequence: 2 },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(200);

      const after = unwrap(await (await request.get(tabUrl(HOME, body.id))).json());
      expect(after.name, 'name did not change').toBe(`${body.name} (Updated)`);
      expect(after.sequence, 'sequence did not change').toBe(2);
      expect(after.slug, 'slug was overwritten by a partial update').toBe(body.slug);
      expect(after.status, 'status was overwritten by a partial update').toBe(body.status);
    });

    test('E2E-SHP-UPDATE-02: a tab cannot be re-parented', async ({ request }) => {
      const { body } = await createTab(request);
      const res = await request.put(tabUrl(HOME, body.id), {
        data: { homePageId: OTHER || NIL_UUID },
        failOnStatusCode: false,
      });
      expect(res.status(), 'a tab was allowed to move to another home page').toBe(400);
    });

    test('E2E-SHP-UPDATE-03 / 04: entity link can be set and cleared', async ({ request }) => {
      const entityId = process.env.BYTEPE_TEST_MASTER_CATEGORY_ID;
      test.skip(!entityId, 'Set BYTEPE_TEST_MASTER_CATEGORY_ID to a real master category id');

      const { body } = await createTab(request);
      const linked = await request.put(tabUrl(HOME, body.id), {
        data: { entityType: 'master_category', entityId },
        failOnStatusCode: false,
      });
      expect(linked.status(), 'a plain tab could not be turned into a deep link').toBe(200);
      expect(unwrap(await linked.json()).entityId ?? unwrap(await linked.json()).entity_id).toBe(entityId);

      const cleared = await request.put(tabUrl(HOME, body.id), {
        data: { entityType: 'none' },
        failOnStatusCode: false,
      });
      expect(cleared.status()).toBe(200);
      const after = unwrap(await (await request.get(tabUrl(HOME, body.id))).json());
      expect(after.entityId ?? after.entity_id, 'switching back to none left the entity id behind').toBeNull();
    });

    test('E2E-SHP-UPDATE-05: switching entity type with no id is refused', async ({ request }) => {
      const { body } = await createTab(request);
      const res = await request.put(tabUrl(HOME, body.id), {
        data: { entityType: 'brand' },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/entityId is required/i);
    });

    test('E2E-SHP-UPDATE-06 / 07: slug conflicts, but not with itself', async ({ request }) => {
      const a = await createTab(request);
      const b = await createTab(request);

      const conflict = await request.put(tabUrl(HOME, a.body.id), {
        data: { slug: b.payload.slug },
        failOnStatusCode: false,
      });
      expect(conflict.status(), 'a tab took another tab slug').toBe(409);

      const selfSave = await request.put(tabUrl(HOME, a.body.id), {
        data: { slug: a.payload.slug },
        failOnStatusCode: false,
      });
      expect(
        selfSave.status(),
        're-saving a tab with its own unchanged slug reported a false conflict'
      ).toBe(200);
    });

    test('E2E-SHP-UPDATE-08 / GET-02: a tab cannot be reached through the wrong home page', async ({ request }) => {
      test.skip(!OTHER, NO_SECOND_PAGE_REASON);
      const { body } = await createTab(request);

      const read = await request.get(tabUrl(OTHER, body.id), { failOnStatusCode: false });
      expect(read.status(), 'a tab leaked through another home page — cross-parent data leak').toBe(404);

      const write = await request.put(tabUrl(OTHER, body.id), {
        data: { name: 'Hijack' },
        failOnStatusCode: false,
      });
      expect(write.status(), 'a tab was editable through another home page').toBe(404);

      const after = unwrap(await (await request.get(tabUrl(HOME, body.id))).json());
      expect(after.name, 'the tab was modified through the wrong parent').toBe(body.name);
    });
  });

  // ---- Delete ----------------------------------------------------------

  test.describe('delete', () => {
    test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
    test.skip(!adminApi.homePageId, NO_HOME_PAGE_REASON);

    test('E2E-SHP-DELETE-01: deleting a tab with no sections is a soft delete', async ({ request }) => {
      const { body } = await createTab(request);
      const res = await request.delete(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(res.status()).toBe(200);
      expect(unwrap(await res.json()).id, 'delete did not return the id it removed').toBe(body.id);

      // E2E-SHP-LIST-04: gone from the list.
      const list = unwrap(await (await request.get(tabsUrl(HOME))).json());
      expect(
        list.map((t) => t.id),
        'a deleted tab is still in the list'
      ).not.toContain(body.id);
    });

    test('E2E-SHP-DELETE-02 / 03: a tab holding sections cannot be deleted until they are detached', async ({ request }) => {
      const collectionId = process.env.BYTEPE_TEST_COLLECTION_ID;
      test.skip(
        !collectionId,
        'Set BYTEPE_TEST_COLLECTION_ID to a section that can be attached to a test tab'
      );

      const { body } = await createTab(request);
      const attach = await request.put(`${adminApi.baseUrl}/collections/${collectionId}`, {
        data: { subHomePageId: body.id },
        failOnStatusCode: false,
      });
      expect(attach.status(), 'could not attach a section to the test tab').toBe(200);

      const refused = await request.delete(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(
        refused.status(),
        'a tab holding sections was deleted — its sections would silently vanish from the app'
      ).toBe(409);

      const detach = await request.put(`${adminApi.baseUrl}/collections/${collectionId}`, {
        data: { subHomePageId: null },
        failOnStatusCode: false,
      });
      expect(detach.status()).toBe(200);

      const deleted = await request.delete(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(deleted.status(), 'the tab still would not delete after its sections were detached').toBe(200);
    });

    test('E2E-SHP-DELETE-04: a tab cannot be deleted through the wrong home page', async ({ request }) => {
      test.skip(!OTHER, NO_SECOND_PAGE_REASON);
      const { body } = await createTab(request);

      const res = await request.delete(tabUrl(OTHER, body.id), { failOnStatusCode: false });
      expect(res.status(), 'a tab was deletable through another home page').toBe(404);

      const still = await request.get(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(still.status(), 'the tab was removed despite the 404').toBe(200);
    });

    test('E2E-SHP-DELETE-05: deleting the same tab twice', async ({ request }) => {
      const { body } = await createTab(request);
      const first = await request.delete(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(first.status()).toBe(200);

      const second = await request.delete(tabUrl(HOME, body.id), { failOnStatusCode: false });
      expect(second.status(), 'an already-deleted tab is still visible to a later request').toBe(404);
    });
  });

  // ---- Access ----------------------------------------------------------

  test.describe('access', () => {
    test.skip(!adminApi.homePageId, NO_HOME_PAGE_REASON);

    // A separate context with no Authorization header — the file-level
    // extraHTTPHeaders would otherwise authenticate these too.
    test('E2E-SHP-AUTH-01: every tab endpoint is closed to anonymous callers', async ({ playwright }) => {
      const anon = await playwright.request.newContext({ extraHTTPHeaders: { accept: 'application/json' } });
      try {
        const calls = [
          ['GET', tabsUrl(HOME)],
          ['GET', tabUrl(HOME, NIL_UUID)],
          ['POST', tabsUrl(HOME)],
          ['PUT', tabUrl(HOME, NIL_UUID)],
          ['DELETE', tabUrl(HOME, NIL_UUID)],
        ];
        const open = [];
        for (const [method, target] of calls) {
          const res = await anon.fetch(target, {
            method,
            failOnStatusCode: false,
            data: method === 'GET' || method === 'DELETE' ? undefined : { name: 'x', slug: `x-${stamp()}` },
          });
          if (![401, 403].includes(res.status())) open.push(`${method} ${target} -> ${res.status()}`);
        }
        expect(open, 'a tab management endpoint answered an anonymous caller').toEqual([]);
      } finally {
        await anon.dispose();
      }
    });

    test('E2E-SHP-AUTH-02: expired and malformed tokens are rejected', async ({ playwright }) => {
      const bad = [
        ['malformed', 'not-a-jwt'],
        ['empty bearer', ''],
      ];
      const open = [];
      for (const [label, token] of bad) {
        const ctx = await playwright.request.newContext({
          extraHTTPHeaders: { Authorization: `Bearer ${token}`, accept: 'application/json' },
        });
        const res = await ctx.get(tabsUrl(HOME), { failOnStatusCode: false });
        if (![401, 403].includes(res.status())) open.push(`${label} token -> ${res.status()}`);
        await ctx.dispose();
      }
      expect(open, 'an invalid token was accepted').toEqual([]);

      console.log(
        'PARTIAL: the non-admin (403) and expired-token cases need a second, ' +
          'non-admin credential. Set one and extend this test to cover them.'
      );
    });
  });
});

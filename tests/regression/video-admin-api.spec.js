// tests/regression/video-admin-api.spec.js
//
// VID-01..VID-23 — the admin video registry and video<->product mapping API.
//
// Two gates, both deliberate:
//   1. BYTEPE_API_URL + BYTEPE_ADMIN_JWT must be set, or everything skips.
//   2. Tests that create or delete rows additionally need BYTEPE_ALLOW_WRITES=1,
//      so a plain `npm test` can never mutate whatever the API URL points at.
//
// Mapping tests also need BYTEPE_TEST_PRODUCT_ID — a product safe to map to.
//
// Written against the contracts in the E2E sheet. The routes and status codes
// have not been executed against a live API yet; expect to adjust envelope
// field names on first run.

const { test, expect } = require('../fixtures/pageFixtures');
const { randomUUID } = require('crypto');
const {
  adminApi,
  adminConfigured,
  ADMIN_SKIP_REASON,
  WRITE_SKIP_REASON,
} = require('../data/videoFeature');

// Admin auth is a bearer token, not the shopper cookie jar.
test.use({
  storageState: { cookies: [], origins: [] },
  extraHTTPHeaders: adminApi.token
    ? { Authorization: `Bearer ${adminApi.token}`, accept: 'application/json' }
    : { accept: 'application/json' },
});

const url = (path) => `${adminApi.baseUrl}${path}`;
const TEST_PRODUCT_ID = process.env.BYTEPE_TEST_PRODUCT_ID || '';
const NO_PRODUCT_REASON =
  'Set BYTEPE_TEST_PRODUCT_ID to a product safe to map in this environment';

// Response envelopes vary; unwrap once so assertions stay readable.
const unwrap = (body) => (body && body.data !== undefined ? body.data : body);

test.describe('Video admin API', () => {
  test.skip(!adminConfigured(), ADMIN_SKIP_REASON);

  const createdVideoIds = [];

  async function createVideo(request, overrides = {}) {
    const payload = {
      videoServiceId: randomUUID(),
      videoName: `automation-${Date.now()}`,
      ...overrides,
    };
    const res = await request.post(url('/videos'), {
      data: payload,
      failOnStatusCode: false,
    });
    if (res.status() === 201) {
      const created = unwrap(await res.json());
      if (created && created.id) createdVideoIds.push(created.id);
      return { res, payload, created };
    }
    return { res, payload, created: null };
  }

  // Soft-delete everything this file created, whatever the outcome.
  test.afterAll(async ({ request }) => {
    for (const id of createdVideoIds.splice(0)) {
      await request.delete(url(`/videos/${id}`), { failOnStatusCode: false });
    }
  });

  test.describe('Video CRUD', () => {
    // VID-01
    test('VID-01: create video with valid videoServiceId + videoName', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { res, payload, created } = await createVideo(request);
      expect(res.status()).toBe(201);
      expect(created).toMatchObject({
        videoServiceId: payload.videoServiceId,
        videoName: payload.videoName,
        status: 'active',
        deletedAt: null,
      });
      expect(created.id).toBeTruthy();
    });

    // VID-02
    test('VID-02: create without videoName is rejected', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const res = await request.post(url('/videos'), {
        data: { videoServiceId: randomUUID() },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/videoName/i);
    });

    // VID-03
    test('VID-03: duplicate videoServiceId is rejected', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { res: first, payload } = await createVideo(request);
      expect(first.status()).toBe(201);

      const dup = await request.post(url('/videos'), {
        data: { videoServiceId: payload.videoServiceId, videoName: 'duplicate attempt' },
        failOnStatusCode: false,
      });
      expect(dup.status()).toBe(409);
      expect(JSON.stringify(await dup.json())).toMatch(/already exists/i);
    });

    // VID-04 — security; safe to run without the write gate.
    test('VID-04: create without an admin token is rejected', async ({ playwright }) => {
      const anon = await playwright.request.newContext({
        extraHTTPHeaders: { accept: 'application/json' },
      });
      const res = await anon.post(url('/videos'), {
        data: { videoServiceId: randomUUID(), videoName: 'unauthorized' },
        failOnStatusCode: false,
      });
      expect([401, 403]).toContain(res.status());
      await anon.dispose();
    });

    // VID-05
    test('VID-05: list videos paginated, newest first, no soft-deleted', async ({ request }) => {
      const res = await request.get(url('/videos?page=1&limit=20'));
      expect(res.status()).toBe(200);

      const data = unwrap(await res.json());
      expect(data).toMatchObject({ page: 1, limit: 20 });
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.count).toBe('number');

      for (const v of data.items) expect(v.deletedAt ?? null).toBeNull();

      const times = data.items
        .map((v) => Date.parse(v.createdAt))
        .filter((t) => !Number.isNaN(t));
      const sorted = [...times].sort((a, b) => b - a);
      expect(times, 'items must be newest first').toEqual(sorted);
    });

    // VID-06
    test('VID-06: get one video by internal id', async ({ request }) => {
      const list = unwrap(await (await request.get(url('/videos?page=1&limit=1'))).json());
      test.skip(!list.items || !list.items.length, 'no videos exist to fetch');

      const target = list.items[0];
      const res = await request.get(url(`/videos/${target.id}`));
      expect(res.status()).toBe(200);
      expect(unwrap(await res.json())).toMatchObject({ id: target.id });
    });

    // VID-07
    test('VID-07: get non-existent video returns 404', async ({ request }) => {
      const res = await request.get(url(`/videos/${randomUUID()}`), {
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(404);
      expect(JSON.stringify(await res.json())).toMatch(/not found/i);
    });

    // VID-08
    test('VID-08: update videoName', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { created } = await createVideo(request);
      expect(created).toBeTruthy();

      const renamed = `renamed-${Date.now()}`;
      const res = await request.put(url(`/videos/${created.id}`), {
        data: { videoName: renamed },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(200);
      expect(unwrap(await res.json())).toMatchObject({ videoName: renamed });
    });

    // VID-09 — PUT stays partial.
    test('VID-09: videoName is optional on PUT', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { created, payload } = await createVideo(request);
      expect(created).toBeTruthy();

      const res = await request.put(url(`/videos/${created.id}`), {
        data: { status: 'deactive' },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(200);
      expect(unwrap(await res.json())).toMatchObject({
        status: 'deactive',
        videoName: payload.videoName,
      });
    });

    // VID-10
    test('VID-10: update to a duplicate videoServiceId is rejected', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const a = await createVideo(request);
      const b = await createVideo(request);
      expect(a.created && b.created).toBeTruthy();

      const res = await request.put(url(`/videos/${a.created.id}`), {
        data: { videoServiceId: b.payload.videoServiceId },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(409);
      expect(JSON.stringify(await res.json())).toMatch(/already exists/i);
    });
  });

  test.describe('Status toggle', () => {
    // VID-11 and VID-12 — one round trip proves both directions.
    test('VID-11/12: toggle video status active <-> deactive', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { created } = await createVideo(request);
      expect(created).toMatchObject({ status: 'active' });

      const off = await request.patch(url(`/videos/${created.id}/status`), {
        failOnStatusCode: false,
      });
      expect(off.status()).toBe(200);
      expect(unwrap(await off.json())).toMatchObject({ status: 'deactive' });

      const on = await request.patch(url(`/videos/${created.id}/status`), {
        failOnStatusCode: false,
      });
      expect(on.status()).toBe(200);
      expect(unwrap(await on.json())).toMatchObject({ status: 'active' });
    });

    // VID-23 — soft delete frees the videoServiceId for reuse.
    test('VID-23: soft delete releases the videoServiceId', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { created, payload } = await createVideo(request);
      expect(created).toBeTruthy();

      const del = await request.delete(url(`/videos/${created.id}`), {
        failOnStatusCode: false,
      });
      expect(del.status()).toBe(200);

      const recreated = await request.post(url('/videos'), {
        data: { videoServiceId: payload.videoServiceId, videoName: 'reused id' },
        failOnStatusCode: false,
      });
      expect(recreated.status(), 'uuid must be reusable after soft delete').toBe(201);

      const body = unwrap(await recreated.json());
      if (body && body.id) createdVideoIds.push(body.id);
    });
  });

  test.describe('Name search', () => {
    // VID-13
    test('VID-13: search matches on name substring', async ({ request }) => {
      const res = await request.get(url('/videos?search=pho'));
      expect(res.status()).toBe(200);

      const { items } = unwrap(await res.json());
      test.skip(!items.length, 'no videos match "pho" in this environment');
      for (const v of items) expect(v.videoName.toLowerCase()).toContain('pho');
    });

    // VID-14
    test('VID-14: search is case-insensitive', async ({ request }) => {
      const lower = unwrap(await (await request.get(url('/videos?search=iphone'))).json());
      const upper = unwrap(await (await request.get(url('/videos?search=IPHONE'))).json());
      test.skip(!lower.items.length, 'no videos named like "iphone" in this environment');

      expect(upper.items.map((v) => v.id).sort()).toEqual(lower.items.map((v) => v.id).sort());
    });

    // VID-15 — search is name-only now; a uuid fragment must not match.
    test('VID-15: search no longer matches videoServiceId', async ({ request }) => {
      const list = unwrap(await (await request.get(url('/videos?page=1&limit=20'))).json());
      const subject = (list.items || []).find(
        (v) =>
          v.videoServiceId &&
          !v.videoName.toLowerCase().includes(v.videoServiceId.slice(0, 8).toLowerCase())
      );
      test.skip(!subject, 'no video with a uuid absent from its name');

      const fragment = subject.videoServiceId.slice(0, 8);
      const res = await request.get(url(`/videos?search=${fragment}`));
      expect(res.status()).toBe(200);

      const ids = unwrap(await res.json()).items.map((v) => v.id);
      expect(ids, 'search must not match on videoServiceId').not.toContain(subject.id);
    });
  });

  test.describe('Product mapping', () => {
    // VID-16
    test('VID-16: add a product mapping to a video', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      test.skip(!TEST_PRODUCT_ID, NO_PRODUCT_REASON);

      const { created } = await createVideo(request);
      const res = await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: TEST_PRODUCT_ID },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(201);
      expect(unwrap(await res.json())).toMatchObject({ status: 'active' });
    });

    // VID-17
    test('VID-17: duplicate (video, product) mapping is rejected', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      test.skip(!TEST_PRODUCT_ID, NO_PRODUCT_REASON);

      const { created } = await createVideo(request);
      const first = await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: TEST_PRODUCT_ID },
        failOnStatusCode: false,
      });
      expect(first.status()).toBe(201);

      const dup = await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: TEST_PRODUCT_ID },
        failOnStatusCode: false,
      });
      expect(dup.status(), 'duplicate mapping must conflict — see VID-38').toBe(409);
      expect(JSON.stringify(await dup.json())).toMatch(/already mapped/i);
    });

    // VID-18
    test('VID-18: mapping a non-existent product is rejected', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);

      const { created } = await createVideo(request);
      const res = await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: randomUUID() },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(404);
      expect(JSON.stringify(await res.json())).toMatch(/product not found/i);
    });

    // VID-19
    test('VID-19: list a video\'s mappings, oldest first', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      test.skip(!TEST_PRODUCT_ID, NO_PRODUCT_REASON);

      const { created } = await createVideo(request);
      await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: TEST_PRODUCT_ID },
        failOnStatusCode: false,
      });

      const res = await request.get(url(`/videos/${created.id}/products`));
      expect(res.status()).toBe(200);

      const mappings = unwrap(await res.json());
      expect(Array.isArray(mappings)).toBe(true);
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings[0].product, 'each mapping resolves its product').toBeTruthy();

      const times = mappings.map((m) => Date.parse(m.createdAt)).filter((t) => !Number.isNaN(t));
      expect(times, 'mappings must be oldest first').toEqual([...times].sort((a, b) => a - b));
    });

    // VID-20
    test('VID-20: filter mappings by status', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      test.skip(!TEST_PRODUCT_ID, NO_PRODUCT_REASON);

      const { created } = await createVideo(request);
      await request.post(url(`/videos/${created.id}/products`), {
        data: { productId: TEST_PRODUCT_ID },
        failOnStatusCode: false,
      });

      const res = await request.get(url(`/videos/${created.id}/products?status=active`));
      expect(res.status()).toBe(200);
      for (const m of unwrap(await res.json())) expect(m.status).toBe('active');
    });

    // VID-21
    test('VID-21: repoint a mapping to another product', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      const other = process.env.BYTEPE_TEST_PRODUCT_ID_ALT || '';
      test.skip(!TEST_PRODUCT_ID || !other, 'needs BYTEPE_TEST_PRODUCT_ID and _ALT');

      const { created } = await createVideo(request);
      const mapping = unwrap(
        await (
          await request.post(url(`/videos/${created.id}/products`), {
            data: { productId: TEST_PRODUCT_ID },
            failOnStatusCode: false,
          })
        ).json()
      );

      const res = await request.put(url(`/videos/${created.id}/products/${mapping.id}`), {
        data: { productId: other },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(200);
      expect(unwrap(await res.json())).toMatchObject({ productId: other });
    });

    // VID-22
    test('VID-22: toggle mapping status', async ({ request }) => {
      test.skip(!adminApi.writesAllowed, WRITE_SKIP_REASON);
      test.skip(!TEST_PRODUCT_ID, NO_PRODUCT_REASON);

      const { created } = await createVideo(request);
      const mapping = unwrap(
        await (
          await request.post(url(`/videos/${created.id}/products`), {
            data: { productId: TEST_PRODUCT_ID },
            failOnStatusCode: false,
          })
        ).json()
      );
      expect(mapping.status).toBe('active');

      const off = await request.patch(
        url(`/videos/${created.id}/products/${mapping.id}/status`),
        { failOnStatusCode: false }
      );
      expect(off.status()).toBe(200);
      expect(unwrap(await off.json())).toMatchObject({ status: 'deactive' });

      const on = await request.patch(
        url(`/videos/${created.id}/products/${mapping.id}/status`),
        { failOnStatusCode: false }
      );
      expect(unwrap(await on.json())).toMatchObject({ status: 'active' });
    });
  });
});

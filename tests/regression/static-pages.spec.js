const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// The list of pages to check. Add more as you confirm their URLs.
const staticPages = [
  { name: 'Home',         path: '/' },
  { name: 'About Us',     path: '/about-us' },
  { name: 'Subscription', path: '/home/subscription' },
  { name: 'EMI Store',    path: '/home/emi-store' },
  { name: 'Products',     path: '/all-products' },

  // Policy/content pages — add these once you confirm each URL
  // (click the footer link in your browser and copy the address bar):
  // { name: 'Privacy Policy', path: '/privacy-policy' },
  // { name: 'Terms of Use',   path: '/terms-of-use' },
  // { name: 'FAQs',           path: '/faqs' },
];

for (const pageInfo of staticPages) {
  test(`page loads: ${pageInfo.name}`, async ({ page }) => {
    await page.goto(`${BASE_URL}${pageInfo.path}`, { waitUntil: 'domcontentloaded' });

    // Confirm the page actually rendered (the app shell / logo is present)
    await expect(page.getByRole('img', { name: 'BytePe Logo' }).first())
      .toBeVisible({ timeout: 15000 });
  });
}
const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

const staticPages = [
  { name: 'Home',                        path: '/' },
  { name: 'About Us',                    path: '/about-us' },
  { name: 'Subscription',                path: '/home/subscription' },
  { name: 'EMI Store',                   path: '/home/emi-store' },
  { name: 'Products',                    path: '/all-products' },
  { name: 'Privacy Policy',              path: '/privacy-policy' },
  { name: 'Terms of Use',                path: '/terms-of-use' },
  { name: 'FAQ',                         path: '/faq' },
  { name: 'Shipping Policy',             path: '/shipping-policy' },
  { name: 'Payment Policy',              path: '/payment-policy' },
  { name: 'Order Cancellation & Return', path: '/cancellation-and-return' },
  { name: 'Grievance Redressal',         path: '/grievance-redressal' },
];

for (const pageInfo of staticPages) {
  test(`page loads: ${pageInfo.name}`, async ({ page }) => {
    await page.goto(`${BASE_URL}${pageInfo.path}`, { waitUntil: 'domcontentloaded' });

    // Universal checks: the route resolved, and the page rendered real text (not blank)
    await expect(page).toHaveURL(new RegExp(pageInfo.path), { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/\S/, { timeout: 15000 });
  });
}
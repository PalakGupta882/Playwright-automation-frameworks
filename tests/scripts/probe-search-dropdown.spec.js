const { test } = require('../fixtures/pageFixtures');

// Read-only probe. Types a term that matches a live product and dumps the
// autocomplete dropdown's real DOM, so the suggestion locator can be anchored
// on something measured rather than guessed. Public page, logged out, no writes.
test('probe: autocomplete dropdown structure', async ({ page, productsListPage }) => {
  test.setTimeout(120000);

  await productsListPage.goto();
  const count = await productsListPage.search('iphone air');
  console.log('\n=== suggestion count from page object:', count);

  // Every non-blank <li> on the page, with its ancestor chain. If nav/footer
  // items show up here, the page-wide locator is already mis-targeting.
  const items = await page.evaluate(() => {
    const chain = (el) => {
      const out = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        out.push([
          n.tagName.toLowerCase(),
          n.id ? `#${n.id}` : '',
          n.getAttribute('role') ? `[role=${n.getAttribute('role')}]` : '',
          n.getAttribute('data-testid') ? `[testid=${n.getAttribute('data-testid')}]` : '',
          n.className && typeof n.className === 'string'
            ? `.${n.className.trim().split(/\s+/).join('.')}` : '',
        ].join(''));
      }
      return out;
    };
    return [...document.querySelectorAll('li')]
      .filter((li) => li.textContent.trim())
      .map((li, i) => ({
        i,
        text: li.textContent.trim().slice(0, 70),
        role: li.getAttribute('role'),
        ancestors: chain(li).slice(0, 6),
      }));
  });

  console.log(`\n=== non-blank <li> on page: ${items.length}`);
  for (const it of items) {
    console.log(`\n[${it.i}] role=${it.role} text="${it.text}"`);
    console.log(`     ${it.ancestors.join('\n     < ')}`);
  }

  // Anything that looks like a listbox/menu container, whether or not it uses <li>.
  const containers = await page.evaluate(() =>
    [...document.querySelectorAll('[role=listbox],[role=menu],[role=presentation],ul')]
      .filter((el) => el.textContent.trim())
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        testid: el.getAttribute('data-testid'),
        cls: typeof el.className === 'string' ? el.className : '',
        kids: el.children.length,
        text: el.textContent.trim().slice(0, 60),
      })));
  console.log('\n=== candidate containers:');
  for (const c of containers) console.log('   ', JSON.stringify(c));
});

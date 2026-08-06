// tests/scripts/probe-login-screens.spec.js
//
// Diagnostic, not a test. Drives the login dialog and dumps what is actually on
// screen, so the OTP locator can be written from evidence instead of guesswork.
//
// Run it:
//   npx playwright test scripts/probe-login-screens.spec.js --project=chromium --headed --workers=1 --retries=0
//
// Why this exists: enterOtp() tried four locators and matched none, and nobody
// had ever inspected the real OTP markup. A plain node script cannot reach that
// screen — the Login button is covered by a promo overlay and the Escape +
// force-click that survives it lives in HomePage.openLoginDialog() — so this
// reuses the page object rather than reimplementing it.
//
// COSTS ONE REAL OTP SMS to the company test number. It creates no cart or order
// state, and it deliberately does NOT write auth.json: a probe that clobbers a
// working session is worse than no probe.
//
// Never prints input values and never screenshots after a digit is typed. This
// output goes to console logs and the HTML report, and these screens carry a
// phone number and a one-time code.

const { test } = require('@playwright/test');
const { HomePage } = require('../pages/homepage');
const {
  describeInputs,
  describeButtons,
  formatInputs,
  formatButtons,
  countCandidates,
  describeFrames,
} = require('../utils/domProbe');

// The global storageState would land us on a logged-in homepage where no login
// dialog exists at all. Same opt-out as site-health.spec.js.
test.use({ storageState: { cookies: [], origins: [] } });

test('probe: what the login and OTP screens actually render', async ({ page }, testInfo) => {
  test.setTimeout(180000);

  const mobile = process.env.BYTEPE_MOBILE;
  test.skip(!mobile, 'BYTEPE_MOBILE is not set — nothing to log in with.');

  const home = new HomePage(page);
  const report = {};

  const snapshot = async (label) => {
    const inputs = await describeInputs(page);
    const buttons = await describeButtons(page);
    const frames = await describeFrames(page);

    console.log(`\n===== ${label} =====`);
    console.log(`url: ${page.url()}`);
    console.log(frames);
    console.log('inputs:');
    console.log(formatInputs(inputs));
    console.log('visible buttons:');
    console.log(formatButtons(buttons));

    report[label] = { url: page.url(), frames, inputs, buttons };
    return { inputs, buttons };
  };

  await test.step('1. open the login dialog', async () => {
    await home.openLoginDialog();
    await snapshot('login-dialog');

    // Settles whether category-browsing's final assertion can pass without ever
    // leaving the homepage. Free here, and it needs a logged-out page.
    const pdLinks = await page.locator('a[href*="/pd/"]').count();
    console.log(`\nhomepage /pd/ link count (logged out): ${pdLinks}`);
    report.homepagePdLinkCount = pdLinks;
  });

  await test.step('2. after filling the mobile number', async () => {
    await page.getByRole('textbox', { name: 'Mobile Number*' }).fill(mobile);

    // The question this answers: is Continue actually enabled? This site has
    // controls that only enable on key-by-key typing (productPage.js documents
    // one). If Continue never enables, the app never reached an OTP screen and
    // the OTP markup was never the problem.
    const cont = page.getByRole('button', { name: 'Continue' });
    const disabled = await cont.isDisabled().catch(() => 'unknown');
    console.log(`\nContinue disabled after fill(): ${disabled}`);
    report.continueDisabledAfterFill = disabled;

    await snapshot('mobile-filled');
  });

  await test.step('3. the OTP screen', async () => {
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15000 });
    await page.waitForTimeout(5000);

    const { inputs } = await snapshot('otp-screen');

    // Why the four existing candidates missed, measured rather than guessed.
    const candidates = [
      ['role=textbox[name=/otp/i]', page.getByRole('textbox', { name: /otp/i })],
      ['placeholder=/otp/i', page.getByPlaceholder(/otp/i)],
      ['autocomplete=one-time-code', page.locator('input[autocomplete="one-time-code"]')],
      ['input[type=tel]', page.locator('input[type="tel"]')],
      ['input[maxlength=1]', page.locator('input[maxlength="1"]')],
      ['input[inputmode=numeric]', page.locator('input[inputmode="numeric"]')],
    ];
    const counts = await countCandidates(candidates);
    console.log(`\ncandidate counts: ${counts}`);
    report.candidateCounts = counts;

    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.count()) {
      const html = await dialog.evaluate(n =>
        n.outerHTML.replace(/value="[^"]*"/g, 'value="[redacted]"').slice(0, 6000)
      );
      console.log('\ndialog outerHTML (truncated, values redacted):');
      console.log(html);
      report.dialogHtml = html;
    }

    // Safe: nothing has been typed into an OTP field at this point.
    const shot = testInfo.outputPath('otp-screen.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('otp-screen', { path: shot, contentType: 'image/png' });

    console.log(`\nvisible inputs on the OTP screen: ${inputs.filter(i => i.visible).length}`);
  });

  await testInfo.attach('login-probe.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
});

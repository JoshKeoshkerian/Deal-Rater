// UTM pass-through: carry ad attribution from the landing URL onto Chrome Web
// Store links (first touch wins for 30 days), and fire the Quora Pixel's
// conversion on a Web Store click. No dependencies.
(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var STORE = /chromewebstore\.google\.com|chrome\.google\.com\/webstore/;
  var TTL = 30 * 24 * 60 * 60 * 1000;
  // Quora conversion: a Web Store click. Delegated, so later links count too;
  // fire-and-forget, never blocks the navigation (store links open a new tab).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (a && STORE.test(a.href) && window.qp) qp("track", "Generic");
  }, true);

  var url = new URLSearchParams(location.search), fromUrl = {}, stored = null, utm = null;
  KEYS.forEach(function (k) { if (url.get(k)) fromUrl[k] = url.get(k); });
  try { stored = JSON.parse(localStorage.getItem("cs_utm")); } catch (e) {}
  var fresh = stored && stored.params && Date.now() - stored.ts < TTL;
  if (fresh) {
    utm = stored.params; // first touch wins, for storage and for the links
  } else if (Object.keys(fromUrl).length) {
    utm = fromUrl;
    try { localStorage.setItem("cs_utm", JSON.stringify({ params: fromUrl, ts: Date.now() })); } catch (e) {}
  }
  if (!utm) return;

  function tag(a) {
    if (!STORE.test(a.href)) return;
    var u = new URL(a.href), changed = false;
    for (var k in utm) {
      if (u.searchParams.get(k) !== utm[k]) { u.searchParams.set(k, utm[k]); changed = true; }
    }
    if (changed) a.href = u.toString(); // only writes when needed, so the observer can't loop
  }
  function tagAll() { document.querySelectorAll("a[href]").forEach(tag); }

  tagAll();
  new MutationObserver(tagAll).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["href"],
  });
  // Last line of defence: a link changed between the observer and the click.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (a) tag(a);
  }, true);
})();

# Curbside paid advertising research and starting recommendation

Researched September 23, 2026. Public platform documentation and current local product files were reviewed. No campaigns were created, publishers contacted, or money spent. Account-specific inventory, auction prices, and approval status remain unverified. Rankings below are judgments about suitability, not performance forecasts.

## Recommendation

Start by checking Quora Ads inventory for US desktop Chrome users reading questions about buying and evaluating used cars on Facebook Marketplace. If relevant inventory is available, run a manual cost-per-click test at $10/day with a $100 lifetime cap. Review before committing another $100. This is a learning budget, not a promise of statistically conclusive results or profitability.

Quora has the best verified combination for this particular experiment: a desktop Chrome filter, contextual questions/keywords, self-service purchasing, and a $5 daily minimum. It is not proven to be Curbside's best acquisition channel. Relevant traffic volume and customer acquisition cost still need measurement.

If there is insufficient inventory, do not remove Chrome or expand into unrelated topics merely to spend. First expand from exact Marketplace buying questions into relevant private-party price comparison and negotiation questions. If delivery remains inadequate, stop and consider a direct browser-filtered automotive publisher placement. Desktop Reddit is a separate alternative if mixed-browser delivery is acceptable.

## Product facts that affect acquisition

Current `curbside-app/lib/plans.ts` specifies 10 free checks, a $7.99 pack of 10, an $11.99 pack of 20, and $16.99/month unlimited. The pricing page explicitly positions the subscription for the period when someone is shopping. Do not assume long subscription retention or SaaS-style lifetime value.

The extension checks Facebook Marketplace vehicle listings. Marketing must distinguish asking-price comparisons from completed-sale valuations, inspections, seller verification, and guaranteed savings. The relevant audience is an active private-party vehicle shopper using a supported desktop browser, not everyone interested in cars or Chrome extensions.

The previous publication log contains five Reddit placements, with no recorded acquisition or purchase outcomes. That is insufficient evidence to rank Reddit's conversion performance.

Older READMEs calling billing a mockup conflict with newer pricing code and the owner's confirmation that payments were implemented. This report uses current pricing code; it is not a production checkout audit.

## Browser compatibility correction

Non-Chrome does not automatically mean incompatible. Microsoft officially supports installing Chrome Web Store extensions in Edge. Curbside uses Manifest V3, but that alone does not prove end-to-end Edge support. Test installation, Facebook capture, evaluation, authentication, saved checks, and billing before adding Edge to the marketing claim. [Microsoft instructions](https://support.microsoft.com/en-us/edge/add-turn-off-or-remove-extensions-in-microsoft-edge).

Browser detection and platform classification also have limits. Evaluate actual landing traffic rather than assuming a targeting selector produces perfect classification.

## Channel comparison

| Channel | Verified capabilities / access | Suitability judgment and uncertainty |
|---|---|---|
| Quora | Desktop Chrome targeting; specific questions and contextual keywords; CPC bidding; $5/day floor | First inventory check and small paid test. Matches the browser requirement and a research context. Exact relevant volume is unknown. |
| Reddit | Desktop targeting, community and keyword audiences; small self-service campaigns | Strong second candidate for buyer context. No verified Chrome-only control. Prior organic placements do not prove paid performance. |
| Google Search | Search intent; device controls; keyword forecasting | Potentially valuable later, but no standard browser filter. Need actual keyword volume/cost estimates and software-ad approval before recommending spend. |
| Microsoft Search | Search audience and device criteria | Revisit after Edge compatibility validation. No verified Chrome-only Search filter found. No assumption that it is cheaper than Google. |
| Meta / Facebook | Official SDK supports desktop device targeting and placement fields | Product lives on Facebook, but being a Facebook user is not proof of shopping for a car. No verified current Chrome-only control; manual placement availability needs account inspection. |
| YouTube / Google video | Device and content targeting vary by campaign type | A real demonstration fits the medium. Do not assume a single campaign can combine every placement, conversion, and device control. No verified Chrome-only Google Ads filter. |
| Google Display | Site/content targeting and desktop controls | Can reach automotive content but doesn't resolve the Chrome-only requirement. Prioritize only after activation works. |
| Taboola / Realize native | Explicit Chrome browser targeting and contextual categories | Technically credible Chrome-only alternative. Adds publisher/placement quality management and less specific buying context than curated questions. Current minimum/account terms need confirmation. |
| DV360 / programmatic buying platforms | DV360 explicitly supports Chrome and device targeting | Browser control is real. Small-budget access, reseller fees, and inventory terms are separate problems. Not the first account to open for a $100 test. |
| Direct automotive website sponsorship | A publisher using Google Ad Manager can filter desktop and Chrome | Promising way to buy compatible traffic in useful content without buying a DSP subscription. Actual publisher willingness, traffic, and quote are unverified. |
| Creators, newsletters, affiliates | Negotiated placements or commission arrangements | Can demonstrate trust/value. No automatic Chrome or desktop guarantee. Prefer actual used-car buying content over general technology audiences. |
| Brave Ads | Browser/search placements; current help lists $500 self-service minimum | Not Chrome delivery. Requires Brave compatibility validation and audience-fit research. Larger initial commitment than Quora. |
| X | Official guidance supports separating desktop/mobile campaigns | No demonstrated advantage for this purchase context; no verified Chrome-only control. Defer. |
| Pinterest | Desktop is an available device category | Browser control not verified; no evidence of stronger Marketplace buyer fit. Defer. |
| TikTok / Instagram / Snapchat | Social creative opportunities, with platform-specific device/placement constraints | A phone-to-desktop installation journey is an extra obstacle. Do not make them the first test for the current desktop-only offer. |
| LinkedIn | Professional audience platform, $10/day minimum | Poor match for consumer private-party car shopping; reconsider only for a distinct business customer offer. |
| Podcast, audio, connected TV, offline | Negotiated or platform media buys | Adds delayed response and device switching. Not appropriate for the first tightly measured installation experiment. |
| Retargeting | Available on several platforms using eligible first-party audiences | A later tactic, not a source of new shoppers. A past Chrome visit does not guarantee the current browser. |
| Chrome Web Store discovery / paid directories | Store discovery guidance emphasizes product quality and merchandising | No verified self-service sponsored-search listing product found in the store. Do not confuse an external paid directory with official store promotion. |

### Evidence for the leading candidates

Quora explicitly lists desktop Chrome as a selectable browser. Its question targeting places ads on selected question pages or expanded questions in feeds. Its documentation warns that exact question targeting can limit scale. [Browser controls](https://quoraadsupport.zendesk.com/hc/en-us/articles/360028981012-Device-Browser-Targeting), [question targeting](https://quoraadsupport.zendesk.com/hc/en-us/articles/360028977632-Question-Targeting).

Quora's budget documentation specifies a $5 daily minimum and optional lifetime cap. Manual CPC charges up to the selected bid per click; its minimum bid is not evidence that cheap delivery is available. [Budgets](https://quoraadsupport.zendesk.com/hc/en-us/articles/14928208486669-Budget-Setting-Best-Practices), [bidding](https://quoraadsupport.zendesk.com/hc/en-us/articles/360029218751-Bidding-Types).

An advertiser's first-hand account from Ahrefs describes useful question targeting but also limited scale and inaccurate reach estimates in some cases. It did not establish conversion profitability for Curbside or even provide comparable buyer economics. Treat this as a warning to verify delivery, not a CPC benchmark. [Ahrefs experience](https://ahrefs.com/blog/quora-ads/).

Reddit documents desktop controls and audiences built from community engagement. Community targeting is not an exclusive placement purchase inside that subreddit. Current documentation discusses audience expansion; inspect the actual controls before assuming strict selection. Paid ads and organic moderator posting permissions are separate mechanisms. [Desktop example](https://www.business.reddit.com/learning-hub/articles/how-reddit-ads-targeting-works-for-smbs), [Audience Manager](https://business.reddithelp.com/articles/Knowledge/Audience-Manager).

Taboola's browser-targeting guide specifically identifies Chrome extensions as a use case. Contextual targeting can select or exclude content categories. Neither capability proves buying intent or profitable clicks. [Browser targeting](https://realize.com/help/en/articles/3878022-targeting-by-internet-browser), [contextual targeting](https://realize.com/help/en/articles/5660593-contextual-targeting-and-reporting).

DV360 supports Chrome targeting; Google Ad Manager supports both browser and desktop device targeting for publisher inventory. Ad Manager is the publisher's serving system, not a replacement Google Search buying interface. A direct publisher deal is possible only if that publisher can and will apply these filters. [DV360](https://support.google.com/displayvideo/answer/3090410?hl=en), [Ad Manager](https://support.google.com/admanager/answer/2884033?hl=en).

### Practical barriers found

- Google classifies free/freemium desktop extensions under its free desktop software policy and requires an authoritative distribution application. Curbside's paid upgrades do not by themselves exempt its free installation. Resolve the approved destination/distribution arrangement before using Google Ads. [Policy](https://support.google.com/adspolicy/answer/13528034?hl=en).
- AdLib's billing help lists $799/month access after a 30-day free period, separate from media spend. That makes it unattractive for this budget. [Billing](https://help.getadlib.com/en/articles/2688768-how-does-billing-work).
- Choozle's managed self-service page lists $15,000 media spend over 90 days. Do not interpret this as every DSP's minimum, but it rules out that particular offer here. [Service terms](https://choozle.com/managed-self-service/).
- Amazon DSP managed service typically requires $50,000; self-service terms differ. It is not a sensible starting recommendation without a much larger reason to use that inventory. [Amazon DSP](https://advertising.amazon.com/solutions/products/amazon-dsp).
- Brave's current introduction lists $500 for self-service and $10,000/month for managed service; other format-specific pages have different figures. Confirm the actual package instead of relying on old announcements. [Brave Ads](https://ads-help.brave.com/).

### Supporting platform sources

- [Microsoft targeting documentation](https://github.com/MicrosoftDocs/Advertising/blob/main/advertising/bingads-13/guides/show-ads-target-audience.md).
- [Meta's official targeting SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/targeting.py). Public Help pages were login-blocked; account-specific placement combinations were not verified.
- [Google device targeting](https://support.google.com/google-ads/answer/1722028), [Display targeting](https://support.google.com/google-ads/answer/2404191), [Keyword Planner forecasts](https://support.google.com/google-ads/answer/3022575).
- [X campaign optimization](https://business.x.com/en/help/campaign-editing-and-optimization/intro-to-optimizing).
- [Pinterest device targeting](https://help.pinterest.com/en/business/article/set-up-device-targeting).
- [TikTok budget requirements](https://ads.tiktok.com/help/article/budget?lang=en).
- [LinkedIn minimum budget](https://business.linkedin.com/advertise/ads/best-practices/maximize-your-budget).
- [Chrome Web Store discovery](https://developer.chrome.com/docs/webstore/discovery).
- [AutomotiveForums advertising](https://www.automotiveforums.com/corporate/advertising.php) is an example of a publisher offering advertising, not a verified affordable or browser-filtered placement. Request current evidence rather than relying on its audience claims.

## Economics: what a click can be worth

Break-even cost per click = probability a paid click becomes a paying customer × contribution per acquired customer before acquisition spend.

Contribution should deduct payment processing, variable evaluation costs, refunds, and the allocated cost of serving free users. Future subscription renewals should enter only when observed.

Illustrative sensitivity, not a forecast:

| Contribution per new payer | 1% click-to-paid | 3% click-to-paid | 5% click-to-paid |
|---|---:|---:|---:|
| $6 | $0.06 | $0.18 | $0.30 |
| $10 | $0.10 | $0.30 | $0.50 |
| $14 | $0.14 | $0.42 | $0.70 |

At $0.50/click and 2% click-to-paid conversion, acquisition costs $25 per payer. That exceeds every current first-purchase price even before delivery costs. More compatible traffic alone cannot repair that gap. Ten free checks might also satisfy a buyer's whole search; measure this before changing the offer.

## Concrete first test

1. **Verify measurement and the product journey.** Use a fresh account to install, sign in, complete a check, save it, and reach checkout. Record campaign source against the signed-in account and connect first successful evaluation and purchase to it. A store-button click is not an install, and an install is not activation. Chrome Web Store supports campaign parameters, but it does not automatically give Curbside complete cross-site user attribution. [Store analytics](https://developer.chrome.com/docs/webstore/google-analytics).
2. **Inspect Quora inventory before funding.** US, desktop, Chrome. Discover actual questions around Facebook Marketplace cars, private-party asking prices, comparing used cars, and negotiation. Review each question. Exclude selling, dealer marketing, financing-only discussions, and unrelated Marketplace merchandise. Search seeds are not confirmed available placements.
3. **Keep the initial scope understandable.** One campaign and one question-targeted ad set with two text variants: price comparison and deciding whether a listing is worth a visit. No broad or automated audience expansion in this experiment. If exact questions cannot deliver, test contextual phrase keywords separately without dropping device/browser constraints. [Keyword targeting](https://quoraadsupport.zendesk.com/hc/en-us/articles/360028973932-Keyword-Targeting).
4. **Use a text-first ad.** Quora's current documentation says question pages do not show images or videos, so a video-led Reddit creative cannot simply be reused. Put the real demonstration on the destination page. State desktop Chrome, 10 free checks with sign-in, and the product name. [Placement details](https://quoraadsupport.zendesk.com/hc/en-us/articles/115010300687-Where-do-Quora-ads-appear).
5. **Budget and bids.** $10/day, $100 lifetime cap, up to 10 delivery days. Manual CPC. Use the account's suggested range as an auction signal, then compare it to the economics above. There is no evidence yet for a profitable numeric CPC cap. A deliberately higher learning bid must be treated as research spend. Do not use mobile-app-install campaigns for a browser extension.
6. **Measure both behavior and revenue.** Record paid clicks, valid landing sessions, desktop/browser mix, sign-ins, first successful evaluations, second-listing evaluations, first purchases, revenue, and contribution. Report platform-attributed/view-through conversions separately from observed click-attributed accounts.
7. **Review in stages.** At approximately $25, inspect tracking, browser/location leakage, and landing-session quality. At 50 valid visitors with zero successful first evaluations, pause to inspect the offer/onboarding; this is a practical stop rule, not a universal statistical threshold. At $100, stop automatically and review cohorts. Allow another 7–14 days for the free allowance to lead to purchases before interpreting revenue.
8. **Expand only on evidence.** Spend the optional second $100 only if there are real activated shoppers and a plausible route to affordable acquisition. A few purchases are directional, not proof of stable performance. If the audience does not deliver at an acceptable bid, document an inventory limitation rather than declaring the product unsuccessful.

## What remains unknown

Actual Quora question availability and reach; auction CPCs; live account browser controls; ad acceptance; Curbside's current organic activation and free-to-paid rates; evaluation cost per user; refund rate; repeat-purchase value; and verified Edge/Brave compatibility. No public benchmark can substitute for these measurements.

The starting choice is Quora because its documented controls remove a specific avoidable source of waste while retaining relevant context and a low commitment. The campaign should determine whether the remaining economics work, rather than assuming that they do.

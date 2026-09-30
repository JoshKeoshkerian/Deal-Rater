from docx import Document
p='output/documents/Curbside_Executive_Summary.docx';d=Document(p)
for x in d.paragraphs:
 t=x.text
 if t.startswith('Our first product is'):
  x.text='Our first product is a Chrome extension that compares a vehicle’s asking price directly against other Facebook Marketplace listings. Buyers see how the car compares with alternatives in the marketplace where they are shopping. Curbside combines those comparisons with vehicle risk indicators and negotiation guidance in an explained score out of 100, helping buyers decide which vehicles deserve further attention.'
 elif t.startswith('The current product evaluates'):
  x.text='Curbside evaluates a Facebook Marketplace vehicle using comparable asking prices from other Facebook Marketplace listings. This gives buyers pricing context grounded in vehicles offered on the same platform, with adjustments for relevant characteristics such as mileage and trim. The results combine price comparisons, risk indicators, and negotiation guidance. Saved evaluations support a shortlist. Asking prices are not completed sale prices, and an evaluation does not replace an inspection.'
 elif t.startswith('Initial distribution will use'):
  x.text='Initial distribution will use the Chrome Web Store and Curbside website. Demonstrations will lead with the core benefit: compare a car’s asking price directly with other Facebook Marketplace listings while shopping. Educational content, university networks, automotive communities, and referrals will connect that comparison to a real purchase decision. Paid acquisition will expand after conversion and acquisition costs justify it.'
 elif t.startswith('Manual listing comparisons'):
  x.text='Direct competitors also include Marketplace-focused extensions. CarScout advertises comparable-listing searches and ranked alternatives from a Marketplace vehicle page. [7] This makes exclusivity an unsupported claim. Curbside will compete through the usefulness of its Marketplace comparisons, risk explanations, and negotiation guidance. Manual research and independent mechanics remain substitutes or complements.'
 elif t.startswith('Curbside combines evaluation technology'):
  x.text='Curbside’s core strength is direct price comparison across Facebook Marketplace vehicle listings, combined with explanations that help buyers act. The benchmark comes from other listings in the same marketplace where the buyer is choosing a car. Our broader vision builds on that context to guide inspection, financing, and purchase steps, carrying useful vehicle information through the buying process.'
 elif t.startswith('[1] Internal calibration'):
  for r in x.runs:r.text += ' [7] CarScout, Chrome Web Store: chromewebstore.google.com/detail/andcdhiiobnhninfkfodhhghcjjkdaol (accessed September 30, 2026).'
d.save(p)

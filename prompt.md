# GMC / ENGINED LISTING PAGE PROMPT — v3 (SINGLE-PASS)
Prompt Name: GMC-LISTING-v3
Applies to: EVERY listing page across ALL 21 brands and ALL hubs. One prompt, one run, one complete page — content + schema together. Supersedes the v2 two-prompt suite (P1 Content / P2 Metas & Schema): the two are merged here because a listing page's entire content is already fully specified by one row of the Listing Schedule Table, and splitting it added process without adding safety.

═══════════════════════════════════════════════════════
DEV PICK-ROW BLOCK — copy this whole block per listing, fill the brackets, attach the named input, run
═══════════════════════════════════════════════════════
```
ENGINE CODE: {code}      APPLICATION: {model / chassis / variant from the Listing Schedule Table}
ATTACH: one row from the Listing Schedule Table (output of GMC-ERF-TO-LISTINGS-v2) —
        plain text or CSV row is enough. Do NOT attach the original ERF or BRF at this stage;
        the Schedule Table row is a complete, self-sufficient input on its own.
PARENT HUB PAGE MUST ALREADY EXIST — do not generate a listing before its hub page is live.
RUN: GMC-LISTING-v3 (single pass — content and schema both come out of one run)
```
═══════════════════════════════════════════════════════

═══════════════════════════════════════════════════════
INHERITED LAW (applies in full, unchanged from the rest of the suite)
═══════════════════════════════════════════════════════
- Three-Lane Law, banned vocabulary (EF-protected, EM-protected), required commerce vocabulary, EEAT rules E1–E9 — all from the Brand Page Prompt Suite v2's Shared Preamble.
- The Derivation Law D1–D8 from the Model Page Prompt Suite v2.
- The ERF-Specific Law from the Hub Page Prompt Suite v2.

LISTING-SPECIFIC LAW (unchanged from v2):
L1. ONE ROW, ONE PAGE. This prompt generates exactly one listing page from exactly one Listing Schedule Table row. If asked to generate multiple listings in one pass, refuse — run once per row.
L2. NO CONTENT INVENTION. Every field on this page already exists in the attached row (or was already resolved upstream when that row was built). This prompt's job is arrangement into the fixed structure below — it does not add supporting detail, expand claims, or introduce facts the row doesn't contain.
L3. A ROW IN THE TABLE IS ALREADY CLEARED TO PUBLISH. Fitment-unconfirmed application groups were excluded before the Listing Schedule Table was built (per GMC-ERF-TO-LISTINGS-v2's hard exclusion rule) — this prompt does not re-check fitment confidence and does not need to. If the attached row looks incomplete or contradictory on its face, stop and flag it rather than guessing, but do not treat "PENDING" reasoning as something this prompt itself needs to apply.
L4. PARENT CONTEXT INHERITANCE. This page's breadcrumb, canonical structure, and schema all nest under the parent hub's URL. If the parent hub's slug is not knowable from the attached row, stop and ask — never guess a hub slug.

PRICING LAW (unchanged, absolute): the attached row's Used and Recon prices are hardcoded, real, and final for this pass. Output them as plain GBP figures, no hedging language, no "approx", no placeholder text of any kind.

═══════════════════════════════════════════════════════
OUTPUT ORDER (fixed — metas and canonical come FIRST, before any content section)
═══════════════════════════════════════════════════════

--- 1. METAS ---
META_TITLE: pattern "{Listing Title from the row} | Engined" — ≤60 chars. Overflow rule: drop "| Engined" only if the title alone is under 60 without it — never truncate the title itself.
META_DESC: 140–160 chars. Mandatory: primary code · condition · headline sub-models (2–3) · the Used price · "12-month warranty" or "UK delivery".
CANONICAL: https://engined.co.uk/engines/{primary-code-slug}/{group-slug}/ — absolute, trailing slash. State the exact filename/slug this page should be saved as, matching the canonical exactly.
OG_TITLE = META_TITLE · OG_DESC = META_DESC · OG_IMAGE: this listing's primary gallery image path (construct as {hub-slug}/{group-slug}-01.jpg if no image path is given in the row).

--- 2. PAGE CONTENT ---

<!-- SECTION:hero -->
## H1 — the row's Listing Title, verbatim, no modification. ≤75 chars.
SUB — 90–140 chars. Fixed pattern: "{Condition} {Primary code} engine for {headline sub-models from the row, ≤3 named + "and more" if the row covers more} — fixed price, tested before dispatch, UK delivery."
PRICE: Used price from the row, hardcoded, as the primary displayed price. Recon price from the row shown as a clearly labelled secondary option where both exist.
STOCK_STATUS: "In stock — ready to ship" (verbatim) unless the row indicates recon-only/thin supply, in which case "Prepared to order" (verbatim).
BUY_BUTTON: "Buy it now" (verbatim).
IMG_ALT: 70–110 chars; primary code + this application's specific configuration + honest description.
<!-- /SECTION:hero -->

<!-- SECTION:fits-these-vehicles -->
## H2 ≤50 chars, pattern "Fits These Vehicles"
INTRO: 80–140 chars, one sentence, must include a reg-checker confirmation prompt.
LIST: the row's Compatible Models field, formatted as a scannable list: {Model} {Chassis} ({Variant}) {Years}.
<!-- /SECTION:fits-these-vehicles -->

<!-- SECTION:included -->
## H2 ≤50 chars, pattern "What's Included"
### "Included" / ### "Not included" — the two standard lists (5 + 4 items): complete engine assembly, tested-before-dispatch, warranty as standard, [3 more standard inclusion items] / turbocharger (if reusable, per condition), injectors/fuel system, ancillaries, fitting and installation. Use these standard lists exactly as established across every hub page — do not invent a different list per listing.
<!-- /SECTION:included -->

<!-- SECTION:cta -->
CTA_LINE: ≤120 chars — "Buy this {Primary code} engine now, or [view the full {Primary code} engine range]({parent hub URL}) for other applications."
BUY_BUTTON: "Buy it now" (verbatim, repeated from hero).
CROSS_LINK: text "← Back to all {Primary code} engines", links to the parent hub page.
<!-- /SECTION:cta -->

--- 3. JSON-LD SCHEMA (complete, ready-to-paste, zero manual edits) ---

Output exactly TWO blocks. Every value filled in from the attached row — zero {brackets} left in the delivered schema.

**Block 1 — BreadcrumbList:**
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://engined.co.uk" },
    { "@type": "ListItem", "position": 2, "name": "Engines", "item": "https://engined.co.uk/engines" },
    { "@type": "ListItem", "position": 3, "name": "{Hub display name}", "item": "https://engined.co.uk/engines/{primary-code-slug}" },
    { "@type": "ListItem", "position": 4, "name": "{Listing Title}", "item": "https://engined.co.uk/engines/{primary-code-slug}/{group-slug}" }
  ]
}
```

**Block 2 — Product:**
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://engined.co.uk/engines/{primary-code-slug}/{group-slug}/#product",
  "name": "{H1, verbatim}",
  "brand": { "@type": "Brand", "name": "{Primary Brand}" },
  "manufacturer": { "@id": "https://engined.co.uk/#organization" },
  "sku": "{SKU from the row, exactly}",
  "category": "Reconditioned & Used Engines",
  "url": "https://engined.co.uk/engines/{primary-code-slug}/{group-slug}/",
  "offers": {
    "@type": "Offer",
    "url": "https://engined.co.uk/engines/{primary-code-slug}/{group-slug}/",
    "priceCurrency": "GBP",
    "price": "{Used price, digits only, no £ symbol, no commas}",
    "priceValidUntil": "SET-AT-DEPLOY",
    "availability": "https://schema.org/InStock",
    "itemCondition": "https://schema.org/UsedCondition",
    "seller": { "@id": "https://engined.co.uk/#organization" },
    "areaServed": { "@type": "Country", "name": "United Kingdom" },
    "hasMerchantReturnPolicy": {
      "@type": "MerchantReturnPolicy",
      "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
      "merchantReturnDays": 14,
      "returnMethod": "https://schema.org/ReturnByMail",
      "returnFees": "https://schema.org/FreeReturn",
      "applicableCountry": "GB"
    },
    "warranty": {
      "@type": "WarrantyPromise",
      "durationOfWarranty": { "@type": "QuantitativeValue", "value": 12, "unitCode": "MON" }
    }
  },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "Engine Code", "value": "{Primary Code}" },
    { "@type": "PropertyValue", "name": "Fuel Type", "value": "{Fuel}" },
    { "@type": "PropertyValue", "name": "Production Years", "value": "{Years from row}" },
    { "@type": "PropertyValue", "name": "Chassis Codes Covered", "value": "{comma-separated chassis list from row}" }
  ]
}
```

If the row also has a genuine Reconditioned price, add a second, separate Product block for the Reconditioned variant using the same structure with `"itemCondition": "https://schema.org/RefurbishedCondition"`, `"price"` set to the Recon figure, and `"@id"` suffixed `-recon`.

**Deliberately NOT included at this stage, per instruction:** Organization details, AggregateRating, site-wide WebSite schema, or any other page's data. Those are handled once, dynamically, site-wide, elsewhere — this prompt only ever emits the two (or three, with a Recon variant) blocks above, referencing the Organization by `@id` only, never redefining it.

--- 4. VALIDATION CHECKLIST (final lines, each PASS/FAIL) ---
[ ] Metas + canonical appear FIRST, before any content section
[ ] Title ≤60 · Desc 140–160
[ ] Canonical slug matches the row's slug exactly, trailing slash present
[ ] H1 matches the row's Listing Title verbatim
[ ] Used price and Recon price (if present) both hardcoded, zero placeholder text anywhere
[ ] Compatible Models list matches the row exactly — no additions, no omissions
[ ] Both JSON-LD blocks parse as valid standalone JSON (no trailing commas, straight quotes, no HTML entities, absolute URLs)
[ ] No AggregateRating, no Organization redefinition — @id reference only
[ ] Zero banned vocabulary (diagnostic-lane or quote-lane terms)
[ ] SKU matches the row exactly
Any FAIL: fix and re-output before delivering.

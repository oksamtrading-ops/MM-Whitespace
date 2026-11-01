# Q4 2026: stage evidence found by hand, 1 November 2026

The publish gate wants stage evidence for 95% of the period: 331 of 348.
Research and review left it at 321. These 15 companies had none, because their
filings could not be fetched (403s, bot checks, hosts the fetcher does not
allow) or because research found nothing to read. Each was found by hand on
the company's own website, its investor-relations file host, or SEC EDGAR.
Each quote was downloaded again and matched against the document. No SEDAR+
and no aggregators were used.

A stage override in review stores the stages and not their source, so this
file is the citation for each one.

Flags follow the extraction rubric (src/lib/enrich/live.ts): production means
commercial production declared, or revenue from mining. Development means a
construction decision or a feasibility-stage project. A flag is set only where
the document supports it. Flags below the most advanced one do not change the
tier.

| Company | Stages | Quote | Source |
|---|---|---|---|
| Discovery Silver Corp. (now Discovery Mining Ltd.) | production + exploration | "Discovery is advancing plans to more than double annual gold production through investment in the Company's Porcupine assets, which include multiple operations, attractive growth projects and significant exploration upside…" | [Q2 2026 results release, 13 Aug 2026](https://s21.q4cdn.com/713783313/files/doc_financials/2026/q2/PR-Q2-2026-Results-Post-Board-Draft-August-12-2026-REV3.pdf) |
| Westgold Resources Limited | production + exploration | "The Company produced a record 387,354oz during FY26, with strong contributions from both the Murchison and Southern Goldfields operations." | [FY26 Financial Results Summary, 28 Aug 2026](https://hermes-cdn.investorhub.com/announcement-pdfs/asx/7707048.pdf?v=63955089786) |
| Luca Mining Corp. | production + exploration | "Luca is a polymetallic producer, producing gold, silver, copper, zinc and lead, and is focused on the operation, development, exploration and acquisitions of mineral resource properties in North America." | [Q2 2026 MD&A, 14 Aug 2026](https://lucamining.com/wp-content/uploads/2026/08/Luca-Q2-2026-MDA_Final.pdf) |
| Majestic Gold Corp. | production + exploration | "Majestic Gold Corp. is a Vancouver, Canada-based gold mining company with mining operations in China as well as exploration and evaluation properties held directly in China and Canada." | [Q2 2026 MD&A, 30 Aug 2026](https://majesticgold.com/site/assets/files/4580/mda_fy2026_q2_final.pdf) |
| SouthGobi Resources Ltd. | production + exploration | "The Company is an integrated coal mining, development and exploration company with 847 employees, including 732 Mongolian employees, as at December 31, 2025" | [AIF 2025, 27 Mar 2026](https://southgobi.com/download/AIF_Final_2025.pdf) |
| Montage Gold Corp. | development + exploration | "The oxide circuit is expected to reach commercial production in Q4-2026, while construction of the hard-rock comminution circuit remains on budget and on track for completion in Q2-2027." | [First gold pour release, 27 Sep 2026](https://www.montagegold.com/_resources/news/2026/20260927_Montage-Gold-Announces-First-Gold-Pour-at-the-Kon%C3%A9-Mine.pdf) |
| Sandfire Resources America Inc. | development + exploration | "Sandfire Resources America Inc. (TSX.V SFR.V) was incorporated on July 30, 1998 under the laws of British Columbia and is a mining exploration and development company." | [Annual MD&A to 30 Jun 2026, 10 Sep 2026](https://wp-sandfireamerica-2023.s3.ca-central-1.amazonaws.com/media/2026/09/Sandfire-Resources-America-Inc.-MDA-6-30-26.pdf) |
| Solitario Resources Corp. | exploration | "Solitario Resources Corp. ("Solitario," or the "Company") is an exploration stage company as defined by rules issued by the United States Securities and Exchange Commission ("SEC")." | [10-Q to 30 Jun 2026, SEC EDGAR](https://www.sec.gov/Archives/edgar/data/917225/000165495426007347/xpl_10q.htm) |
| Snowline Gold Corp. | exploration | "Snowline is a Yukon Territory focused gold exploration company with an eight-project portfolio covering roughly 360,000 hectares (3,600 km2)." | [AIF 2025, 25 Mar 2026](https://cdn.prod.website-files.com/68a4efe604ec81b5bb8528eb/69c5a33bbd36e78889bc975b_Snowline%20Dec%2031%202025%20AIF%20Final.pdf) |
| Tudor Gold Corp. | exploration | "The Company is a mineral exploration company engaged in the acquisition, exploration and development of mineral resource properties in Canada." | [Q2 2026 MD&A, 13 Aug 2026](https://wp-tudorgold-2025.s3.ca-central-1.amazonaws.com/media/2026/08/Q2-2026-MDA.pdf) |
| Southern Cross Gold Consolidated Ltd. | exploration | "Southern Cross Gold Consolidated Ltd (TSX: SXGC, ASX: SX2) is exploring for epizonal gold in the Victorian goldfields." | [Corporate overview page](https://www.southerncrossgold.com/corporate/corporate-overview) |
| Copper Fox Metals Inc. | exploration | "As an exploration company, Copper Fox has no regular cash in-flow from operations, and the extent of its operations is principally a function of the availability of capital resources." | [Q3 2026 MD&A, 21 Sep 2026](https://www.copperfoxmetals.com/financials/2026-q3-mda.pdf) |
| Vizsla Copper Corp. | exploration | "The Company is in the exploration stage and therefore has no cash flow from operations." | [Q3 2026 MD&A, 27 Mar 2026](https://vizslacopper.com/wp-content/uploads/2026/04/MDA_Jan-31-2022_Q3-2026.pdf) |
| FireFly Metals Ltd. | exploration | "The principal activities of the Group during the year consisted of mineral exploration and evaluation at the Green Bay Copper-Gold Project in Newfoundland and Labrador, Canada, and the Limestone Well Vanadium-Titanium Project in Western Australia." | [Annual Report 2026, 20 Oct 2026](https://fireflymetals.com.au/wp-content/uploads/2026/10/Annual-Report-2026.pdf) |
| Revival Gold Inc. | exploration | "The Company is advancing development of the Mercur Gold Project in Utah ("Mercur") and conducting exploration at the Beartrack-Arnett Gold Project located in Idaho ("Beartrack-Arnett")." | [Annual MD&A to 30 Jun 2026, 23 Oct 2026](https://revival-gold.com/wp-content/uploads/2026/10/MDA-Q4-2026-June-30-2026-FINAL.pdf) |

## Judgment calls

- **Montage Gold.** It poured its first gold on 26 September 2026 but has not
  declared commercial production or reported revenue. That makes it
  development, not production, until it does.
- **FireFly Metals.** Its definitive feasibility study is under way, due Q1
  2027, and the only completed study is a PEA. That makes it exploration, not
  development.
- **Revival Gold.** It calls itself a mine developer. Beartrack-Arnett has a
  pre-feasibility study and Mercur a PEA, with no feasibility study and no
  construction decision. That makes it exploration under the rubric.
- **SouthGobi and Discovery.** Both have studies that could support
  development (Soumber's PFS, Cordero's feasibility study). Neither quote
  names them, and production decides the tier either way.

## Not found

- **Summit Royalties** and **GR Silver.** Every page is behind bot protection
  (Akamai, Cloudflare). Neither has an EDGAR filing that states a stage.
  Search results say Summit is a royalty and streaming company, but no
  document was read to confirm it.
- **Centauri** is held in review on a news headline.
- **Not yet researched:** Amapá, Cadillac, Copper Giant, Fitzroy, Irruptive,
  Libertystream, Nevgold, Rev and Trident.

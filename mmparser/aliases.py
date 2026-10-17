"""Explicit alias tables. Never edit distance -- see docs/design/04.

Every entry here was observed in the real workbooks. Where a spelling is a
presumed correction rather than a confirmed one it is marked, because
docs/decisions/QUESTIONS-PACK.md Appendix A asks Kay to confirm two of them.
"""
from __future__ import annotations

# --- headers -------------------------------------------------------------
# Keyed by the step-7 slug, mapping the divergent spelling onto a canonical
# slug. Steps 2-7 already fold newlines, trailing spaces, case, "Sub Sector"
# vs "Sub-Sector" and "Fees in CAD " vs "Fees in CAD"; only genuinely
# different wordings need to appear here.
HEADER_ALIASES = {
    "marketcap (in cad)": "market cap (cad)",
    "market capitalization (cad $)": "market cap (cad)",
    "market cap (c$)": "market cap (cad)",
    "number of months in trading data": "number of months of trading data",
    "interlisted i": "interlisted",
    "cpc former cpc": "former cpc",
    "s&p tsx venture composite index": "index membership",
    "s&p tsx index": "index membership",
    "royalty streaming": "royalty streaming",
    "hq location": "ho location",
    "hq region": "ho region",
}

# --- auditor firms -------------------------------------------------------
BIG_FOUR = "big_four"
NATIONAL = "national"
REGIONAL = "regional"

# canonical name -> class. Class is a property of the FIRM, never of the
# column the value landed in: MNP appears once in the Big-4 column and nine
# times in the Others column, and is a national firm in both.
FIRM_CLASS = {
    "Deloitte": BIG_FOUR,
    "PwC": BIG_FOUR,
    "KPMG": BIG_FOUR,
    "Ernst & Young": BIG_FOUR,
    "BDO": NATIONAL,
    "Grant Thornton": NATIONAL,
    "MNP": NATIONAL,
    "Davidson & Company": REGIONAL,
    "McGovern Hurley": REGIONAL,
    "Crowe MacKay": REGIONAL,
    "Kingston Ross Pasnak": REGIONAL,
    "MS Partners": REGIONAL,
    "D+H Group": REGIONAL,
    "Zeifmans": REGIONAL,
    "Smythe": REGIONAL,
    "DNTW": REGIONAL,
}

# casefolded, whitespace-collapsed source value -> canonical firm name.
FIRM_ALIASES = {
    "deloitte": "Deloitte",
    "pwc": "PwC",
    "kpmg": "KPMG",
    "ernst & young": "Ernst & Young",
    "ey (ernst & young)": "Ernst & Young",
    "ey": "Ernst & Young",
    "bdo": "BDO",
    "grant thornton": "Grant Thornton",
    "mnp": "MNP",
    "davidson & company": "Davidson & Company",
    "mcgovern hurley": "McGovern Hurley",
    "crowe mackay": "Crowe MacKay",
    "kingston ross pasnak": "Kingston Ross Pasnak",
    "ms partners": "MS Partners",
    "d+h group": "D+H Group",
    "zeifmans": "Zeifmans",
    "smythe": "Smythe",
    "dntw": "DNTW",
}

# "Other" is not a firm. It records "audited by someone outside the Big 4,
# not named" and must never be counted as an eleventh firm or folded into
# unknown -- the two mean different things on the cross-tab.
UNNAMED_OTHER = "__other_unnamed__"

# --- Canadian jurisdictions ---------------------------------------------
# Twelve jurisdictions, three of them territories. PE does not appear.
CANADA_SUBDIVISIONS = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba",
    "NB": "New Brunswick", "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia", "NT": "Northwest Territories", "NU": "Nunavut",
    "ON": "Ontario", "QC": "Quebec", "SK": "Saskatchewan", "YT": "Yukon",
    "PE": "Prince Edward Island",
}
CANADA_ALIASES = {"nwt": "NT", "yk": "YT", "que": "QC", "pei": "PE"}

US_STATES = {
    "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "IA",
    "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO",
    "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI",
    "WV", "WY",
}

# US states by code, spelled exactly as src/lib/publish/jurisdictions.ts
# spells them -- the copy EDGAR's head-office reading and the companies table
# both use. jurisdictions.test.ts reads this file and fails if they drift: a
# workbook head office spelled one way and a researched one another would be a
# false conflict on every US company.
US_STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# A head office's country, where the workbook abbreviates it.
# TSX writes a few countries as initials; TSX's August 2026 list has "UAE".
COUNTRY_NAMES = {"UK": "United Kingdom", "USA": "United States", "US": "United States",
                 "UAE": "United Arab Emirates"}

# The workbook's "HO Region" groups, and the country a subdivision code in
# each group belongs to. A code is read only against its region: WA is
# Washington under "USA" and would be Western Australia under
# "Australia/NZ/PNG", and nothing about the two letters says which.
_REGION_COUNTRY = {"canada": "Canada", "usa": "United States"}


def normalise_head_office(location, region):
    """The workbook's head office as head_office_region writes it.

    "ON" + "Canada" -> "Ontario, Canada"; "CO" + "USA" -> "Colorado, United
    States"; "Chile" + "Latin America" -> "Chile"; "UK" -> "United Kingdom".
    The same form EDGAR and research produce, so the workbook value and a
    researched one compare as equals in review.

    Returns (value, problem). A code its region does not explain is a problem
    and no value: a head office guessed wrong is worse than one left for
    research to find.
    """
    loc = (location or "").strip() if isinstance(location, str) else location
    reg = (region or "").strip().lower() if isinstance(region, str) else ""
    if loc in (None, ""):
        return None, None
    loc = str(loc).strip()
    country = _REGION_COUNTRY.get(reg)
    code = loc.upper()
    if country == "Canada":
        if code in CANADA_SUBDIVISIONS:
            return "%s, Canada" % CANADA_SUBDIVISIONS[code], None
        alias = CANADA_ALIASES.get(loc.lower())
        if alias:
            return "%s, Canada" % CANADA_SUBDIVISIONS[alias], None
        return None, "%r is not a Canadian province or territory, but its region says Canada" % loc
    if country == "United States":
        if code in US_STATE_NAMES:
            return "%s, United States" % US_STATE_NAMES[code], None
        return None, "%r is not a US state, but its region says USA" % loc
    # Outside Canada and the US the workbook names the country itself. A bare
    # two-letter code here is a subdivision with no country to read it against.
    if len(loc) <= 3 and code not in COUNTRY_NAMES:
        return None, "%r looks like a subdivision code, but its region (%s) names no country to read it in" % (loc, region)
    return COUNTRY_NAMES.get(code, loc), None


# Codes meaning different jurisdictions depending on the region column they
# sit in. Resolve using location AND region together, never the code alone.
AMBIGUOUS_CODES = {"ON", "NB", "NS", "MB", "SK", "NT", "NU", "AB", "BC", "QC",
                   "NL", "YT"} & US_STATES

# --- foreign jurisdictions ----------------------------------------------
# Confirmed misspellings folded; two presumed ones flagged for confirmation.
FOREIGN_ALIASES = {
    "columbia": "Colombia",
    "cote d'ivoire": "Côte d'Ivoire",
    "cote divoire": "Côte d'Ivoire",
    "ethopia": "Ethiopia",
    "turkiye": "Türkiye",
    "drc": "Democratic Republic of the Congo",
    "usa": "United States",
    "uk": "United Kingdom",
    "png": "Papua New Guinea",
}
# Presumed, not confirmed. Applied but reported in the validation warnings so
# the assumption is visible rather than silent.
FOREIGN_ALIASES_PRESUMED = {
    "sambia": "Zambia",
    "botawana": "Botswana",
}

REGION_COLUMNS = ["AFRICA", "ASIA", "AUS/NZ/PNG", "CANADA",
                  "LATIN AMERICA", "OTHER", "UK/EUROPE", "USA"]
ABROAD_COLUMNS = [c for c in REGION_COLUMNS if c != "CANADA"]

# --- commodities ---------------------------------------------------------
# The flag columns present on both extract tabs.
COMMODITY_FLAGS = [
    "Oil and Gas", "Gold", "Silver", "Copper", "Nickel", "Diamond",
    "Molybdenum", "Platinum/PGM", "Iron", "Lead", "Zinc", "Rare Earths",
    "Potash", "Lithium", "Uranium", "Coal", "Tungsten",
    "Base & Precious Metals",
]


def canonical_firm(value):
    """Returns (canonical_name, firm_class) or (UNNAMED_OTHER, None) or None.

    `value` must already have been trimmed and sentinel-checked.
    """
    key = " ".join(str(value).split()).casefold()
    if key == "other":
        return UNNAMED_OTHER, None
    name = FIRM_ALIASES.get(key)
    if name is None:
        return None
    return name, FIRM_CLASS.get(name)

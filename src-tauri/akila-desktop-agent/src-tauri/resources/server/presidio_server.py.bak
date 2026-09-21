"""
AKILA Privilege Guard — Local Sanitization Server (Enhanced)
=============================================================
Runs on your own machine at http://127.0.0.1:5001
Never sends anything anywhere except back to your browser extension.

Detection stack:
  Layer 1 — Presidio built-in entities (activated)
  Layer 2 — Kenya-specific custom recognizers (10 new)
  Layer 3 — en_core_web_lg NER model
  Layer 4 — False positive suppression (deny list, UUID filter, min lengths)
  Layer 5 — Expanded Kenyan names list (150+ surnames)
  Layer 6 — Span deduplication + collision resolution
"""

import hashlib
import re
import secrets
import threading
import time
from collections import defaultdict

from flask import Flask, request, jsonify
from flask_cors import CORS
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider

app = Flask(__name__)

# CORS: only allow the AKILA extension to call this server.
# This ID is pinned for every install by the "key" field in the extension's
# manifest.json, so ALL pilot partners share the same extension ID and this
# value does not need to be edited per machine.
EXTENSION_ID = "kcnldfeclciolmbjfiomdfialhbccmhe"
CORS(app, origins=[f"chrome-extension://{EXTENSION_ID}"])

# ===========================================================================
# LAYER 3: NLP Engine — en_core_web_lg for better PERSON/ORG detection
# ===========================================================================

provider = NlpEngineProvider(nlp_configuration={
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
})
nlp_engine = provider.create_engine()

# ===========================================================================
# LAYER 1 + 4: Analyzer with all built-in entities + custom recognizers
# ===========================================================================

# All Presidio built-in entities we want active:
BUILTIN_ENTITIES = [
    "PERSON", "LOCATION", "ORGANIZATION", "DATE_TIME",
    "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD",
    "IP_ADDRESS", "IBAN_CODE", "CRYPTO", "MAC_ADDRESS",
    "MEDICAL_LICENSE", "US_SSN", "US_PASSPORT", "US_DRIVER_LICENSE",
    "URL", "NRP",
]

# Custom entities we add (not built into Presidio):
CUSTOM_ENTITIES = [
    "LEGAL_CASE_NUMBER", "LEGAL_PRIVILEGE_MARKER", "LEGAL_BATES_NUMBER",
    "KE_NATIONAL_ID", "KE_KRA_PIN", "KE_PASSPORT", "KE_DRIVING_LICENCE",
    "KE_MPESA_CODE", "KE_NHIF_NUMBER", "KE_NSSF_NUMBER", "KE_LAND_PARCEL",
    "KE_VEHICLE_PLATE", "KE_COMPANY_REG",
]

ALL_ENTITIES = BUILTIN_ENTITIES + CUSTOM_ENTITIES

analyzer = AnalyzerEngine(nlp_engine=nlp_engine)

# ---------------------------------------------------------------------------
# Layer 2: Kenya-specific custom recognizers
# ---------------------------------------------------------------------------

# 2a. Kenyan National ID (7-8 digits, context-required)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_NATIONAL_ID",
    patterns=[Pattern(name="ke_national_id", regex=r"\b\d{7,8}\b", score=0.5)],
    context=["national id", "id number", "id no", "identity", "nida",
             "citizen", "id card", "national identification", "id"],
))

# 2b. KRA PIN (A000000000B format — very specific, low FP risk)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_KRA_PIN",
    patterns=[Pattern(name="ke_kra_pin", regex=r"\b[A-Z]\d{9}[A-Z]\b", score=0.9)],
    context=["kra", "pin", "tax", "itax", "revenue", "vat", "paye"],
))

# 2c. Kenyan Passport Number (A/B + 7 digits, or 2 letters + 6 digits)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_PASSPORT",
    patterns=[
        Pattern(name="ke_passport_new", regex=r"\b[AB]\d{7}\b", score=0.85),
        Pattern(name="ke_passport_old", regex=r"\b[A-Z]{2}\d{6}\b", score=0.7),
    ],
    context=["passport", "travel document", "immigration", "visa", "border"],
))

# 2d. Kenyan Driving Licence (DL + 8-10 digits)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_DRIVING_LICENCE",
    patterns=[Pattern(name="ke_dl", regex=r"\bDL\d{8,10}\b", score=0.9)],
    context=["driving licence", "driver", "ntsa", "license", "dl number"],
))

# 2e. M-Pesa Transaction Code (10 alphanumeric, specific structure)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_MPESA_CODE",
    patterns=[
        Pattern(name="ke_mpesa_tight", regex=r"\b[A-Z]{2}\d{2}[A-Z0-9]{6}\b", score=0.85),
        Pattern(name="ke_mpesa_fallback", regex=r"\b[A-Z0-9]{10}\b", score=0.4),
    ],
    context=["mpesa", "m-pesa", "safaricom", "transaction", "confirmed",
             "payment", "receipt", "till", "paybill", "lipa"],
))

# 2f. NHIF Number (8-9 digits, context-required)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_NHIF_NUMBER",
    patterns=[Pattern(name="ke_nhif", regex=r"\b\d{8,9}\b", score=0.5)],
    context=["nhif", "health insurance", "national hospital", "insurance fund"],
))

# 2g. NSSF Number (6 digits, context-required)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_NSSF_NUMBER",
    patterns=[Pattern(name="ke_nssf", regex=r"\b\d{6}\b", score=0.5)],
    context=["nssf", "pension", "social security", "retirement", "provident fund"],
))

# 2h. Land Parcel / LR Number
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_LAND_PARCEL",
    patterns=[
        Pattern(name="ke_lr_slash", regex=r"\bLR\.?\s*(?:No\.?\s*)?\d{1,6}/\d{1,6}\b", score=0.92),
        Pattern(name="ke_lr_dash", regex=r"\bLR\.?\s*(?:No\.?\s*)?\d{1,6}-\d{1,6}\b", score=0.88),
    ],
    context=["land", "parcel", "title", "registered", "plot", "lr",
             "property", "deed", "conveyance"],
))

# 2i. Kenyan Vehicle Registration Plate
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_VEHICLE_PLATE",
    patterns=[
        Pattern(name="ke_plate", regex=r"\bK[A-HJ-NP-Z]{2}\s?\d{3}[A-HJ-NP-Z]\b", score=0.9),
        Pattern(name="ke_plate_gk", regex=r"\bGK\s+K[A-HJ-NP-Z]{2}\s?\d{3}[A-HJ-NP-Z]\b", score=0.95),
    ],
    context=["vehicle", "car", "plate", "registration", "motor",
             "chassis", "ntsa", "logbook"],
))

# 2j. Kenyan Company Registration Number
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="KE_COMPANY_REG",
    patterns=[
        Pattern(name="ke_cpr", regex=r"\b(?:CPR|BN|PVT|NGO|CBO)/\d{4}/\d{3,6}\b", score=0.92),
        Pattern(name="ke_cpr_short", regex=r"\b(?:CPR|BN|PVT)/\d{4,9}\b", score=0.8),
    ],
    context=["company", "registration", "registrar", "cpo", "business",
             "incorporated", "limited"],
))

# 2k. Title-prefixed name pattern — catches informal name references
# spaCy's NER sometimes misses ("Adv. Otieno", "Dr. Wanjiru"). Kept
# deliberately narrow: titles like "Dr."/"Advocate" essentially never
# appear in structural JSON fields (unlike the broader recursive-scan
# approach that corrupted message "id" / timezone fields earlier), so
# this is safe to run always-on. Overlaps with spaCy's own PERSON spans
# are resolved downstream by deduplicate_spans() — highest-confidence
# (and here, longest) span wins.
#
# NOTE: Presidio compiles patterns with re.IGNORECASE, so a plain
# [A-Z][a-z]+ name group silently matches lowercase words too and the
# greedy tail swallowed the token AFTER the name ("Adv. Otieno
# references" instead of "Adv. Otieno"). The (?-i:) groups restore
# case-sensitivity for exactly the name portion.
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="PERSON",
    patterns=[Pattern(
        name="title_name_pattern",
        regex=r"(?-i:\b(?:Mr|Mrs|Ms|Dr|Prof|Advocate|Adv|Atty)\.?)(?:\s+(?-i:[A-Z][a-z]+)){1,2}\b",
        score=0.65,
    )],
))

# ---------------------------------------------------------------------------
# Layer 2 (continued): Legal-specific custom recognizers
# ---------------------------------------------------------------------------

# Legal case number (tightened — exclude common state abbreviations)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="LEGAL_CASE_NUMBER",
    patterns=[Pattern(
        name="case_number_pattern",
        regex=r"\b(?:HCCC|ELC|CR|CIV|MC|SC)[-\s]?\d{2,6}[-\s]?(?:OF)?[-\s]?\d{2,4}\b",
        score=0.85,
    )],
    context=["case", "matter", "suit", "court", "civil", "criminal", "filed"],
))

# Legal privilege marker
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="LEGAL_PRIVILEGE_MARKER",
    patterns=[Pattern(
        name="privilege_marker_pattern",
        regex=r"\b(?:ATTORNEY[- ]CLIENT PRIVILEGED?|WORK PRODUCT|PRIVILEGED AND CONFIDENTIAL)\b",
        score=0.95,
    )],
))

# Legal bates number (tightened — context-required, deny list for tech prefixes)
analyzer.registry.add_recognizer(PatternRecognizer(
    supported_entity="LEGAL_BATES_NUMBER",
    patterns=[Pattern(
        name="bates_pattern",
        regex=r"\b[A-Z]{2,6}[-_]?\d{4,10}\b",
        score=0.6,  # context boost raises it to ~0.95; bare match stays 0.6
    )],
    context=["bates", "exhibit", "document", "ref", "reference",
             "page", "doc", "stamp"],
    deny_list=["API", "URL", "HTTP", "HTTPS", "UUID", "SHA", "MD5",
               "AES", "RSA", "UTF", "ISO", "GET", "POST", "PUT",
               "DELETE", "PATCH", "HTML", "CSS", "JSON", "XML",
               "SQL", "FTP", "SSH", "DNS", "TCP", "UDP", "IPV4",
               "IPV6", "ASCII", "BASE64"],
))

# ===========================================================================
# LAYER 4: False positive suppression
# ===========================================================================

# 4a. Global deny list — strings that match patterns but are never PII
DENY_LIST = {
    # Structural values caught as PERSON by NER
    "user", "assistant", "system", "human", "model", "bot",
    "primary_assistant", "default", "enabled", "disabled",
    # Boolean/null values
    "true", "false", "null", "none", "auto", "text",
    # Encoding/format strings
    "utf-8", "utf8", "utf-16",
    # IANA timezone strings caught as LOCATION
    "africa/nairobi", "utc", "gmt", "america/new_york",
    "europe/london", "asia/tokyo", "utc+3",
    # Partial timezone fragments
    "africa", "america", "europe", "asia", "australia",
    "pacific", "atlantic", "indian", "arctic",
    # Legal/doc structural terms caught as ORG
    "plaintiff", "respondent", "appellant", "petitioner", "defendant",
    "claimant", "witness", "beneficiary",
    # Code/API values
    "version", "v1", "v2", "v3", "api", "get", "post", "put",
    "delete", "patch", "options", "head",
    # Common UI labels
    "send", "submit", "cancel", "confirm", "save", "delete",
    "edit", "close", "open", "ok", "yes", "no",
    # Common words falsely detected as PERSON by NER
    "email", "phone", "address", "number", "name", "date",
    "file", "image", "photo", "document", "message", "chat",
    "hello", "hi", "hey", "thanks", "thank", "please",
    # Numeric/code values falsely detected as DATE_TIME (short values only)
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "10", "11", "12", "100", "200", "300", "400", "500",
    "1000", "2000", "3000", "4000", "5000", "10000",
    # Tech/code values that match various patterns
    "v1", "v2", "v3", "r1", "r2", "r3",
    "get1", "set1", "run1", "test1", "item1",
}

# 4b. UUID pattern — suppress UUIDs misfiring as DATE_TIME
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# 4c. Minimum length guards per entity type
MIN_LENGTHS = {
    "PERSON": 4,
    "ORGANIZATION": 5,
    "LOCATION": 4,
    "DATE_TIME": 5,
    "KE_NATIONAL_ID": 7,
    "KE_NSSF_NUMBER": 6,
    "KE_MPESA_CODE": 10,
    "LEGAL_BATES_NUMBER": 6,
}

# 4d. Bates number deny prefixes — known non-bates strings
BATES_DENY_PREFIXES = frozenset({
    "API", "URL", "HTTP", "HTTPS", "UUID", "SHA", "MD5",
    "AES", "RSA", "UTF", "ISO", "GET", "POST", "PUT",
    "DELETE", "PATCH", "HTML", "CSS", "JSON", "XML",
    "SQL", "FTP", "SSH", "DNS", "TCP", "UDP",
    "GO1", "AB5", "AB1", "AB2", "AB3", "AB4", "AB6", "AB7", "AB8", "AB9",
    "TC1", "TB1", "RJ2", "V1", "V2", "V3", "R1", "R2", "R3",
})

# ===========================================================================
# LAYER 5: Expanded Kenyan names list (150+ surnames)
# ===========================================================================

KENYAN_SURNAMES = {
    # Kikuyu
    "kamau", "njoroge", "kariuki", "mwangi", "wanjiku", "wairimu", "njeri",
    "nyambura", "maina", "ndungu", "gichuki", "kimani", "wangui", "karanja",
    "gathoni", "wacera", "muturi", "nyoro", "kihara", "mugo", "wambui",
    "nyokabi", "muthoni", "gicobi", "ngugi", "irungu", "karanja",
    # Luo
    "odhiambo", "ochieng", "otieno", "anyango", "adhiambo", "auma",
    "onyango", "ogola", "oluoch", "owino", "okello", "aoko", "awino",
    "odera", "ogada", "okoth", "ocholla", "obiri", "omollo",
    # Luhya
    "wafula", "wekesa", "simiyu", "barasa", "wasike", "khisa", "muyuka",
    "mukhwana", "muliro", "shitanda", "nandwa", "wanyama", "masinde",
    "wakhungu", "busienei", "makhanu",
    # Kalenjin
    "kiplangat", "kiprop", "kiptoo", "chebet", "cherono", "rotich",
    "korir", "bett", "mutai", "kibet", "chepkoech", "yego", "kimutai",
    "rono", "kipchoge", "keino", "tuiyot", "bwambale",
    # Kamba
    "mutua", "musyoka", "mwanzia", "mulei", "ndeti", "mutiso", "kioko",
    "munyao", "makau", "muthini", "kilonzo", "malila", "kyalo",
    # Somali / Northern
    "abdi", "mohamed", "hassan", "ahmed", "farah", "ali", "omar",
    "ibrahim", "jama", "aden", "hersi", "idleh", "abdirahman",
    # Kisii
    "onchiri", "ongaki", "nyambane", "nyakundi", "omwenga", "moturi",
    "ogendi", "kenyanyari", "maube",
    # Meru
    "mutuma", "muriungi", "muriithi", "gitari", "karinga", "kabii",
    # Coastal / Swahili
    "mwamba", "juma", "hamisi", "rashid", "bakari", "salim",
    "khamis", "mselem", "mtwana", "chengo",
    # Asian-Kenyan
    "patel", "shah", "mehta", "desai", "kapoor", "singh",
    "ramji", "thakkar", "chandaria",
    # Trans-Nzoia / Mt. Elgon
    "wafubwa", "masai", "weyatwa", "naliaka",
    # Maasai
    "saitoti", "keeku", "ntutu", "sakuda", "olonana",
    # Turkana / Pokot
    "ekiru", "ekai", "locham", "losike",
}

# ===========================================================================
# LAYER 6: Token vault — memory only, TTL expiry, no disk writes
# ===========================================================================

VAULT = {}  # token -> (original_value, expiry_timestamp)
VAULT_LOCK = threading.Lock()
TTL_SECONDS = 300
SALT = secrets.token_hex(16)  # regenerated every server restart


def make_token(entity_type: str, original_value: str) -> str:
    digest = hashlib.sha256((SALT + entity_type + original_value).encode()).hexdigest()[:8]
    return f"<AKILA_{entity_type}_{digest}>"


def vault_cleanup_loop():
    while True:
        time.sleep(30)
        now = time.time()
        with VAULT_LOCK:
            expired = [t for t, (_, exp) in VAULT.items() if exp < now]
            for t in expired:
                del VAULT[t]


threading.Thread(target=vault_cleanup_loop, daemon=True).start()


# ===========================================================================
# LAYER 6 (continued): Span deduplication + collision resolution
# ===========================================================================

def deduplicate_spans(spans, text):
    """
    Resolve overlapping and duplicate spans before token replacement.

    Strategy:
    1. Sort by score descending (highest confidence first)
    2. Custom entities (KE_*, LEGAL_*) take priority over generic entities
       when scores are equal
    3. Accept highest-priority spans first
    4. Skip spans that overlap with already-accepted spans
    5. CONTAINMENT: a span strictly contained inside another span loses to
       its container, regardless of score. Score-first greedy alone is not
       enough here: a context-boosted shorter match can outscore the real
       token. Real example — Bates regex matches "HCCC-1234" at 0.95
       (boosted by the word "reference" nearby), the case-number regex
       matches "HCCC-1234-2024" at 0.85. Score-first picks the short
       partial and the suffix "-2024" leaks out untokenized. The container
       is the more complete identification of the SAME text and must win.
       Same logic keeps "Adv. Otieno" winning over the bare "Otieno"
       spaCy/surname match contained inside it.
    """
    if not spans:
        return []

    # Drop spans that are strict substrings of another span, when the
    # container is a custom legal/KE entity, or both are the same entity
    # type (e.g. two PERSON recognizers flagging different grains of the
    # same name). The container identifies the same region more fully.
    spans = [s for s in spans if not any(
        o is not s
        and o.start <= s.start and s.end <= o.end
        and (o.end - o.start) > (s.end - s.start)
        and (o.entity_type.startswith(("KE_", "LEGAL_"))
             or o.entity_type == s.entity_type)
        for o in spans
    )]

    def span_priority(r):
        # Higher score first, then custom entities first, then longer spans
        is_custom = r.entity_type.startswith(("KE_", "LEGAL_"))
        return (-r.score, not is_custom, -(r.end - r.start))

    sorted_spans = sorted(spans, key=span_priority)

    accepted = []
    for span in sorted_spans:
        overlaps = False
        for acc in accepted:
            if span.start < acc.end and span.end > acc.start:
                overlaps = True
                break
        if not overlaps:
            accepted.append(span)

    return sorted(accepted, key=lambda r: r.start, reverse=True)


def filter_by_deny_list(spans, text):
    """Remove spans that match the global deny list or UUID pattern."""
    filtered = []
    for span in spans:
        value = text[span.start:span.end]

        # Skip deny-listed values
        if value.lower() in DENY_LIST:
            continue

        # Skip UUIDs
        if UUID_PATTERN.match(value):
            continue

        # Skip bates-number false positives (tech prefixes)
        if span.entity_type == "LEGAL_BATES_NUMBER":
            prefix = value[:3].upper()
            if prefix in BATES_DENY_PREFIXES:
                continue

        filtered.append(span)
    return filtered


def filter_by_min_length(spans, text):
    """Remove spans shorter than the minimum length for their entity type."""
    filtered = []
    for span in spans:
        value = text[span.start:span.end]

        # Skip purely numeric DATE_TIME detections (e.g. "123456" caught as a date)
        if span.entity_type == "DATE_TIME" and value.replace(" ", "").isdigit():
            continue

        min_len = MIN_LENGTHS.get(span.entity_type, 0)
        if len(value) < min_len:
            continue
        filtered.append(span)
    return filtered


def filter_by_context_confidence(spans, text):
    """
    Remove low-confidence spans that lack context words.
    Spans with score < 0.6 are only kept if context words exist nearby.
    Highly specific entity types (phone, email, credit card, etc.) are always kept.
    """
    # Entity types with highly specific patterns — always keep regardless of score
    ALWAYS_KEEP = {
        "PHONE_NUMBER", "EMAIL_ADDRESS", "EMAIL", "CREDIT_CARD",
        "IP_ADDRESS", "IBAN_CODE", "US_SSN", "US_PASSPORT",
        "CRYPTO", "URL",
        "KE_KRA_PIN", "KE_PASSPORT", "KE_DRIVING_LICENCE",
        "KE_VEHICLE_PLATE", "KE_COMPANY_REG", "KE_LAND_PARCEL",
        "LEGAL_PRIVILEGE_MARKER", "LEGAL_CASE_NUMBER",
    }

    # Entities that ONLY fire when clearly context-boosted (score > threshold)
    # Prevents bare pattern matches (e.g. "ABC-1234" with no context words)
    CONTEXT_BOOST_REQUIRED = {"LEGAL_BATES_NUMBER": 0.7, "KE_MPESA_CODE": 0.7}

    filtered = []
    lower_text = text.lower()
    for span in spans:
        # Apply stricter threshold for context-boost-required entities
        required = CONTEXT_BOOST_REQUIRED.get(span.entity_type, 0.6)
        if span.score >= required or span.entity_type in ALWAYS_KEEP:
            filtered.append(span)
            continue

        # For low-confidence spans, check context words in surrounding text
        pre_text = lower_text[max(0, span.start - 100):span.start]
        post_text = lower_text[span.end:min(len(lower_text), span.end + 100)]
        combined = pre_text + " " + post_text

        has_context = False
        entity_contexts = {
            "KE_NATIONAL_ID": ["national id", "id number", "identity", "id card", "nida", "citizen", "id"],
            "KE_NHIF_NUMBER": ["nhif", "health insurance", "national hospital"],
            "KE_NSSF_NUMBER": ["nssf", "pension", "social security", "retirement"],
            "LEGAL_BATES_NUMBER": ["bates", "exhibit", "document", "page", "stamp"],
            "KE_MPESA_CODE": ["mpesa", "m-pesa", "safaricom", "m-pesa confirmed",
                             "payment confirmed", "till number", "paybill"],
            "US_DRIVER_LICENSE": ["driving", "driver", "license", "dl", "dl#",
                                  "licence", "sv", "state vehicle"],
            "MEDICAL_LICENSE": ["medical", "license", "physician", "doctor", "deaconess"],
        }
        for etype, ctx_words in entity_contexts.items():
            if span.entity_type == etype:
                for cw in ctx_words:
                    if cw in combined:
                        has_context = True
                        break

        if has_context:
            filtered.append(span)
    return filtered


def enhance_names_with_kenyan_list(spans, text):
    """
    Layer 5: Supplement NER-detected names with Kenyan surname knowledge.
    If a word matches a known Kenyan surname, detect it as a PERSON even
    without the NER firing. Optimistic detection — privacy-first means
    over-detecting names is safer than under-detecting.
    Adjacent surname spans are merged into full-name spans.
    """
    used_positions = {(s.start, s.end) for s in spans}
    surname_spans = []

    # Find all occurrences of Kenyan surnames in the text
    for match in re.finditer(r"[A-Z][a-z]+", text):
        word = match.group(0)
        if word.lower() in KENYAN_SURNAMES:
            pos = (match.start(), match.end())
            if pos not in used_positions:
                surname_spans.append(type('Span', (), {
                    'start': pos[0],
                    'end': pos[1],
                    'entity_type': 'PERSON',
                    'score': 0.85,
                })())
                used_positions.add(pos)

    if not surname_spans:
        return spans

    # Merge adjacent surname spans into full names (e.g. "Kiprop" + "Korir")
    merged = []
    for span in sorted(surname_spans, key=lambda s: s.start):
        if merged and span.start <= merged[-1].end + 1:
            merged[-1] = type('Span', (), {
                'start': merged[-1].start,
                'end': span.end,
                'entity_type': 'PERSON',
                'score': 0.85,
            })()
        else:
            merged.append(span)

    return list(spans) + merged


def filter_version_strings(spans, text):
    """Remove version strings (e.g. 2.0.1, v2.0.1) falsely detected as dates."""
    VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$|^v\d+\.\d+", re.IGNORECASE)
    filtered = []
    for span in spans:
        value = text[span.start:span.end]
        if span.entity_type == "DATE_TIME":
            # Suppress generic time words (today, Friday, etc.)
            if value.strip().lower() in GENERIC_TIME_WORDS:
                continue
        if VERSION_PATTERN.match(value):
            continue
        filtered.append(span)
    return filtered


# Chinese/English single-word relative time terms — too generic to be PII
GENERIC_TIME_WORDS = {
    "today", "tomorrow", "yesterday", "now", "soon", "later",
    "monday", "tuesday", "wednesday", "thursday", "friday",
    "saturday", "sunday", "morning", "afternoon", "evening",
    "tonight", "weekend", "noon", "midnight",
}


# ===========================================================================
# The /analyze endpoint
# ===========================================================================

@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(force=True)
    text = data.get("text", "")

    if not text.strip():
        return jsonify({"sanitizedText": text, "tokenMap": {}})

    # Run Presidio analyzer with ALL entity types
    results = analyzer.analyze(
        text=text,
        language="en",
        entities=ALL_ENTITIES,
    )

    # Layer 4: Apply false positive suppression
    results = filter_by_deny_list(results, text)
    results = filter_by_min_length(results, text)
    results = filter_by_context_confidence(results, text)
    results = filter_version_strings(results, text)

    # Layer 5: Enhance names with Kenyan surname knowledge
    results = enhance_names_with_kenyan_list(results, text)

    # Layer 6: Deduplicate overlapping spans
    results = deduplicate_spans(results, text)

    # Sort by start position (descending) for backward replacement
    results = sorted(results, key=lambda r: r.start, reverse=True)

    # Replace spans with tokens (backward — preserves offsets)
    token_map = {}
    sanitized_text = text
    for r in results:
        original_value = text[r.start:r.end]
        if not original_value.strip():
            continue
        token = make_token(r.entity_type, original_value)
        token_map[token] = original_value
        sanitized_text = sanitized_text[:r.start] + token + sanitized_text[r.end:]

    # Store in vault
    now = time.time()
    with VAULT_LOCK:
        for token, original in token_map.items():
            VAULT[token] = (original, now + TTL_SECONDS)

    return jsonify({"sanitizedText": sanitized_text, "tokenMap": token_map})


@app.route("/health", methods=["GET"])
def health():
    with VAULT_LOCK:
        vault_size = len(VAULT)
    return jsonify({"status": "ok", "vault_size": vault_size})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)

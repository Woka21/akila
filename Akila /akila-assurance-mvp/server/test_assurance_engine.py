from assurance_engine import AssuranceEngine
def test_round_trip_and_stability():
 e=AssuranceEngine(); s="John john@example.com 0712345678"; a=e.assure_text("x",s); b=e.assure_text("x",s)
 assert a["sanitizedText"]==b["sanitizedText"]; assert e.restore_text("x",a["sanitizedText"])==s
def test_session_isolation():
 e=AssuranceEngine(); s=e.assure_text("a","john@example.com")["sanitizedText"]; assert e.restore_text("b",s)==s
def test_binary_fail_closed():
 e=AssuranceEngine(); assert e.assure_bytes("x","a.pdf","application/pdf",b"%PDF")["policy"]=="deny"

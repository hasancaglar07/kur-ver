from app.models import DonorRecord
from app.services.matching import ExtractedName, match_names, normalize_name


def test_normalize_name_turkish_chars() -> None:
    assert normalize_name("Çağrı Şimşek") == "CAGRI SIMSEK"
    assert normalize_name("  İsmail   öğüt ") == "ISMAIL OGUT"


def test_match_names_exact_and_fuzzy() -> None:
    donors = [
        DonorRecord(id=1, no="99", country="TR", city="A", region="R", first_name="Ahmet", last_name="Yilmaz", phone="1", source_batch_id="t"),
        DonorRecord(id=2, no="99", country="TR", city="A", region="R", first_name="Fatma", last_name="Demir", phone="2", source_batch_id="t"),
    ]

    extracted = [
        ExtractedName(full_name="Ahmet Yilmaz", source="audio"),
        ExtractedName(full_name="Fatmaa Demir", source="ocr"),
    ]

    results = match_names(donors, extracted, fuzzy_threshold=0.80)
    assert len(results) == 2
    assert any(x.match_type == "exact" and x.donor_id == 1 for x in results)
    assert any(x.match_type == "fuzzy" and x.donor_id == 2 for x in results)

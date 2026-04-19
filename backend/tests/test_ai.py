from app.models import DonorRecord
from app.services.ai import _extract_names_from_transcript, _extract_no_from_transcript, _merge_to_extracted_names
from app.services.matching import ExtractedName


def _donor(donor_id: int, no: str, first: str, last: str) -> DonorRecord:
    return DonorRecord(
        id=donor_id,
        no=no,
        country="ÇAD",
        city="KEDEV",
        region="1.BÖLGE",
        first_name=first,
        last_name=last,
        phone=f"555000{donor_id:04d}",
        source_batch_id="test",
    )


def test_extract_no_from_transcript() -> None:
    donors = [_donor(1, "99", "Ahmet", "Yilmaz")]
    transcript = "Bolge no 99 icin kesim yapiliyor."
    assert _extract_no_from_transcript(transcript, donors) == "99"


def test_extract_names_from_transcript_with_fuzzy() -> None:
    donors = [
        _donor(1, "99", "Ahmet", "Yilmaz"),
        _donor(2, "99", "Fatma", "Demir"),
    ]
    transcript = "Bugun Ahmet Yilmaz ve Fatmaa Demir isimleri okunmustur."
    names = _extract_names_from_transcript(transcript, donors, threshold=0.80)
    full_names = {item.full_name for item in names}

    assert "Ahmet Yilmaz" in full_names
    assert "Fatma Demir" in full_names


def test_merge_names_uses_transcript_and_ocr() -> None:
    donors = [
        _donor(1, "99", "Ahmet", "Yilmaz"),
        _donor(2, "99", "Fatma", "Demir"),
    ]
    transcript = "Ahmet Yilmaz bugun anons edildi."
    ocr = "Ekranda FATMA DEMIR ismi yaziyor"
    names = _merge_to_extracted_names(transcript, ocr, [], donors)
    full_names = {item.full_name for item in names}
    sources = {item.full_name: item.source for item in names}

    assert "Ahmet Yilmaz" in full_names
    assert "Fatma Demir" in full_names
    assert sources["Ahmet Yilmaz"] in {"audio", "both"}
    assert sources["Fatma Demir"] in {"ocr", "both"}
    assert all(0 <= item.confidence <= 1 for item in names)
    assert all(item.low_confidence is False for item in names)


def test_merge_names_marks_low_confidence_for_unknown_name() -> None:
    donors = [_donor(1, "99", "Ahmet", "Yilmaz")]
    names = _merge_to_extracted_names(
        transcript_text="",
        ocr_text="",
        names=[ExtractedName(full_name="Tanimsiz Kisi", source="audio", confidence=0.55)],
        donors=donors,
    )
    assert len(names) == 1
    assert names[0].low_confidence is True

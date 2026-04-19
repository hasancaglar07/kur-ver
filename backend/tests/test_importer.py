from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.services.importer import import_file


def test_import_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "NO,ÜLKE,İL,BÖLGE,AD,SOYAD,TEL\n"
        "99,ÇAD,KEDEV,1.BÖLGE,AHMET,YILMAZ,+905551112233\n"
        "99,ÇAD,KEDEV,1.BÖLGE,FATMA,DEMIR,905551112234\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    with Session() as db:
        summary = import_file(db, csv_path, batch_id="test_batch")

    assert summary.imported_count == 2
    assert summary.updated_count == 0
    assert summary.skipped_count == 0
    assert summary.invalid_phone_count == 0
    assert summary.duplicate_in_file_count == 0


def test_import_csv_reports_invalid_phone_and_duplicate_rows(tmp_path: Path) -> None:
    csv_path = tmp_path / "sample_invalid.csv"
    csv_path.write_text(
        "NO,ÜLKE,İL,BÖLGE,AD,SOYAD,TEL\n"
        "99,ÇAD,KEDEV,1.BÖLGE,AHMET,YILMAZ,abc\n"
        "99,ÇAD,KEDEV,1.BÖLGE,FATMA,DEMIR,+905551112234\n"
        "99,ÇAD,KEDEV,1.BÖLGE,FATMA,DEMIR,+905551112234\n",
        encoding="utf-8",
    )

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    with Session() as db:
        summary = import_file(db, csv_path, batch_id="test_batch")

    assert summary.imported_count == 1
    assert summary.skipped_count == 2
    assert summary.invalid_phone_count == 1
    assert summary.duplicate_in_file_count == 1

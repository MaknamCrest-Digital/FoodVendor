"""Register the POS demo terminal in the local SQLite development database."""
from app.core.config import settings
from app.db.session import Base, SessionLocal, engine
from app.models.models import Business, Location, Terminal


def main():
    if settings.environment != "development" or not settings.database_url.startswith("sqlite"):
        raise RuntimeError("Demo setup requires a development SQLite database")
    Base.metadata.create_all(engine)
    with SessionLocal.begin() as db:
        records = [
            Business(id="11111111-1111-1111-1111-111111111111", name="Adonai Pork"),
            Location(id="22222222-2222-2222-2222-222222222222", business_id="11111111-1111-1111-1111-111111111111", name="Dansoman"),
            Terminal(id="33333333-3333-3333-3333-333333333333", business_id="11111111-1111-1111-1111-111111111111", location_id="22222222-2222-2222-2222-222222222222", name="Tablet 1"),
        ]
        for record in records:
            if db.get(type(record), record.id) is None:
                db.add(record)
                db.flush()
    print("Local demo terminal ready")


if __name__ == "__main__":
    main()

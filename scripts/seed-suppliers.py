#!/usr/bin/env python3
"""
Seed suppliers from the exported CSV into the database.
Run: python3 scripts/seed-suppliers.py
"""
import csv
import io
import os
import sys
import re
import urllib.parse
import mysql.connector

# Load .env file
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), "../.env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

load_env()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("DATABASE_URL not set")
    sys.exit(1)

def parse_mysql_url(url):
    u = urllib.parse.urlparse(url)
    return {
        "host": u.hostname,
        "port": u.port or 3306,
        "user": u.username,
        "password": urllib.parse.unquote(u.password or ""),
        "database": u.path.lstrip("/"),
        "ssl_disabled": False,
    }

def clean_url(url):
    if not url:
        return None
    url = url.strip().rstrip(",").strip()
    return url if url else None

def get_credential_stage(row):
    has_creds = bool(row.get("username__13", "").strip() or row.get("password", "").strip())
    return 2  # Default: require stage 2 to see credentials

def main():
    # Read CSV
    csv_path = os.path.join(os.path.dirname(__file__), "../../upload/export_dir/export.csv")
    if not os.path.exists(csv_path):
        csv_path = os.path.join(os.path.dirname(__file__), "../../upload/pasted_file_b3itK8_export.csv")

    with open(csv_path, encoding="utf-16") as f:
        content = f.read()

    reader = csv.DictReader(io.StringIO(content), delimiter="\t")
    rows = list(reader)
    print(f"Parsed {len(rows)} rows from CSV")

    # Connect to DB
    cfg = parse_mysql_url(DATABASE_URL)
    conn = mysql.connector.connect(**cfg)
    cursor = conn.cursor()

    # Clear existing suppliers
    cursor.execute("DELETE FROM suppliers")
    conn.commit()
    print("Cleared existing suppliers")

    inserted = 0
    errors = 0

    for i, row in enumerate(rows):
        name = row.get("listing_title", "").strip()
        if not name:
            continue

        image_filename = row.get("images", "").strip() or None

        categories = ";".join(
            c.strip() for c in row.get("listing_category", "").split(";") if c.strip()
        ) or None

        locations = ";".join(
            l.strip() for l in row.get("locations_tags", "").split(";") if l.strip()
        ) or None

        trade_web = (
            clean_url(row.get("trade_website", "")) or
            clean_url(row.get("website_1", "")) or
            clean_url(row.get("website", ""))
        )

        image_url = f"__PENDING__{image_filename}" if image_filename else None

        values = (
            name,
            row.get("description", "").strip() or None,
            row.get("short_description", "").strip() or None,
            clean_url(row.get("public_website", "")),
            trade_web,
            None,  # additionalWebsite
            row.get("agency_id", "").strip() or None,
            row.get("username__13", "").strip() or None,
            row.get("password", "").strip() or None,
            row.get("commission", "").strip() or None,
            clean_url(row.get("facebook", "")),
            row.get("account_manager", "").strip() or None,
            row.get("phone", "").strip() or None,
            row.get("email", "").strip() or None,
            row.get("general", "").strip() or None,
            row.get("video_1", "").strip() or None,
            row.get("video_2", "").strip() or None,
            row.get("video_3", "").strip() or None,
            categories,
            locations,
            image_url,
            row.get("admin_only_-_username", "").strip() or None,
            row.get("admin_only_-_password", "").strip() or None,
            row.get("admin_only_-_notes", "").strip() or None,
            get_credential_stage(row),
            1,  # isActive
            i,  # sortOrder
        )

        try:
            cursor.execute(
                """INSERT INTO suppliers
                    (name, description, shortDescription, publicWebsite, tradeWebsite, additionalWebsite,
                     agencyId, loginUsername, loginPassword, commission, facebookUrl, accountManager,
                     phone, email, generalNotes, video1, video2, video3, categories, locations, imageUrl,
                     adminUsername, adminPassword, adminNotes, credentialStage, isActive, sortOrder)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                values,
            )
            inserted += 1
        except Exception as e:
            print(f"Error inserting '{name}': {e}")
            errors += 1

        if (inserted + errors) % 50 == 0:
            conn.commit()
            print(f"  Progress: {inserted} inserted, {errors} errors...")

    conn.commit()
    cursor.close()
    conn.close()

    print(f"\nDone! Inserted: {inserted}, Errors: {errors}")
    print("Note: Image URLs are set to __PENDING__<filename> — run the image upload script next.")

if __name__ == "__main__":
    main()

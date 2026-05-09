#!/usr/bin/env python3
"""Clean WordPress Gutenberg block markup from supplier descriptions in the database."""

import re
import os
import mysql.connector

DATABASE_URL = os.environ.get("DATABASE_URL", "")

def parse_db_url(url):
    """Parse mysql://user:pass@host:port/dbname"""
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    return {
        "host": parsed.hostname,
        "port": parsed.port or 3306,
        "user": parsed.username,
        "password": parsed.password,
        "database": parsed.path.lstrip("/"),
    }

def clean_wp_markup(text):
    if not text:
        return text
    # Remove WordPress Gutenberg block comments: <!-- wp:paragraph --> and <!-- /wp:paragraph -->
    cleaned = re.sub(r'<!--\s*/?wp:[^>]*-->', '', text)
    # Remove extra whitespace/newlines left behind
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    cleaned = cleaned.strip()
    return cleaned

def main():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        return

    params = parse_db_url(DATABASE_URL)
    conn = mysql.connector.connect(**params)
    cursor = conn.cursor()

    # Fetch all suppliers with descriptions
    cursor.execute("SELECT id, description FROM suppliers WHERE description IS NOT NULL AND description != ''")
    rows = cursor.fetchall()
    print(f"Found {len(rows)} suppliers with descriptions")

    updated = 0
    for supplier_id, description in rows:
        cleaned = clean_wp_markup(description)
        if cleaned != description:
            cursor.execute("UPDATE suppliers SET description = %s WHERE id = %s", (cleaned, supplier_id))
            updated += 1

    conn.commit()
    cursor.close()
    conn.close()
    print(f"Updated {updated} supplier descriptions")

if __name__ == "__main__":
    main()

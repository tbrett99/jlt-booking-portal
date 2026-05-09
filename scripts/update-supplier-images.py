#!/usr/bin/env python3
"""
Update supplier imageUrl fields in the database with the S3 URLs from the upload.
Run: python3 scripts/update-supplier-images.py
"""
import os
import sys
import re
import urllib.parse
import mysql.connector

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

# Parse the upload URLs file
url_map = {}  # filename (without extension) -> S3 URL
url_file = "/home/ubuntu/upload/supplier_image_urls.txt"
with open(url_file) as f:
    for line in f:
        m = re.search(r'\[SUCCESS\] (.+?) -> (https://\S+)', line)
        if m:
            filename = m.group(1)
            s3_url = m.group(2)
            url_map[filename] = s3_url
            # Also map without extension for fuzzy matching
            base = os.path.splitext(filename)[0]
            url_map[base] = s3_url

print(f"Loaded {len(url_map)} URL mappings")

# Connect to DB
cfg = parse_mysql_url(DATABASE_URL)
conn = mysql.connector.connect(**cfg)
cursor = conn.cursor()

# Get all suppliers with pending image URLs
cursor.execute("SELECT id, imageUrl FROM suppliers WHERE imageUrl LIKE '__PENDING__%'")
rows = cursor.fetchall()
print(f"Found {len(rows)} suppliers with pending image URLs")

updated = 0
not_found = 0

for supplier_id, image_url in rows:
    # Extract filename from __PENDING__<filename>
    filename = image_url.replace("__PENDING__", "")
    
    # Try exact match first
    s3_url = url_map.get(filename)
    
    if not s3_url:
        # Try without extension
        base = os.path.splitext(filename)[0]
        s3_url = url_map.get(base)
    
    if not s3_url:
        # Try case-insensitive match
        filename_lower = filename.lower()
        for k, v in url_map.items():
            if k.lower() == filename_lower or os.path.splitext(k)[0].lower() == os.path.splitext(filename_lower)[0]:
                s3_url = v
                break
    
    if s3_url:
        cursor.execute("UPDATE suppliers SET imageUrl = %s WHERE id = %s", (s3_url, supplier_id))
        updated += 1
    else:
        print(f"  Not found: {filename}")
        # Set to NULL if image not found
        cursor.execute("UPDATE suppliers SET imageUrl = NULL WHERE id = %s", (supplier_id,))
        not_found += 1

conn.commit()
cursor.close()
conn.close()

print(f"\nDone! Updated: {updated}, Not found (set to NULL): {not_found}")

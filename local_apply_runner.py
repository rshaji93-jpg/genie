import os
import sys
import time
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright

# PASTE YOUR WEB APP URL HERE:
WEB_APP_URL = "https://script.google.com/macros/s/AKfycby5cRsS8P8R_TqNnoQgSlW7rB4bgLCQD3CVZWMMXupVFasWYoopAysAr-8yCHajVw3TfA/exec"

USER_DATA_DIR = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"
RESUME_PATH = Path("profile") / "Shaji_ATS_Optimized_AR_Resume.docx"

def fetch_queue():
    url = f"{WEB_APP_URL}?action=get_queue"
    try:
        response = requests.get(url, allow_redirects=True, timeout=15)
        return response.json()
    except Exception as e:
        print(f"[Error fetching queue]: {e}")
        return []

def mark_status_in_sheet(row_index: int, new_status: str):
    payload = {"action": "update_status", "rowIndex": row_index, "status": new_status}
    try:
        requests.post(WEB_APP_URL, json=payload, allow_redirects=True, timeout=15)
        print(f"[Sheet Updated] Row {row_index} set to {new_status}")
    except Exception as e:
        print(f"[Error updating sheet]: {e}")

def run_application(job: dict, p):
    print("\n" + "=" * 65)
    print(f" Processing: {job.get('title')} at {job.get('company')}")
    print(f" Match Score: {job.get('matchScore')} | Location: {job.get('location')}")
    print(f" Target URL: {job.get('url')}")
    print("=" * 65)

    try:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            channel="chrome",
            headless=False,
            args=["--start-maximized"]
        )
    except Exception:
        context = p.chromium.launch_persistent_context(
            user_data_dir="local_browser_session",
            headless=False
        )

    page = context.pages[0] if context.pages else context.new_page()

    target_url = job.get("url", "")
    if target_url and target_url.startswith("http"):
        page.goto(target_url)
    else:
        query = f"{job.get('company', '')} {job.get('title', '')} careers"
        page.goto(f"https://www.google.com/search?q={query.replace(' ', '+')}")

    print("\n>>> BROWSER RUNNING")
    print(f">>> Candidate: SHAJI RAJ JOSEPH | 11+ Yrs US Healthcare RCM")
    print(f">>> Resume: {RESUME_PATH.resolve()}")
    print("\n>>> MANUAL CHECKPOINT:")
    print("    Review the listing and complete any CAPTCHAs, 2FA, or portal forms in Chrome.")
    
    choice = input("\nDid you complete/submit this application? [y = Mark Applied / s = Skip / q = Quit]: ").strip().lower()

    if choice == 'y':
        mark_status_in_sheet(job['rowIndex'], "APPLIED")
    elif choice == 's':
        mark_status_in_sheet(job['rowIndex'], "SKIPPED_LOCAL")
    
    context.close()
    return choice != 'q'

def main():
    if "YOUR_APPS_SCRIPT_WEB_APP" in WEB_APP_URL:
        print("Please edit local_apply_runner.py and replace YOUR_APPS_SCRIPT_WEB_APP_URL_HERE with your real Web App URL.")
        return

    print("Checking Google Sheet for 'QUEUE_TO_APPLY' roles...")
    queue = fetch_queue()

    if not queue:
        print("No jobs currently pending application in your sheet.")
        print("Tip: Drop a job description into your Web Chat and click 'Interested (Queue to Apply)'.")
        return

    print(f"Found {len(queue)} job(s) queued for application.\n")
    
    with sync_playwright() as p:
        for job in queue:
            should_continue = run_application(job, p)
            if not should_continue:
                break

    print("\nBatch runner completed.")

if __name__ == "__main__":
    main()
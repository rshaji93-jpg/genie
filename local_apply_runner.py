import os
import sys
import time
import requests
from pathlib import Path

# PASTE YOUR WEB APP URL HERE:
WEB_APP_URL = "https://script.google.com/macros/s/AKfycby5cRsS8P8R_TqNnoQgSlW7rB4bgLCQD3CVZWMMXupVFasWYoopAysAr-8yCHajVw3TfA/exec"

USER_DATA_DIR = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"
RESUME_PATH = Path("profile") / "Shaji_ATS_Optimized_AR_Resume.docx"

def fetch_queue():
    url = f"{WEB_APP_URL}?action=get_queue"
    try:
        response = requests.get(url, allow_redirects=True, timeout=15)
        response.raise_for_status()
        queue = response.json()
    except (requests.RequestException, ValueError) as error:
        raise RuntimeError("Could not retrieve the application queue.") from error
    if not isinstance(queue, list):
        raise RuntimeError("The application queue returned an invalid response.")
    return queue

def mark_status_in_sheet(row_index: int, new_status: str):
    payload = {"action": "update_status", "rowIndex": row_index, "status": new_status}
    try:
        requests.post(WEB_APP_URL, json=payload, allow_redirects=True, timeout=15)
        print(f"[Sheet Updated] Row {row_index} set to {new_status}")
    except Exception as e:
        print(f"[Error updating sheet]: {e}")


def run_local_agent(task: str) -> dict:
    queue = fetch_queue()
    jobs = [
        {
            "title": str(job.get("title", "Untitled role")),
            "company": str(job.get("company", "Unknown company")),
            "location": str(job.get("location", "Not specified")),
            "url": str(job.get("url", "")),
        }
        for job in queue
        if isinstance(job, dict)
    ]
    summary = (
        f"Found {len(jobs)} queued application(s)."
        if jobs
        else "There are no queued applications to review."
    )
    return {
        "agent_name": "Apply Runner",
        "status": "ready_for_review" if jobs else "completed",
        "summary": f"{summary} {task.strip()}".strip(),
        "logs": ["Queue preview only; no browser was opened and no application was submitted."],
        "actions": [],
        "results": jobs,
    }


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
    from playwright.sync_api import sync_playwright

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
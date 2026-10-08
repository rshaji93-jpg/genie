import time
from playwright.sync_api import sync_playwright

def launch_and_autofill(url: str, profile: dict):
    """
    Launches a visible Chromium session, navigates to the application URL,
    and intelligently populates matching input fields based on candidate data.
    """
    with sync_playwright() as p:
        # Launch visible browser window
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()
        
        print(f"Navigating to {url}...")
        page.goto(url, timeout=60000)

        # Standard field mapping rules for job application portals
        field_mappings = [
            # Name fields
            {"selectors": ["input[name*='name' i]", "input[id*='name' i]", "input[placeholder*='name' i]"], "value": profile.get("name")},
            {"selectors": ["input[name*='first' i]", "input[placeholder*='first' i]"], "value": profile.get("first_name")},
            {"selectors": ["input[name*='last' i]", "input[placeholder*='last' i]"], "value": profile.get("last_name")},
            # Contact
            {"selectors": ["input[type='email']", "input[name*='email' i]", "input[placeholder*='email' i]"], "value": profile.get("email")},
            {"selectors": ["input[type='tel']", "input[name*='phone' i]", "input[name*='mobile' i]", "input[placeholder*='phone' i]"], "value": profile.get("phone")},
            # Location
            {"selectors": ["input[name*='city' i]", "input[placeholder*='city' i]", "input[name*='location' i]"], "value": profile.get("current_city")},
            # Experience
            {"selectors": ["input[name*='exp' i]", "input[placeholder*='experience' i]"], "value": profile.get("experience_years")},
        ]

        # Scan page and pre-populate matching text inputs
        for mapping in field_mappings:
            value = mapping["value"]
            if not value:
                continue
            for selector in mapping["selectors"]:
                try:
                    locator = page.locator(selector).first
                    if locator.is_visible(timeout=1000):
                        # Only type if the field is empty
                        if not locator.input_value():
                            locator.fill(str(value))
                            break
                except Exception:
                    continue

        # Human-in-the-loop review window (keeps browser active for review)
        print("Application fields populated. Pausing for human verification...")
        try:
            # Stays open until user closes the window or 60 seconds elapse
            page.wait_for_timeout(60000)
        except Exception:
            pass
        finally:
            browser.close()
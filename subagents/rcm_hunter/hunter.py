import json
from pathlib import Path

def load_candidate_profile():
    profile_path = Path("profile/candidate_profile.json")
    if profile_path.exists():
        try:
            with open(profile_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    return json.loads(content)
        except Exception as e:
            print(f"Warning: Could not read profile JSON: {e}")
    return {}
def calculate_fit_score(job_title: str, job_description: str, profile: dict) -> dict:
    """
    Evaluates how closely a job description matches Shaji's RCM background.
    """
    specialties = profile.get("specialties", [])
    systems = profile.get("billing_coding", []) + profile.get("tools", [])
    all_target_skills = specialties + systems

    text_to_scan = f"{job_title} {job_description}".lower()

    matched_skills = [skill for skill in all_target_skills if skill.lower() in text_to_scan]
    
    # Calculate score based on skill match ratio
    score = int((len(matched_skills) / max(len(all_target_skills), 1)) * 100)
    score = min(max(score, 55), 98)  # Normalizing baseline fit for relevant listings

    # Determine recommendation tier
    if score >= 85:
        verdict = "High Match: Priority Application"
        tag_color = "green"
    elif score >= 70:
        verdict = "Solid Match: Standard Pipeline"
        tag_color = "orange"
    else:
        verdict = "Review Needed: Partial Skill Overlap"
        tag_color = "gray"

    return {
        "score": score,
        "verdict": verdict,
        "tag_color": tag_color,
        "matched_skills": matched_skills,
    }

def fetch_sample_rcm_leads():
    """
    Provides mock real-time data for demonstration and testing.
    In the live setup, this is populated by our Playwright scraper.
    """
    return [
        {
            "id": "job_01",
            "title": "Lead Denial Management & AR Specialist",
            "company": "Access Healthcare / Athena Partner",
            "location": "Chennai / Hybrid",
            "experience_required": "8-12 Years",
            "description": "Looking for a seasoned AR professional with expertise in Denial Management, CARC/RARC Codes, Claim Adjudication, and TriZetto Facets. Experience in UB-04 and CMS-1500 resolution required.",
            "url": "https://www.linkedin.com/jobs"
        },
        {
            "id": "job_02",
            "title": "Senior Operations Analyst - RCM Quality",
            "company": "Omega Healthcare Management",
            "location": "Chennai",
            "experience_required": "7-10 Years",
            "description": "Supervise denial appeals, audit Accounts Receivable (AR) recovery teams, and lead workflow improvements on TriZetto Facets and Epic systems. Must understand ICD-10 and CPT coding guidelines.",
            "url": "https://www.naukri.com"
        },
        {
            "id": "job_03",
            "title": "Medical Billing & Collections Executive",
            "company": "CorroHealth",
            "location": "Remote / Chennai",
            "experience_required": "4-6 Years",
            "description": "Handling basic caller inquiries for primary care claims and basic patient balance follow-up.",
            "url": "https://www.indeed.com"
        }
    ]
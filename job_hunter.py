import os
import json
from pathlib import Path
from google import genai

def load_master_profile():
    profile_path = Path("profile") / "master_profile.json"
    if not profile_path.exists():
        raise FileNotFoundError("profile/master_profile.json not found.")
    with open(profile_path, "r", encoding="utf-8") as f:
        return json.load(f)

# Sample target postings from top RCM employers in Chennai/Remote to test matching
SAMPLE_JOBS = [
    {
        "company": "Omega Healthcare",
        "title": "Senior AR Analyst - Denial Management",
        "location": "Chennai (Hybrid)",
        "requirements": "Minimum 5-8 years of experience in US Healthcare AR Follow-up and Denial Resolution. Strong working knowledge of UB-04, CMS-1500, COB, Timely Filing, and Appeals. Hands-on experience with TriZetto Facets is highly preferred."
    },
    {
        "company": "Access Healthcare",
        "title": "Team Lead - Revenue Cycle Operations",
        "location": "Chennai / Remote",
        "requirements": "8+ years in US Healthcare RCM. Proven track record managing AR aging buckets, auditing claim quality, mentoring junior callers, and resolving payment variance issues with commercial and government payers."
    },
    {
        "company": "Optum Global Solutions",
        "title": "Lead Claims Adjudication Specialist",
        "location": "Remote (India)",
        "requirements": "10+ years in health plan operations, claims adjudication, payment integrity, and complex claim audits. Deep familiarity with Medicare/Medicaid guidelines and provider contracts."
    }
]

def evaluate_job_match(job_details: dict, profile: dict, client: genai.Client):
    prompt = f"""
You are an expert US Healthcare RCM Recruiter.

Candidate Master Profile:
- Name: {profile['name']}
- Total Experience: {profile['experience_years']}+ years in US Healthcare RCM
- Key Skills: {', '.join(profile['skills'])}
- Target Roles: {', '.join(profile['target_roles'])}

Job Opportunity:
- Title: {job_details['title']}
- Company: {job_details['company']}
- Location: {job_details['location']}
- Requirements: {job_details['requirements']}

Evaluate the candidate for this position and provide:
1. Match Score: (e.g. 95%)
2. Fit Analysis: 2 bullet points detailing why the candidate's specific background (UB-04/CMS-1500, Facets, Denial Management, 11+ years) fits the employer's needs.
3. Tailored Application Hook: A 2-sentence elevator pitch tailored for this specific hiring manager.
"""
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=prompt
    )
    return interaction.output_text


def run_local_agent(task: str) -> dict:
    from subagents.rcm_hunter.hunter import (
        calculate_fit_score,
        fetch_sample_rcm_leads,
        load_candidate_profile,
    )

    profile = load_candidate_profile()
    scored_jobs = []
    for job in fetch_sample_rcm_leads():
        score = calculate_fit_score(job["title"], job["description"], profile)
        scored_jobs.append({
            "title": job["title"],
            "company": job["company"],
            "location": job["location"],
            "score": score["score"],
            "verdict": score["verdict"],
            "matched_skills": score["matched_skills"],
            "url": job["url"],
        })
    scored_jobs.sort(key=lambda job: job["score"], reverse=True)
    return {
        "agent_name": "Job Hunter",
        "status": "completed",
        "summary": f"Ranked {len(scored_jobs)} locally configured opportunities for: {task.strip() or 'profile matching'}.",
        "logs": ["Compared local sample listings with the candidate profile; no cloud model was called."],
        "actions": [],
        "results": scored_jobs,
    }


def main():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set.")

    client = genai.Client(api_key=api_key)
    profile = load_master_profile()

    print("=" * 65)
    print(f" JOB HUNT AGENT: PROFILE MATCHER & EVALUATOR")
    print(f" Candidate: {profile['name']} | Experience: {profile['experience_years']} Years")
    print("=" * 65)

    for i, job in enumerate(SAMPLE_JOBS, 1):
        print(f"\n[{i}/3] Evaluating: {job['title']} at {job['company']}...")
        result = evaluate_job_match(job, profile, client)
        print(result)
        print("-" * 65)

if __name__ == "__main__":
    main()
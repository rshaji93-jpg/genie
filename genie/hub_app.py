def run_local_agent(task: str) -> dict:
    from subagents.rcm_hunter.hunter import (
        calculate_fit_score,
        fetch_sample_rcm_leads,
        load_candidate_profile,
    )

    profile = load_candidate_profile()
    results = []
    for job in fetch_sample_rcm_leads():
        score = calculate_fit_score(job["title"], job["description"], profile)
        results.append({
            "title": job["title"],
            "company": job["company"],
            "location": job["location"],
            "score": score["score"],
            "verdict": score["verdict"],
            "matched_skills": score["matched_skills"],
        })
    return {
        "agent_name": "Hub Operations",
        "status": "completed",
        "summary": f"Hub operations scored {len(results)} local RCM lead(s) for: {task.strip() or 'pipeline overview'}.",
        "logs": ["Used the local sample-lead scorer; no cloud model or browser was started."],
        "actions": [],
        "results": results,
    }


def main():
    import streamlit as st
    from core.autofill_agent import launch_and_autofill
    from subagents.rcm_hunter.hunter import (
        calculate_fit_score,
        fetch_sample_rcm_leads,
        load_candidate_profile,
    )

    st.set_page_config(page_title="Personal AI Hub", layout="wide", page_icon="🤖")
    st.title("🤖 Mini Gemini: Personal AI Hub")
    st.caption("Autonomous Orchestrator | Sub-Agent 1: US Healthcare RCM Hunter")

    profile = load_candidate_profile()

    with st.sidebar:
        st.header("Candidate Profile")
        st.write(f"**Name:** {profile.get('name', 'N/A')}")
        st.write(f"**Experience:** {profile.get('experience_years', 'N/A')} yrs")
        st.write(f"**Email:** {profile.get('email', 'N/A')}")
        st.write(f"**Phone:** {profile.get('phone', 'N/A')}")
        st.write(f"**Domain:** {profile.get('domain', 'N/A')}")
        st.divider()
        st.write("**Specialties:**")
        for specialty in profile.get("specialties", []):
            st.markdown(f"- {specialty}")
        st.write("**Systems & Coding:**")
        for item in profile.get("billing_coding", []) + profile.get("tools", []):
            st.markdown(f"- {item}")

    st.subheader("Sub-Agent 1: Targeted Job Search & Fit Scoring")
    st.text_input("Target Query / Role:", value="Lead Denial Management Specialist Chennai")

    if st.button("🔍 Scan & Evaluate Postings", type="primary"):
        st.session_state["jobs_scanned"] = True

    if st.session_state.get("jobs_scanned"):
        leads = fetch_sample_rcm_leads()
        st.success(f"Retrieved {len(leads)} target opportunities. Evaluated against your profile:")

        for job in leads:
            analysis = calculate_fit_score(job["title"], job["description"], profile)
            with st.container():
                st.markdown(f"### {job['title']} — **{job['company']}**")
                col1, col2, col3 = st.columns([1, 2, 1])

                with col1:
                    st.metric(label="Fit Score", value=f"{analysis['score']}%")
                    st.caption(analysis["verdict"])

                with col2:
                    st.write(
                        f"**Location:** {job['location']} | **Experience:** {job['experience_required']}"
                    )
                    st.write(f"**Description:** {job['description']}")
                    matched = ", ".join(analysis["matched_skills"]) or "General domain match"
                    st.info(f"**Matched Keywords:** {matched}")

                with col3:
                    if st.button("🚀 Pre-fill & Review", key=job["id"]):
                        with st.spinner("Launching automated application runner..."):
                            launch_and_autofill(job["url"], profile)
                        st.success("Session completed.")

                st.divider()


if __name__ == "__main__":
    main()

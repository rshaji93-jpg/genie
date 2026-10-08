import json
from pathlib import Path
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

# --- Sidebar: Profile Overview ---
with st.sidebar:
    st.header("Candidate Profile")
    st.write(f"**Name:** {profile.get('name', 'N/A')}")
    st.write(f"**Experience:** {profile.get('experience_years', 'N/A')} yrs")
    st.write(f"**Email:** {profile.get('email', 'N/A')}")
    st.write(f"**Phone:** {profile.get('phone', 'N/A')}")
    st.write(f"**Domain:** {profile.get('domain', 'N/A')}")
    st.divider()
    st.write("**Specialties:**")
    for s in profile.get("specialties", []):
        st.markdown(f"- {s}")
    st.write("**Systems & Coding:**")
    for b in profile.get("billing_coding", []) + profile.get("tools", []):
        st.markdown(f"- {b}")

# --- Sub-Agent 1 Interface ---
st.subheader("Sub-Agent 1: Targeted Job Search & Fit Scoring")

query = st.text_input(
    "Target Query / Role:", value="Lead Denial Management Specialist Chennai"
)

if st.button("🔍 Scan & Evaluate Postings", type="primary"):
    st.session_state["jobs_scanned"] = True

if st.session_state.get("jobs_scanned"):
    leads = fetch_sample_rcm_leads()
    st.success(
        f"Retrieved {len(leads)} target opportunities. Evaluated against your profile:"
    )

    for job in leads:
        analysis = calculate_fit_score(job["title"], job["description"], profile)
        score = analysis["score"]

        with st.container():
            st.markdown(f"### {job['title']} — **{job['company']}**")
            col1, col2, col3 = st.columns([1, 2, 1])

            with col1:
                st.metric(label="Fit Score", value=f"{score}%")
                st.caption(analysis["verdict"])

            with col2:
                st.write(
                    f"**Location:** {job['location']} | **Experience:** {job['experience_required']}"
                )
                st.write(f"**Description:** {job['description']}")
                matched = (
                    ", ".join(analysis["matched_skills"])
                    if analysis["matched_skills"]
                    else "General domain match"
                )
                st.info(f"**Matched Keywords:** {matched}")

            with col3:
                st.write("")
                st.write("")
                if st.button("🚀 Pre-fill & Review", key=job["id"]):
                    with st.spinner("Launching automated application runner..."):
                        launch_and_autofill(job["url"], profile)
                    st.success("Session completed.")

            st.divider()
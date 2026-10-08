import os
import json
import re
from google import genai

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set.")

client = genai.Client(api_key=api_key)

# ----------------- SUBORDINATE AGENTS -----------------

def job_hunt_agent(task_description: str):
    print(f"\n>>> [DISPATCHING TO JOB HUNT AGENT]: {task_description}")
    # Phase 1 Subordinate logic will attach here
    print("Job Hunt Agent status: Search task acknowledged. Preparing pipeline.")

def security_scanner_agent(target: str):
    print(f"\n>>> [DISPATCHING TO SECURITY SCANNER]: Checking '{target}'")
    # Phase 2 Subordinate logic will attach here
    print("Security Scanner status: Target queued for inspection.")

# ----------------- MANAGER ROUTER -----------------

ROUTING_PROMPT = """
You are the central Personal AI Manager Agent.
Analyze the user's input and decide how to handle it. You must reply strictly in valid JSON format with no markdown and no extra text.

Options:
1. If the request is about job searches, applications, resumes, hiring, or career tracking:
   {"route": "job_hunt", "task": "concise description of the task"}

2. If the request is about scanning files, malware checks, security, or suspicious scripts:
   {"route": "security_scan", "target": "the path or target to check"}

3. For general conversation, questions, or clarification:
   {"route": "direct_reply", "message": "your helpful answer to the user"}
"""

def route_request(user_input: str, previous_id: str | None = None):
    prompt = f"{ROUTING_PROMPT}\nUser input: {user_input}"
    
    kwargs = {
        "model": "gemini-3.8-flash",
        "input": prompt,
    }
    if previous_id:
        kwargs["previous_interaction_id"] = previous_id

    interaction = client.interactions.create(**kwargs)
    return interaction

def main():
    print("=" * 65)
    print("  PERSONAL AI MANAGER AGENT ONLINE (gemini-3.8-flash)")
    print("  Active Subordinates: [Job Hunt Agent, Security Scanner]")
    print("  Type 'exit' to shut down.")
    print("=" * 65)

    last_id = None

    while True:
        try:
            user_input = input("\nYou: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit"]:
                print("Manager shutting down...")
                break

            interaction = route_request(user_input, last_id)
            last_id = interaction.id
            raw_text = interaction.output_text.strip()

            # Clean any stray markdown formatting
            cleaned_json = re.sub(r"^```(?:json)?|```$", "", raw_text, flags=re.MULTILINE).strip()
            decision = json.loads(cleaned_json)

            route = decision.get("route")
            if route == "job_hunt":
                job_hunt_agent(decision.get("task", user_input))
            elif route == "security_scan":
                security_scanner_agent(decision.get("target", user_input))
            else:
                print(f"\nManager: {decision.get('message', raw_text)}")

        except json.JSONDecodeError:
            print(f"\nManager: {interaction.output_text}")
        except KeyboardInterrupt:
            print("\nShutting down...")
            break
        except Exception as e:
            print(f"\nError: {e}")

if __name__ == "__main__":
    main()
#!/usr/bin/env python
import sys
from pydantic import BaseModel

from crewai.flow import Flow, listen, start

from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew


class GoerState(BaseModel):
    user_id: str = ""
    user_message: str = ""
    response: str = ""


class GoerFlow(Flow[GoerState]):
    @start()
    def capture_turn(self):
        return self.state.user_message

    @listen(capture_turn)
    def answer_turn(self):
        result = DiscoveryCrew().crew().kickoff(
            inputs={"user_message": self.state.user_message}
        )
        self.state.response = result.raw
        return self.state.response


def run_turn(user_message: str, user_id: str = "demo-user") -> str:
    flow = GoerFlow()
    flow.kickoff(inputs={"user_id": user_id, "user_message": user_message})
    return flow.state.response


def interactive_cli():
    print("Welcome to Goer AI! Type 'exit' or 'quit' to end.")
    while True:
        try:
            user_text = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_text:
            continue

        if user_text.lower() in ("exit", "quit"):
            print("Goodbye!")
            break

        print("Goer is thinking...")
        try:
            response = run_turn(user_text)
            print(f"Goer: {response}")
        except Exception as exc:
            print(f"Error: {exc}")


def kickoff():
    if len(sys.argv) > 1 and sys.argv[1] in ("-i", "--interactive", "interactive"):
        interactive_cli()
    else:
        print(run_turn("Find me a sandwich at Al-Taib."))


def plot():
    GoerFlow().plot("goer_flow.html")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("-i", "--interactive", "interactive"):
        interactive_cli()
    else:
        kickoff()

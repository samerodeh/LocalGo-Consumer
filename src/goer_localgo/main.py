#!/usr/bin/env python
import sys

from goer_localgo.flow.goer_flow import GoerFlow, run_turn


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

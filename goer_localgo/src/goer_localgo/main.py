#!/usr/bin/env python
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


def kickoff():
    print(run_turn("Find me a sandwich at Al-Taib."))


def plot():
    GoerFlow().plot("goer_flow.html")


if __name__ == "__main__":
    kickoff()

from crewai.flow import Flow, listen, start

from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew
from goer_localgo.flow.state import GoerState


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

"""Opt-in cart specialist. Call only from authenticated, request-scoped code.

This crew is intentionally not attached to the development demo chat routes.
"""

from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_builder.base_agent import BaseAgent
from crewai.project import CrewBase, agent, crew, task

from goer_localgo.integrations.localgo.cart_client import CartClient
from goer_localgo.schemas.cart import CartPlan
from goer_localgo.tools.cart.get_cart import GetCartTool
from goer_localgo.tools.catalog.get_product import GetProductTool
from goer_localgo.tools.catalog.search_menu import SearchMenuTool


@CrewBase
class CartCrew:
    agents: list[BaseAgent]
    tasks: list[Task]
    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    def __init__(self, client: CartClient, request_key: str):
        self._client = client
        self._request_key = request_key

    @agent
    def cart_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["cart_agent"],
            tools=[GetCartTool(client=self._client), GetProductTool(), SearchMenuTool()],
            max_iter=6, max_retry_limit=0, allow_delegation=False, verbose=False,
        )

    @task
    def cart_task(self) -> Task:
        return Task(config=self.tasks_config["cart_task"], output_pydantic=CartPlan)

    @crew
    def crew(self) -> Crew:
        return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential,
                    cache=False, verbose=False)

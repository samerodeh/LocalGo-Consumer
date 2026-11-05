"""Opt-in cart specialist. Call only from authenticated, request-scoped code.

This crew is intentionally not attached to the development demo chat routes.
"""

from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_builder.base_agent import BaseAgent
from crewai.project import CrewBase, agent, crew, task

from goer_localgo.integrations.localgo.cart_client import CartClient
from goer_localgo.tools.cart.add_cart_item import AddCartItemTool
from goer_localgo.tools.cart.base import CartMutationBudget
from goer_localgo.tools.cart.clear_cart import ClearCartTool
from goer_localgo.tools.cart.get_cart import GetCartTool
from goer_localgo.tools.cart.remove_cart_line import RemoveCartLineTool
from goer_localgo.tools.cart.update_cart_line import UpdateCartLineTool
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
        budget = CartMutationBudget()
        cart_tools = [tool(client=self._client, request_key=self._request_key, mutation_budget=budget)
                      for tool in (GetCartTool, AddCartItemTool, UpdateCartLineTool,
                                   RemoveCartLineTool, ClearCartTool)]
        return Agent(
            config=self.agents_config["cart_agent"],
            tools=[*cart_tools, GetProductTool(), SearchMenuTool()],
            max_iter=6, max_retry_limit=0, allow_delegation=False, verbose=False,
        )

    @task
    def cart_task(self) -> Task:
        return Task(config=self.tasks_config["cart_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(agents=self.agents, tasks=self.tasks, process=Process.sequential,
                    cache=False, verbose=False)

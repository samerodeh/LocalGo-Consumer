from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_builder.base_agent import BaseAgent
from crewai.project import CrewBase, agent, crew, task

from goer_localgo.tools.catalog.get_menu import GetMenuTool
from goer_localgo.tools.catalog.get_product import GetProductTool
from goer_localgo.tools.catalog.search_menu import SearchMenuTool


@CrewBase
class DiscoveryCrew:
    agents: list[BaseAgent]
    tasks: list[Task]

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def discovery_agent(self) -> Agent:
        return Agent(
            config=self.agents_config["discovery_agent"],  # type: ignore[index]
            tools=[SearchMenuTool(), GetMenuTool(), GetProductTool()],
            max_iter=6,
            allow_delegation=False,
            verbose=False,
        )

    @task
    def discovery_task(self) -> Task:
        return Task(
            config=self.tasks_config["discovery_task"],  # type: ignore[index]
        )

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            verbose=False,
        )
